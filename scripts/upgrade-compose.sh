#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 2 ]]; then
  echo "usage: $0 [ENV_FILE] [--caddy]" >&2
  exit 64
fi

environment_file="${1:-.env.secrets}"
caddy_mode="${2:-}"
[[ "$caddy_mode" == "" || "$caddy_mode" == "--caddy" ]] || {
  echo "second argument must be --caddy when the Caddy profile is enabled" >&2
  exit 64
}
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
[[ "${APP_IMAGE:-}" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ]] || {
  echo "APP_IMAGE must be the exact published Safe Online Exam GHCR digest" >&2
  exit 64
}

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$script_directory/backup.sh" ]]; then
  backup_command="$script_directory/backup.sh"
else
  backup_command="$script_directory/backup-compose.sh"
fi
backup_path="$("$backup_command" "$environment_file" "${BACKUP_DIRECTORY:-backups}")"

compose=(docker compose --env-file "$environment_file" -f compose.yaml -f compose.secrets.yaml)
if [[ "$caddy_mode" == "--caddy" ]]; then
  compose+=(-f compose.caddy.yaml --profile caddy)
fi

"${compose[@]}" config --quiet
"${compose[@]}" pull
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
