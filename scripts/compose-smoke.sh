#!/usr/bin/env bash
set -euo pipefail

project_name="safe-online-exam-compose-smoke"
image="safe-online-exam:compose-smoke"
temporary_directory="$(mktemp -d)"
environment_file="$temporary_directory/.env"
secrets_directory="$temporary_directory/secrets"
compose_command=(
  docker compose --env-file "$environment_file" -p "$project_name"
  -f compose.yaml -f compose.secrets.yaml
)

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    "${compose_command[@]}" logs app migrate postgres >&2 || true
  fi
  "${compose_command[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
  return "$status"
}

trap cleanup EXIT
mkdir -p "$secrets_directory"

openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj "/CN=Safe Online Exam Compose Smoke" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,keyEncipherment,dataEncipherment" \
  -keyout "$temporary_directory/certificate-private-key.pem" \
  -out "$secrets_directory/seb-config-encryption.crt.pem" >/dev/null 2>&1
lti_private_key="$(node scripts/generate-lti-private-key.mjs compose-smoke)"
printf '%s' "$lti_private_key" >"$secrets_directory/lti_private_key"
printf '%s' "compose-api-secret" >"$secrets_directory/canvas_api_client_secret"
printf '%s' "compose-database-password" >"$secrets_directory/database_password"
printf '%s' "ssssssssssssssssssssssssssssssssssssssssssssssss" >"$secrets_directory/session_secret"
printf '%s' "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk" >"$secrets_directory/state_encryption_key"
: >"$secrets_directory/seb_quit_password"
chmod 700 "$secrets_directory"
chmod 644 "$secrets_directory"/*

cat >"$environment_file" <<EOF
APP_IMAGE=$image
APP_ENV_FILE=$environment_file
BIND_ADDRESS=127.0.0.1
APP_PORT=18080
SECRETS_DIRECTORY=$secrets_directory
NODE_ENV=production
APP_ENV=prod
HOST=0.0.0.0
PORT=8080
TOOL_URL=https://tool.example.edu
CANVAS_DOMAIN=https://school.instructure.com
CANVAS_REDIRECT_URI=https://tool.example.edu/api/oauth2callback
LTI_CLIENT_ID=compose-client
LTI_DEPLOYMENT_ID=compose-deployment
CANVAS_API_CLIENT_ID=compose-api-client
DATABASE_NAME=canvas_seb
DATABASE_USER=canvas_seb
DATABASE_SSL_MODE=disable
DATABASE_POOL_MAX=5
DATABASE_CONNECTION_TIMEOUT_MS=10000
DATABASE_STATEMENT_TIMEOUT_MS=30000
SEB_CONFIG_ENCRYPTION_ENABLED=true
APP_DEBUG_ENABLED=false
APP_DETECTOR_DIAGNOSTICS_ENABLED=false
EOF
chmod 600 "$environment_file"

docker build --tag "$image" .
"${compose_command[@]}" up --detach --wait
curl --fail --silent --show-error http://127.0.0.1:18080/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:18080/ready >/dev/null

"${compose_command[@]}" exec -T postgres \
  psql -U canvas_seb -d canvas_seb -v ON_ERROR_STOP=1 -c \
  "INSERT INTO courses (id, course_id, document) VALUES ('compose-smoke', 'compose-smoke', '{\"id\":\"compose-smoke\",\"courseId\":\"compose-smoke\"}'::jsonb);" >/dev/null

"${compose_command[@]}" restart app >/dev/null
for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:18080/ready >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:18080/ready >/dev/null

persisted="$({ "${compose_command[@]}" exec -T postgres \
  psql -U canvas_seb -d canvas_seb -Atc "SELECT count(*) FROM courses WHERE id = 'compose-smoke';"; } | tr -d '\r')"
test "$persisted" = "1"
