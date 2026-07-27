#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [CLOUDRUN_ENV_FILE]" >&2
  exit 64
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/cloud-run-config.sh" ]]; then
  # Release bundle layout.
  # shellcheck disable=SC1091
  source "$script_directory/cloud-run-config.sh"
else
  # Source repository layout.
  # shellcheck disable=SC1091
  source "$script_directory/../deploy/cloud-run-config.sh"
fi

cloudrun_load_environment "${1:-cloudrun.env}"
cloudrun_validate_base
cloudrun_require_commands docker jq openssl

if [[ -e "$BOOTSTRAP_DIRECTORY" || -e "$CLIENT_IDENTITY_DIRECTORY" ]]; then
  cloudrun_die "refusing to overwrite an existing bootstrap or client-identity directory"
fi

mkdir -p "$BOOTSTRAP_DIRECTORY" "$CLIENT_IDENTITY_DIRECTORY"
chmod 700 "$BOOTSTRAP_DIRECTORY" "$CLIENT_IDENTITY_DIRECTORY"

printf '%s' "$CANVAS_DOMAIN" >"$BOOTSTRAP_DIRECTORY/canvas_domain"
printf '%s' "$CANVAS_API_CLIENT_ID" >"$BOOTSTRAP_DIRECTORY/canvas_api_client_id"
: >"$BOOTSTRAP_DIRECTORY/canvas_api_client_secret"
printf '%s' "$TOOL_URL" >"$BOOTSTRAP_DIRECTORY/tool_url"
printf '%s' "bootstrap-pending" >"$BOOTSTRAP_DIRECTORY/lti_client_id"
printf '%s' "bootstrap-pending" >"$BOOTSTRAP_DIRECTORY/lti_deployment_id"
openssl rand -base64 48 >"$BOOTSTRAP_DIRECTORY/database_password"
openssl rand -base64 48 >"$BOOTSTRAP_DIRECTORY/session_secret"
openssl rand -base64 48 >"$BOOTSTRAP_DIRECTORY/state_encryption_key"
docker run --rm --entrypoint /nodejs/bin/node "$APP_IMAGE" \
  /app/scripts/generate-lti-private-key.mjs "safe-online-exam-$APP_VERSION" \
  >"$BOOTSTRAP_DIRECTORY/lti_private_key"

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
  -subj "/CN=Safe Online Exam Configuration Encryption/O=Organization" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment,dataEncipherment" \
  -keyout "$CLIENT_IDENTITY_DIRECTORY/seb-config-encryption.key.pem" \
  -out "$BOOTSTRAP_DIRECTORY/seb-config-encryption.crt.pem"
openssl x509 -in "$BOOTSTRAP_DIRECTORY/seb-config-encryption.crt.pem" \
  -outform der -out "$CLIENT_IDENTITY_DIRECTORY/seb-config-encryption.cer"
openssl rand -base64 48 >"$CLIENT_IDENTITY_DIRECTORY/seb-p12-password"
openssl pkcs12 -export \
  -inkey "$CLIENT_IDENTITY_DIRECTORY/seb-config-encryption.key.pem" \
  -in "$BOOTSTRAP_DIRECTORY/seb-config-encryption.crt.pem" \
  -name "seb-config-encryption" \
  -out "$CLIENT_IDENTITY_DIRECTORY/seb-config-encryption.p12" \
  -passout "file:$CLIENT_IDENTITY_DIRECTORY/seb-p12-password" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1

cat >"$BOOTSTRAP_DIRECTORY/bootstrap-metadata.env" <<EOF
APP_VERSION=$APP_VERSION
APP_IMAGE=$APP_IMAGE
LTI_KEY_ID=safe-online-exam-$APP_VERSION
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 600 "$BOOTSTRAP_DIRECTORY"/* "$CLIENT_IDENTITY_DIRECTORY"/*

cat <<EOF
Created protected Cloud Run bootstrap values in:
  $BOOTSTRAP_DIRECTORY

Created the client-only SEB identity in:
  $CLIENT_IDENTITY_DIRECTORY

Next: run ./prepare.sh (or scripts/prepare-cloud-run.sh in a source checkout).
It will reserve the stable service URL and prepare the selected Cloud SQL
instance. Never upload the .p12, private PEM, or its password to the server.
EOF
