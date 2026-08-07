#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 2 ]]; then
  echo "usage: $0 [SECRETS_DIRECTORY] [CLIENT_IDENTITY_DIRECTORY]" >&2
  exit 64
fi

secrets_directory="${1:-./secrets}"
identity_directory="${2:-.local/seb-client-identity}"
image="${APP_IMAGE:-}"
key_id="${LTI_KEY_ID:-safe-online-exam-$(date -u +%Y-%m-%d)}"

if [[ ! "$image" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ]]; then
  echo "Set APP_IMAGE to the exact published Safe Online Exam GHCR digest before bootstrapping." >&2
  exit 64
fi
for command in docker openssl; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command is unavailable: $command" >&2
    exit 69
  }
done
if [[ -e "$secrets_directory" || -e "$identity_directory" ]]; then
  echo "Refusing to overwrite an existing secrets or client-identity directory." >&2
  exit 73
fi

mkdir -p "$secrets_directory" "$identity_directory"
chmod 700 "$secrets_directory" "$identity_directory"

openssl rand -base64 48 >"$secrets_directory/database_password"
openssl rand -base64 48 >"$secrets_directory/session_secret"
openssl rand -base64 48 >"$secrets_directory/state_encryption_key"
oauth_token_key="$(openssl rand -base64 32 | tr '/+' '_-' | tr -d '=\n')"
printf '{"primary":"%s"}\n' "$oauth_token_key" >"$secrets_directory/oauth_token_encryption_keyring"
docker run --rm --entrypoint /nodejs/bin/node "$image" \
  /app/scripts/generate-lti-private-key.mjs "$key_id" >"$secrets_directory/lti_private_key"
: >"$secrets_directory/seb_quit_password"
touch "$secrets_directory/canvas_api_client_secret"

openssl rand -base64 48 >"$identity_directory/seb-p12-password"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 \
  -subj "/CN=Safe Online Exam Configuration Encryption/O=Organization" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment,dataEncipherment" \
  -keyout "$identity_directory/seb-config-encryption.key.pem" \
  -out "$secrets_directory/seb-config-encryption.crt.pem"
openssl x509 -in "$secrets_directory/seb-config-encryption.crt.pem" \
  -outform der -out "$identity_directory/seb-config-encryption.cer"
openssl pkcs12 -export \
  -inkey "$identity_directory/seb-config-encryption.key.pem" \
  -in "$secrets_directory/seb-config-encryption.crt.pem" \
  -name "seb-config-encryption" \
  -out "$identity_directory/seb-config-encryption.p12" \
  -passout "file:$identity_directory/seb-p12-password" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1

chmod 644 "$secrets_directory"/*
chmod 600 "$identity_directory"/*

cat <<EOF
Created protected runtime secrets in: $secrets_directory
Created the client-only SEB identity in: $identity_directory

Before starting Compose:
  1. Put the Canvas API Developer Key secret in $secrets_directory/canvas_api_client_secret.
  2. Copy .env.compose.secrets.example to .env.secrets and set the Canvas/LTI values.
  3. Move the private identity directory into your approved MDM/client-deployment vault.

Never copy the .p12, private PEM, or its password into the server runtime or the GitHub Release bundle.
EOF
