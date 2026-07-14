#!/usr/bin/env bash
set -euo pipefail
umask 077

OUT_DIR="${1:-.local/seb-certs}"
NAME="${SEB_CERT_NAME:-seb-config-encryption-local}"
P12_PASSWORD_FILE="${SEB_CERT_P12_PASSWORD_FILE:-${2:-}}"
SUBJECT="${SEB_CERT_SUBJECT:-/CN=SEB Canvas LTI Local Config Encryption/O=Local Development}"
DAYS="${SEB_CERT_DAYS:-3650}"

if [[ -z "$P12_PASSWORD_FILE" || ! -f "$P12_PASSWORD_FILE" || ! -s "$P12_PASSWORD_FILE" ]]; then
  echo "Set SEB_CERT_P12_PASSWORD_FILE or pass a non-empty admin-readable password file as argument 2." >&2
  exit 64
fi

mkdir -p "$OUT_DIR"

KEY_PATH="$OUT_DIR/$NAME.key.pem"
CERT_PATH="$OUT_DIR/$NAME.crt.pem"
DER_PATH="$OUT_DIR/$NAME.cer"
P12_PATH="$OUT_DIR/$NAME.p12"
EXT_PATH="$(mktemp)"

cleanup() {
  rm -f "$EXT_PATH"
}
trap cleanup EXIT

cat >"$EXT_PATH" <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment,dataEncipherment
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EOF

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -days "$DAYS" \
  -nodes \
  -subj "$SUBJECT" \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -extensions v3_req \
  -config <(printf '[req]\ndistinguished_name=req_distinguished_name\n[v3_req]\n%s\n[req_distinguished_name]\n' "$(cat "$EXT_PATH")")

openssl x509 -in "$CERT_PATH" -outform der -out "$DER_PATH"
openssl pkcs12 \
  -export \
  -inkey "$KEY_PATH" \
  -in "$CERT_PATH" \
  -name "$NAME" \
  -out "$P12_PATH" \
  -passout "file:$P12_PASSWORD_FILE" \
  -keypbe PBE-SHA1-3DES \
  -certpbe PBE-SHA1-3DES \
  -macalg sha1

chmod 600 "$KEY_PATH" "$P12_PATH"

cat <<EOF
Generated SEB config encryption identity:

  Public cert PEM: $CERT_PATH
  Public cert DER: $DER_PATH
  Private key PEM: $KEY_PATH
  Keychain identity: $P12_PATH

Use this app env for local testing:

  SEB_CONFIG_ENCRYPTION_ENABLED=true
  SEB_CONFIG_ENCRYPTION_CERT_PATH=$CERT_PATH

Deploy this identity with an MDM Certificates payload configured with
KeyIsExtractable=false and AllowAllAppsAccess=false, or use an authorized
technician workflow. Do not pass PKCS#12 or keychain passwords in script
arguments, environment values, or process command lines.

The .p12 contains the private key. Do not publish it.
EOF
