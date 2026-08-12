#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 2 ]]; then
  echo "usage: $0 [ENV_FILE] [BACKUP_DIRECTORY]" >&2
  exit 64
fi

environment_file="${1:-.env.secrets}"
requested_backup_directory="${2:-}"
command -v docker >/dev/null 2>&1 || {
  echo "required command is unavailable: docker" >&2
  exit 69
}

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/compose-deployment.sh" ]]; then
  # shellcheck disable=SC1091
  source "$script_directory/compose-deployment.sh"
else
  # shellcheck disable=SC1091
  source "$script_directory/../scripts/compose-deployment.sh"
fi
compose_deployment_load "$script_directory" "$environment_file"
compose_deployment_resolve_project_name
compose_deployment_command
environment_file="$COMPOSE_DEPLOYMENT_ENV_FILE"
backup_directory="$BACKUP_DIRECTORY"
if [[ -n "$requested_backup_directory" ]]; then
  backup_directory="$(compose_deployment_resolve_path \
    "$COMPOSE_DEPLOYMENT_DIRECTORY" "$requested_backup_directory")"
fi
: "${DATABASE_NAME:?DATABASE_NAME must be set in $environment_file}"
: "${DATABASE_USER:?DATABASE_USER must be set in $environment_file}"

mkdir -p "$backup_directory"
chmod 700 "$backup_directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_directory/canvas-seb-$timestamp.dump"
metadata_path="$backup_path.metadata"
compose=("${COMPOSE_DEPLOYMENT_COMMAND[@]}")

"${compose[@]}" exec -T postgres \
  pg_dump --format=custom --no-owner --no-privileges \
  --username="$DATABASE_USER" --dbname="$DATABASE_NAME" >"$backup_path"
[[ -s "$backup_path" ]] || {
  rm -f "$backup_path"
  echo "database backup is empty" >&2
  exit 1
}
"${compose[@]}" exec -T postgres pg_restore --list <"$backup_path" >/dev/null

cat >"$metadata_path" <<EOF
CREATED_AT=$timestamp
DATABASE_NAME=$DATABASE_NAME
DATABASE_USER=$DATABASE_USER
APP_IMAGE=${APP_IMAGE:-unknown}
EOF
chmod 600 "$backup_path" "$metadata_path"
printf '%s\n' "$backup_path"
