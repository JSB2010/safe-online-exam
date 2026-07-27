#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 2 ]]; then
  echo "usage: $0 [ENV_FILE] [BACKUP_DIRECTORY]" >&2
  exit 64
fi

environment_file="${1:-.env.secrets}"
backup_directory="${2:-backups}"
[[ -f "$environment_file" && ! -L "$environment_file" ]] || {
  echo "configuration file must be a regular file: $environment_file" >&2
  exit 64
}
command -v docker >/dev/null 2>&1 || {
  echo "required command is unavailable: docker" >&2
  exit 69
}

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a
: "${DATABASE_NAME:?DATABASE_NAME must be set in $environment_file}"
: "${DATABASE_USER:?DATABASE_USER must be set in $environment_file}"

mkdir -p "$backup_directory"
chmod 700 "$backup_directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_directory/canvas-seb-$timestamp.dump"
metadata_path="$backup_path.metadata"
compose=(docker compose --env-file "$environment_file" -f compose.yaml -f compose.secrets.yaml)

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
