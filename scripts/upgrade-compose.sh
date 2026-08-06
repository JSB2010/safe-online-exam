#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 2 ]]; then
  echo "usage: $0 [ENV_FILE] [--caddy|--local-smoke-image]" >&2
  exit 64
fi

environment_file="${1:-.env.secrets}"
mode="${2:-}"
caddy_mode=""
local_smoke_image=false
case "$mode" in
  "") ;;
  --caddy) caddy_mode="$mode" ;;
  --local-smoke-image) local_smoke_image=true ;;
  *)
    echo "second argument must be --caddy or --local-smoke-image" >&2
    exit 64
    ;;
esac
[[ -f "$environment_file" && ! -L "$environment_file" ]] || {
  echo "configuration file must be a regular file: $environment_file" >&2
  exit 64
}

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a
for command_name in curl docker; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "required command is unavailable: $command_name" >&2
    exit 69
  }
done
if [[ "$local_smoke_image" == "true" ]]; then
  [[ "${COMPOSE_SMOKE_ACTIVE:-}" == "true" ]] || {
    echo "--local-smoke-image is reserved for the isolated Compose smoke test" >&2
    exit 64
  }
  [[ -n "${COMPOSE_SMOKE_IMAGE:-}" && "${APP_IMAGE:-}" == "$COMPOSE_SMOKE_IMAGE" ]] || {
    echo "the configured image does not match the isolated Compose smoke image" >&2
    exit 64
  }
  docker image inspect "${APP_IMAGE:-}" >/dev/null 2>&1 || {
    echo "the local Compose smoke image is unavailable: ${APP_IMAGE:-unset}" >&2
    exit 64
  }
else
  [[ "${APP_IMAGE:-}" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ]] || {
    echo "APP_IMAGE must be the exact published Safe Online Exam GHCR digest" >&2
    exit 64
  }
fi
[[ "${OAUTH_TOKEN_ENCRYPTION_MODE:-}" == "compat" || "${OAUTH_TOKEN_ENCRYPTION_MODE:-}" == "enforce" ]] || {
  echo "OAUTH_TOKEN_ENCRYPTION_MODE must be set explicitly to compat or enforce" >&2
  exit 64
}

compose=(docker compose --env-file "$environment_file" -f compose.yaml -f compose.secrets.yaml)
if [[ "$caddy_mode" == "--caddy" ]]; then
  compose+=(-f compose.caddy.yaml --profile caddy)
fi

current_app_container="$("${compose[@]}" ps -q app)"
current_oauth_mode=""
if [[ -n "$current_app_container" ]]; then
  while IFS= read -r environment_entry; do
    case "$environment_entry" in
      OAUTH_TOKEN_ENCRYPTION_MODE=*) current_oauth_mode="${environment_entry#*=}" ;;
    esac
  done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$current_app_container")
fi
if [[ -z "$current_oauth_mode" && "$OAUTH_TOKEN_ENCRYPTION_MODE" != "compat" ]]; then
  echo "the current Compose application has not completed a compat-mode deployment; set OAUTH_TOKEN_ENCRYPTION_MODE=compat for the first upgrade" >&2
  exit 64
fi
if [[ -n "$current_oauth_mode" && "$current_oauth_mode" != "compat" && "$current_oauth_mode" != "enforce" ]]; then
  echo "the current Compose application reports an invalid OAuth token encryption mode" >&2
  exit 1
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$script_directory/backup.sh" ]]; then
  backup_command="$script_directory/backup.sh"
else
  backup_command="$script_directory/backup-compose.sh"
fi
backup_path="$("$backup_command" "$environment_file" "${BACKUP_DIRECTORY:-backups}")"

"${compose[@]}" config --quiet
if [[ "$local_smoke_image" != "true" ]]; then
  "${compose[@]}" pull
fi
"${compose[@]}" up -d --wait

bind_address="${BIND_ADDRESS:-127.0.0.1}"
[[ "$bind_address" == "0.0.0.0" ]] && bind_address=127.0.0.1
curl --fail --silent --show-error \
  --retry 8 --retry-delay 2 --retry-all-errors \
  "http://$bind_address:${APP_PORT:-8080}/ready" >/dev/null

cat <<EOF
Compose upgrade completed.
Image:  $APP_IMAGE
Backup: $backup_path

The backup was validated with pg_restore --list. Application rollback does not
reverse database migrations; confirm schema compatibility before downgrading.
EOF
