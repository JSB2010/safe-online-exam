#!/bin/bash
#
# Installs a staged SEB configuration-decryption identity into the active
# console user's login keychain. This program is intended to be run only by
# the root LaunchDaemon installed by build-jamf-seb-identity-package.sh.
#
# Threat boundary: this protects the source P12/passphrase from standard
# users and makes the imported key non-extractable. It cannot stop the
# approved SEB process from using the key, nor protect a Mac controlled by a
# local administrator or a user who can remove device management.

set -Eeuo pipefail

readonly INSTALL_DIRECTORY="/Library/Application Support/SafeOnlineExam/SEBIdentity"
readonly CONFIG_PATH="$INSTALL_DIRECTORY/identity.conf"
readonly P12_PATH="$INSTALL_DIRECTORY/seb-config-encryption.p12"
readonly P12_PASSWORD_PATH="$INSTALL_DIRECTORY/seb-config-encryption-password"
readonly SEB_APP="${SEB_APP:-/Applications/Safe Exam Browser.app}"
readonly SEB_BINARY="$SEB_APP/Contents/MacOS/Safe Exam Browser"
readonly EXPECTED_SEB_TEAM_ID="${EXPECTED_SEB_TEAM_ID:-6F38DNSC7X}"
readonly EXPECTED_SEB_BUNDLE_ID="${EXPECTED_SEB_BUNDLE_ID:-org.safeexambrowser.SafeExamBrowser}"
readonly COMPLETION_MARKER="$INSTALL_DIRECTORY/completed"
readonly TEMPORARY_FAILURE=75

