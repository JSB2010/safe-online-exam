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
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/compose-deployment.sh" ]]; then
  # shellcheck disable=SC1091
  source "$script_directory/compose-deployment.sh"
else
  # shellcheck disable=SC1091
  source "$script_directory/../scripts/compose-deployment.sh"
fi
compose_deployment_load "$script_directory" "$environment_file"
environment_file="$COMPOSE_DEPLOYMENT_ENV_FILE"

for command_name in curl docker openssl; do
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

compose_deployment_resolve_project_name defer-persist
compose_deployment_command
compose=("${COMPOSE_DEPLOYMENT_COMMAND[@]}")
if [[ "$caddy_mode" == "--caddy" ]]; then
  compose+=(-f "$COMPOSE_DEPLOYMENT_TOPOLOGY_DIRECTORY/compose.caddy.yaml" --profile caddy)
fi

current_app_containers=()
while IFS= read -r container_id; do
  [[ -n "$container_id" ]] && current_app_containers+=("$container_id")
done < <(docker ps -a \
  --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  --filter label=com.docker.compose.service=app \
  --format '{{.ID}}')
[[ "${#current_app_containers[@]}" -eq 1 ]] || {
  echo "expected exactly one existing Compose app container for project $COMPOSE_PROJECT_NAME; use setup.sh for a fresh installation or repair the existing project before upgrading" >&2
  exit 64
}
current_app_container="${current_app_containers[0]}"
current_oauth_mode=""
while IFS= read -r environment_entry; do
  case "$environment_entry" in
    OAUTH_TOKEN_ENCRYPTION_MODE=*) current_oauth_mode="${environment_entry#*=}" ;;
  esac
done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$current_app_container")
if [[ -z "$current_oauth_mode" && "$OAUTH_TOKEN_ENCRYPTION_MODE" != "compat" ]]; then
  echo "the current Compose application has not completed a compat-mode deployment; set OAUTH_TOKEN_ENCRYPTION_MODE=compat for the first upgrade" >&2
  exit 64
fi
if [[ -n "$current_oauth_mode" && "$current_oauth_mode" != "compat" && "$current_oauth_mode" != "enforce" ]]; then
  echo "the current Compose application reports an invalid OAuth token encryption mode" >&2
  exit 1
fi
compose_deployment_persist_discovered_project_name

keyring_path="$SECRETS_DIRECTORY/oauth_token_encryption_keyring"
if [[ ! -e "$keyring_path" && ! -L "$keyring_path" ]]; then
  [[ "$OAUTH_TOKEN_ENCRYPTION_MODE" == "compat" ]] || {
    echo "the missing OAuth token encryption keyring may only be created during the first compat-mode upgrade" >&2
    exit 64
  }
  [[ "${OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
    echo "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID is invalid" >&2
    exit 64
  }
  mkdir -p "$SECRETS_DIRECTORY"
  chmod 700 "$SECRETS_DIRECTORY"
  oauth_token_key="$(openssl rand -base64 32 | tr '/+' '_-' | tr -d '=\n')"
  [[ "$oauth_token_key" =~ ^[A-Za-z0-9_-]{43}$ ]] || {
    echo "OpenSSL generated an invalid OAuth token encryption key" >&2
    exit 1
  }
  keyring_temporary="$(mktemp "$SECRETS_DIRECTORY/.oauth-token-encryption-keyring.XXXXXX")"
  trap 'rm -f -- "$keyring_temporary"' EXIT
  printf '{"%s":"%s"}\n' "$OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID" "$oauth_token_key" >"$keyring_temporary"
  chmod 600 "$keyring_temporary"
  mv "$keyring_temporary" "$keyring_path"
  trap - EXIT
  printf 'Generated the missing OAuth token encryption keyring without changing existing Compose secrets.\n' >&2
elif [[ ! -f "$keyring_path" || -L "$keyring_path" || ! -s "$keyring_path" ]]; then
  echo "the OAuth token encryption keyring must be a non-empty regular file: $keyring_path" >&2
  exit 1
fi

if [[ -x "$script_directory/backup.sh" ]]; then
  backup_command="$script_directory/backup.sh"
else
  backup_command="$script_directory/backup-compose.sh"
fi
backup_path="$("$backup_command" "$environment_file" "$BACKUP_DIRECTORY")"

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
