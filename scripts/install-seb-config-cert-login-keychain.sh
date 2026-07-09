#!/bin/bash
set -euo pipefail

# Jamf parameters can override these:
#   $4 = P12_BASE64
#   $5 = P12_PASSWORD
#   $6 = optional login keychain password for silent partition-list preauthorization
CERT_CN="${CERT_CN:-SEB Canvas LTI Local Config Encryption}"
KEY_LABEL="${KEY_LABEL:-seb-config-encryption-local}"
P12_PASSWORD="${5:-${P12_PASSWORD:-seb-local-test}}"
P12_BASE64="${4:-${P12_BASE64:-PASTE_P12_BASE64_HERE}}"
LOGIN_KEYCHAIN_PASSWORD="${6:-${LOGIN_KEYCHAIN_PASSWORD:-}}"

SEB_TEAM_ID="${SEB_TEAM_ID:-6F38DNSC7X}"
SEB_APP="${SEB_APP:-/Applications/Safe Exam Browser.app}"
SEB_BINARY="$SEB_APP/Contents/MacOS/Safe Exam Browser"

log() {
  echo "[SEB cert install] $*"
}

run_as_user() {
  /bin/launchctl asuser "$USER_UID" /usr/bin/sudo -u "$CONSOLE_USER" "$@"
}

CONSOLE_USER="$(/usr/bin/stat -f '%Su' /dev/console)"
if [[ -z "$CONSOLE_USER" || "$CONSOLE_USER" == "root" || "$CONSOLE_USER" == "_mbsetupuser" ]]; then
  log "No normal logged-in user found. Run this after the student logs in."
  exit 1
fi

USER_UID="$(/usr/bin/id -u "$CONSOLE_USER")"
USER_HOME="$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
LOGIN_KEYCHAIN="$USER_HOME/Library/Keychains/login.keychain-db"

if [[ ! -x "$SEB_BINARY" ]]; then
  log "Safe Exam Browser binary not found at $SEB_BINARY"
  exit 1
fi

if [[ ! -f "$LOGIN_KEYCHAIN" ]]; then
  log "Login keychain not found at $LOGIN_KEYCHAIN"
  exit 1
fi

ACTUAL_TEAM_ID="$(/usr/bin/codesign -dv --verbose=4 "$SEB_APP" 2>&1 | /usr/bin/awk -F= '/TeamIdentifier/ {print $2; exit}')"
if [[ "$ACTUAL_TEAM_ID" != "$SEB_TEAM_ID" ]]; then
  log "Unexpected SEB TeamIdentifier: $ACTUAL_TEAM_ID"
  exit 1
fi

if run_as_user /usr/bin/security find-certificate -c "$CERT_CN" "$LOGIN_KEYCHAIN" >/dev/null 2>&1 &&
  run_as_user /usr/bin/security find-key -t private -l "$KEY_LABEL" "$LOGIN_KEYCHAIN" >/dev/null 2>&1; then
  log "Identity already installed for $CONSOLE_USER"
  exit 0
fi

TMP_DIR="$(/usr/bin/mktemp -d /private/tmp/seb-cert.XXXXXX)"
P12_PATH="$TMP_DIR/seb-config-encryption.p12"

cleanup() {
  /bin/rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log "Decoding PKCS#12 identity"
CLEAN_B64="$(printf "%s" "$P12_BASE64" | /usr/bin/sed 's/[^A-Za-z0-9+\/=]//g')"
if [[ -z "$CLEAN_B64" || "$CLEAN_B64" == "PASTE_P12_BASE64_HERE" ]]; then
  log "P12_BASE64 is not configured"
  exit 1
fi
printf "%s" "$CLEAN_B64" | /usr/bin/base64 -D > "$P12_PATH"

if [[ ! -s "$P12_PATH" ]]; then
  log "Decoded .p12 file is empty"
  exit 1
fi

/usr/sbin/chown -R "$CONSOLE_USER":staff "$TMP_DIR"
/bin/chmod 700 "$TMP_DIR"
/bin/chmod 600 "$P12_PATH"

log "Removing old partial identity if present"
while run_as_user /usr/bin/security delete-identity -c "$CERT_CN" "$LOGIN_KEYCHAIN" >/dev/null 2>&1; do
  sleep 0.2
done
while run_as_user /usr/bin/security delete-certificate -c "$CERT_CN" "$LOGIN_KEYCHAIN" >/dev/null 2>&1; do
  sleep 0.2
done

log "Importing identity into $CONSOLE_USER login keychain"
run_as_user /usr/bin/security import "$P12_PATH" \
  -k "$LOGIN_KEYCHAIN" \
  -P "$P12_PASSWORD" \
  -x \
  -T "$SEB_BINARY" \
  -T "$SEB_APP"

if [[ -n "$LOGIN_KEYCHAIN_PASSWORD" ]]; then
  log "Preauthorizing SEB private-key access with provided login keychain password"
  run_as_user /usr/bin/security set-key-partition-list \
    -S "apple-tool:,apple:,teamid:$SEB_TEAM_ID" \
    -t private \
    -l "$KEY_LABEL" \
    -k "$LOGIN_KEYCHAIN_PASSWORD" \
    "$LOGIN_KEYCHAIN" >/dev/null
else
  log "No login keychain password provided; student should choose Always Allow during the setup check"
fi

log "Verifying identity install"
run_as_user /usr/bin/security find-certificate -c "$CERT_CN" "$LOGIN_KEYCHAIN" >/dev/null
run_as_user /usr/bin/security find-key -t private -l "$KEY_LABEL" "$LOGIN_KEYCHAIN" >/dev/null
run_as_user /usr/bin/security find-identity "$LOGIN_KEYCHAIN" | /usr/bin/grep -F "$CERT_CN" >/dev/null

log "Installed SEB config encryption identity successfully for $CONSOLE_USER"
exit 0