log() {
  /usr/bin/logger -t safe-online-exam-seb-identity -- "$*"
  printf '%s\n' "[SEB identity] $*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

defer() {
  log "DEFERRED: $*"
  exit "$TEMPORARY_FAILURE"
}

on_error() {
  local status=$?
  log "ERROR: unexpected installer failure near line ${BASH_LINENO[0]:-unknown} (status $status)"
  exit "$status"
}

cleanup() {
  if [[ -n "${TEMPORARY_DIRECTORY:-}" && -d "$TEMPORARY_DIRECTORY" ]]; then
    /bin/rm -rf "$TEMPORARY_DIRECTORY" || true
  fi
}
trap cleanup EXIT
trap on_error ERR

run_as_console_user() {
  /bin/launchctl asuser "$USER_UID" /usr/bin/sudo -u "$CONSOLE_USER" "$@"
}

require_root_only() {
  local path="$1"
  local expected_type="$2"
  local owner group mode

  [[ -e "$path" ]] || fail "Required staged artifact is missing: $path"
  [[ "$expected_type" == "directory" && -d "$path" ]] ||
    [[ "$expected_type" == "file" && -f "$path" ]] ||
    fail "Staged artifact has an unexpected type: $path"

  owner="$(/usr/bin/stat -f '%u' "$path")"
  group="$(/usr/bin/stat -f '%g' "$path")"
  mode="$(/usr/bin/stat -f '%Lp' "$path")"
  [[ "$owner" == "0" && "$group" == "0" ]] || fail "Staged artifact is not owned by root:wheel: $path"
  (( (8#$mode & 0077) == 0 )) || fail "Staged artifact is readable or writable by a non-root user: $path"
}

require_root_only "$INSTALL_DIRECTORY" directory
require_root_only "$CONFIG_PATH" file
require_root_only "$P12_PATH" file
require_root_only "$P12_PASSWORD_PATH" file

# shellcheck source=/dev/null
source "$CONFIG_PATH"

EXPECTED_CERT_SHA256="${EXPECTED_CERT_SHA256:-}"
[[ "$EXPECTED_CERT_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || fail "identity.conf does not contain a SHA-256 certificate fingerprint"

if [[ -f "$COMPLETION_MARKER" ]]; then
  log "Identity installation was already completed"
  exit 0
fi

CONSOLE_USER="$(/usr/bin/stat -f '%Su' /dev/console)"
if [[ -z "$CONSOLE_USER" || "$CONSOLE_USER" == "root" || "$CONSOLE_USER" == "loginwindow" || "$CONSOLE_USER" == "_mbsetupuser" ]]; then
  defer "No normal console user is logged in"
fi

USER_UID="$(/usr/bin/id -u "$CONSOLE_USER")"
USER_HOME="$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
[[ -n "$USER_HOME" && "$USER_HOME" == /* ]] || fail "Could not resolve the home directory for $CONSOLE_USER"
LOGIN_KEYCHAIN="$USER_HOME/Library/Keychains/login.keychain-db"
[[ -f "$LOGIN_KEYCHAIN" ]] || defer "Login keychain is not available for $CONSOLE_USER"

[[ -x "$SEB_BINARY" ]] || defer "Safe Exam Browser is not installed at the approved path"
ACTUAL_SEB_BUNDLE_ID="$(/usr/bin/codesign -dv --verbose=4 "$SEB_APP" 2>&1 | /usr/bin/sed -n 's/^Identifier=//p')"
ACTUAL_SEB_TEAM_ID="$(/usr/bin/codesign -dv --verbose=4 "$SEB_APP" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p')"
[[ "$ACTUAL_SEB_BUNDLE_ID" == "$EXPECTED_SEB_BUNDLE_ID" ]] || fail "Unexpected Safe Exam Browser bundle identifier: $ACTUAL_SEB_BUNDLE_ID"
[[ "$ACTUAL_SEB_TEAM_ID" == "$EXPECTED_SEB_TEAM_ID" ]] || fail "Unexpected Safe Exam Browser TeamIdentifier: $ACTUAL_SEB_TEAM_ID"

TEMPORARY_DIRECTORY="$(/usr/bin/mktemp -d /private/tmp/safe-online-exam-seb-identity.XXXXXX)"
/bin/chmod 700 "$TEMPORARY_DIRECTORY"
CERTIFICATE_PATH="$TEMPORARY_DIRECTORY/certificate.pem"
IDENTITY_PATH="$TEMPORARY_DIRECTORY/identity.pem"
KEY_PUBLIC_PATH="$TEMPORARY_DIRECTORY/private-key-public.pem"
CERTIFICATE_PUBLIC_PATH="$TEMPORARY_DIRECTORY/certificate-public.pem"

/usr/bin/openssl pkcs12 \
  -in "$P12_PATH" \
  -passin "file:$P12_PASSWORD_PATH" \
  -clcerts \
  -nokeys \
  -out "$CERTIFICATE_PATH" >/dev/null 2>&1 || fail "The staged PKCS#12 identity could not be opened"

ACTUAL_CERT_SHA256="$(/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -noout -fingerprint -sha256 | /usr/bin/sed 's/^.*=//' | /usr/bin/tr -d ':')"
ACTUAL_CERT_SHA256_UPPER="$(printf '%s' "$ACTUAL_CERT_SHA256" | /usr/bin/tr '[:lower:]' '[:upper:]')"
EXPECTED_CERT_SHA256_UPPER="$(printf '%s' "$EXPECTED_CERT_SHA256" | /usr/bin/tr '[:lower:]' '[:upper:]')"
[[ "$ACTUAL_CERT_SHA256_UPPER" == "$EXPECTED_CERT_SHA256_UPPER" ]] || fail "The staged certificate does not match the package fingerprint"

/usr/bin/openssl pkcs12 \
  -in "$P12_PATH" \
  -passin "file:$P12_PASSWORD_PATH" \
  -nodes \
  -out "$IDENTITY_PATH" >/dev/null 2>&1 || fail "Could not prepare the staged identity for import"
/bin/chmod 600 "$CERTIFICATE_PATH" "$IDENTITY_PATH"

/usr/bin/openssl pkey -in "$IDENTITY_PATH" -pubout -out "$KEY_PUBLIC_PATH" >/dev/null 2>&1 || fail "The staged identity does not contain a usable private key"
/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -pubkey -noout > "$CERTIFICATE_PUBLIC_PATH" || fail "Could not read the staged certificate public key"
/usr/bin/cmp -s "$KEY_PUBLIC_PATH" "$CERTIFICATE_PUBLIC_PATH" || fail "The staged private key does not match the staged certificate"

CERTIFICATE_COMMON_NAME="$(/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -noout -subject -nameopt RFC2253 | /usr/bin/sed -n 's/^subject=.*CN=\([^,]*\).*$/\1/p')"
[[ -n "$CERTIFICATE_COMMON_NAME" ]] || fail "Could not determine the staged certificate common name"

if run_as_console_user /usr/bin/security find-identity "$LOGIN_KEYCHAIN" 2>/dev/null | /usr/bin/grep -F -- "$CERTIFICATE_COMMON_NAME" >/dev/null; then
  log "Matching identity is already present in $CONSOLE_USER's login keychain"
else
  # The PEM remains root-only on disk and is streamed directly to the active
  # user's security session. This avoids both a user-readable source file and
  # passing the P12 passphrase in argv.
  # -x marks the imported private key non-extractable; -T grants automatic
  # access only to the validated SEB executable. Do not add -A or broad
  # key-partition-list entries here.
  if ! /bin/cat "$IDENTITY_PATH" |
    run_as_console_user /usr/bin/security import /dev/stdin \
      -k "$LOGIN_KEYCHAIN" \
      -f pemseq \
      -x \
      -T "$SEB_BINARY" >/dev/null; then
    defer "macOS could not import into $CONSOLE_USER's unlocked login keychain"
  fi
fi

run_as_console_user /usr/bin/security find-identity "$LOGIN_KEYCHAIN" 2>/dev/null | /usr/bin/grep -F -- "$CERTIFICATE_COMMON_NAME" >/dev/null ||
  defer "macOS did not report the expected identity after import"

/usr/bin/install -d -o root -g wheel -m 700 "$INSTALL_DIRECTORY"
{
  printf 'user=%s\n' "$CONSOLE_USER"
  printf 'uid=%s\n' "$USER_UID"
  printf 'certificate_sha256=%s\n' "$ACTUAL_CERT_SHA256_UPPER"
  printf 'installed_at=%s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$COMPLETION_MARKER"
/usr/sbin/chown root:wheel "$COMPLETION_MARKER"
/bin/chmod 600 "$COMPLETION_MARKER"

# The source P12 and passphrase are not needed after a successful one-user
# installation. Keep only a non-secret audit marker. A rotation/new user is a
# new signed package deployment, not a re-use of this device's source files.
/bin/rm -f "$P12_PATH" "$P12_PASSWORD_PATH"
log "Installed a non-extractable SEB identity into $CONSOLE_USER's login keychain"
