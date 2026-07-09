#!/bin/bash
set -Eeuo pipefail

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

die() {
  log "ERROR: $*"
  exit 1
}

on_error() {
  local status=$?
  local line=${BASH_LINENO[0]:-unknown}
  log "ERROR: install failed near line $line with exit status $status"
  exit "$status"
}

trap on_error ERR

run_as_user() {
  /bin/launchctl asuser "$USER_UID" /usr/bin/sudo -u "$CONSOLE_USER" "$@"
}

CONSOLE_USER="$(/usr/bin/stat -f '%Su' /dev/console)"
if [[ -z "$CONSOLE_USER" || "$CONSOLE_USER" == "root" || "$CONSOLE_USER" == "_mbsetupuser" ]]; then
  die "No normal logged-in user found. This login-keychain install must run after the student logs in."
fi

USER_UID="$(/usr/bin/id -u "$CONSOLE_USER")"
USER_HOME="$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory | /usr/bin/awk '{print $2}')"
LOGIN_KEYCHAIN="$USER_HOME/Library/Keychains/login.keychain-db"

log "Starting SEB config encryption identity install for $CONSOLE_USER"
log "Using login keychain: $LOGIN_KEYCHAIN"

if [[ ! -f "$LOGIN_KEYCHAIN" ]]; then
  die "Login keychain not found at $LOGIN_KEYCHAIN"
fi

SEB_INSTALLED=false
IMPORT_TRUST_ARGS=()
if [[ -x "$SEB_BINARY" ]]; then
  SEB_INSTALLED=true
  log "Safe Exam Browser found at $SEB_APP"
  ACTUAL_TEAM_ID="$(/usr/bin/codesign -dv --verbose=4 "$SEB_APP" 2>&1 | /usr/bin/awk -F= '/TeamIdentifier/ {print $2; exit}')"
  if [[ -z "$ACTUAL_TEAM_ID" ]]; then
    die "Could not read Safe Exam Browser TeamIdentifier from $SEB_APP"
  fi
  if [[ "$ACTUAL_TEAM_ID" != "$SEB_TEAM_ID" ]]; then
    die "Unexpected SEB TeamIdentifier: $ACTUAL_TEAM_ID (expected $SEB_TEAM_ID)"
  fi
  IMPORT_TRUST_ARGS=(-T "$SEB_BINARY" -T "$SEB_APP")
else
  log "Safe Exam Browser is not installed at $SEB_APP yet"
  log "Continuing without app-path trust entries; Team ID preauthorization can still be applied if a login keychain password is provided"
fi

IDENTITY_PRESENT=false
if run_as_user /usr/bin/security find-certificate -c "$CERT_CN" "$LOGIN_KEYCHAIN" >/dev/null 2>&1 &&
  run_as_user /usr/bin/security find-key -t private -l "$KEY_LABEL" "$LOGIN_KEYCHAIN" >/dev/null 2>&1; then
  log "Identity already installed for $CONSOLE_USER"
  IDENTITY_PRESENT=true
fi

TMP_DIR="$(/usr/bin/mktemp -d /private/tmp/seb-cert.XXXXXX)"
P12_PATH="$TMP_DIR/seb-config-encryption.p12"

cleanup() {
  /bin/rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if [[ "$IDENTITY_PRESENT" == "false" ]]; then
  log "Decoding PKCS#12 identity"
  CLEAN_B64="$(printf "%s" "$P12_BASE64" | /usr/bin/sed 's/[^A-Za-z0-9+\/=]//g')"
  if [[ -z "$CLEAN_B64" || "$CLEAN_B64" == "PASTE_P12_BASE64_HERE" ]]; then
    die "P12_BASE64 is not configured"
  fi
  if ! printf "%s" "$CLEAN_B64" | /usr/bin/base64 -D > "$P12_PATH"; then
    die "Could not decode P12_BASE64. Check for truncated or malformed Jamf parameter input."
  fi

  if [[ ! -s "$P12_PATH" ]]; then
    die "Decoded .p12 file is empty"
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

  if [[ "$SEB_INSTALLED" == "true" ]]; then
    log "Importing identity into $CONSOLE_USER login keychain with SEB app trust entries"
  else
    log "Importing identity into $CONSOLE_USER login keychain before SEB is installed"
  fi
  run_as_user /usr/bin/security import "$P12_PATH" \
    -k "$LOGIN_KEYCHAIN" \
    -P "$P12_PASSWORD" \
    -x \
    "${IMPORT_TRUST_ARGS[@]}"
fi

if [[ -n "$LOGIN_KEYCHAIN_PASSWORD" ]]; then
  log "Preauthorizing SEB private-key access with provided login keychain password"
  run_as_user /usr/bin/security set-key-partition-list \
    -S "apple-tool:,apple:,teamid:$SEB_TEAM_ID" \
    -t private \
    -l "$KEY_LABEL" \
    -k "$LOGIN_KEYCHAIN_PASSWORD" \
    "$LOGIN_KEYCHAIN" >/dev/null
else
  if [[ "$SEB_INSTALLED" == "true" ]]; then
    log "No login keychain password provided; student may need to choose Always Allow during the setup check"
  else
    log "No login keychain password provided and SEB is not installed yet; run this policy again after SEB installs, or have the student choose Always Allow during the setup check"
  fi
fi

log "Verifying identity install"
run_as_user /usr/bin/security find-certificate -c "$CERT_CN" "$LOGIN_KEYCHAIN" >/dev/null
run_as_user /usr/bin/security find-key -t private -l "$KEY_LABEL" "$LOGIN_KEYCHAIN" >/dev/null
run_as_user /usr/bin/security find-identity "$LOGIN_KEYCHAIN" | /usr/bin/grep -F "$CERT_CN" >/dev/null

if [[ "$SEB_INSTALLED" == "true" ]]; then
  log "Installed SEB config encryption identity successfully for $CONSOLE_USER; SEB app was present"
else
  log "Installed SEB config encryption identity successfully for $CONSOLE_USER; SEB app can be installed later"
fi
exit 0
