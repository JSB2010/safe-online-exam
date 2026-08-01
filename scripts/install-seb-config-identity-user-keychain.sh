#!/bin/bash
#
# Installs an SEB configuration-decryption identity into the active console
# user's login keychain. This is MDM-neutral: an MDM, package, or management
# agent must run it as root only after the target user has logged in.
#
# The P12 and its passphrase file must already be root-owned and root-readable
# only. The script decrypts to a root-only temporary PEM, then streams that PEM
# to security import in the user's GUI security session. It never makes source
# key material readable by the user and never passes a P12 passphrase in argv.

set -Eeuo pipefail

readonly TEMPORARY_FAILURE=75
readonly DEFAULT_SEB_APP="/Applications/Safe Exam Browser.app"
readonly EXPECTED_SEB_TEAM_ID="6F38DNSC7X"
readonly EXPECTED_SEB_BUNDLE_ID="org.safeexambrowser.SafeExamBrowser"

P12_PATH=""
P12_PASSWORD_FILE=""
EXPECTED_CERT_SHA256=""
SEB_APP="$DEFAULT_SEB_APP"

usage() {
  cat <<'USAGE'
Usage:
  sudo bash scripts/install-seb-config-identity-user-keychain.sh \
    --p12 /root-only/path/identity.p12 \
    --password-file /root-only/path/identity-password \
    --fingerprint SHA256_HEX [--seb-app /Applications/Safe\ Exam\ Browser.app]

Run only as root after the intended standard user has logged in. The P12 and
password file must be root:wheel and mode 0600 (or stricter); do not pass a
P12, password, or login-keychain password as an MDM parameter.
USAGE
}

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

require_root_only_file() {
  local path="$1"
  local owner group mode

  [[ -f "$path" ]] || fail "Required file is missing: $path"
  owner="$(/usr/bin/stat -f '%u' "$path")"
  group="$(/usr/bin/stat -f '%g' "$path")"
  mode="$(/usr/bin/stat -f '%Lp' "$path")"
  [[ "$owner" == "0" && "$group" == "0" ]] || fail "Required file is not owned by root:wheel: $path"
  (( (8#$mode & 0077) == 0 )) || fail "Required file is readable or writable by a non-root user: $path"
}

normalize_fingerprint() {
  printf '%s' "$1" | /usr/bin/tr -d ':' | /usr/bin/tr '[:lower:]' '[:upper:]'
}

certificate_fingerprint() {
  /usr/bin/openssl x509 -noout -fingerprint -sha256 |
    /usr/bin/sed 's/^.*=//' |
    /usr/bin/tr -d ':' |
    /usr/bin/tr '[:lower:]' '[:upper:]'
}

identity_exists() {
  run_as_console_user /usr/bin/security find-identity "$LOGIN_KEYCHAIN" 2>/dev/null |
    /usr/bin/grep -F -- "$CERTIFICATE_COMMON_NAME" >/dev/null
}

while (( $# > 0 )); do
  case "$1" in
    --p12) P12_PATH="${2:-}"; shift 2 ;;
    --password-file) P12_PASSWORD_FILE="${2:-}"; shift 2 ;;
    --fingerprint) EXPECTED_CERT_SHA256="${2:-}"; shift 2 ;;
    --seb-app) SEB_APP="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; fail "Unknown argument: $1" ;;
  esac
done

[[ "${EUID:-$(/usr/bin/id -u)}" == "0" ]] || fail "This installer must run as root"
[[ -n "$P12_PATH" && -n "$P12_PASSWORD_FILE" && -n "$EXPECTED_CERT_SHA256" ]] || {
  usage >&2
  fail "P12 path, password-file path, and certificate fingerprint are required"
}

EXPECTED_CERT_SHA256="$(normalize_fingerprint "$EXPECTED_CERT_SHA256")"
[[ "$EXPECTED_CERT_SHA256" =~ ^[A-F0-9]{64}$ ]] || fail "Certificate fingerprint must be a SHA-256 hex value"
require_root_only_file "$P12_PATH"
require_root_only_file "$P12_PASSWORD_FILE"

CONSOLE_USER="$(/usr/bin/stat -f '%Su' /dev/console)"
if [[ -z "$CONSOLE_USER" || "$CONSOLE_USER" == "root" || "$CONSOLE_USER" == "loginwindow" || "$CONSOLE_USER" == "_mbsetupuser" ]]; then
  defer "No normal console user is logged in"
fi
USER_UID="$(/usr/bin/id -u "$CONSOLE_USER")"
USER_HOME="$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
[[ -n "$USER_HOME" && "$USER_HOME" == /* ]] || fail "Could not resolve the home directory for $CONSOLE_USER"
LOGIN_KEYCHAIN="$USER_HOME/Library/Keychains/login.keychain-db"
[[ -f "$LOGIN_KEYCHAIN" ]] || defer "Login keychain is not available for $CONSOLE_USER"

SEB_BINARY="$SEB_APP/Contents/MacOS/Safe Exam Browser"
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

/usr/bin/openssl pkcs12 -in "$P12_PATH" -passin "file:$P12_PASSWORD_FILE" -clcerts -nokeys -out "$CERTIFICATE_PATH" >/dev/null 2>&1 ||
  fail "The staged PKCS#12 identity could not be opened"
ACTUAL_CERT_SHA256="$(certificate_fingerprint < "$CERTIFICATE_PATH")"
[[ "$ACTUAL_CERT_SHA256" == "$EXPECTED_CERT_SHA256" ]] || fail "The staged certificate does not match the expected fingerprint"

/usr/bin/openssl pkcs12 -in "$P12_PATH" -passin "file:$P12_PASSWORD_FILE" -nodes -out "$IDENTITY_PATH" >/dev/null 2>&1 ||
  fail "Could not prepare the staged identity for import"
/bin/chmod 600 "$CERTIFICATE_PATH" "$IDENTITY_PATH"
/usr/bin/openssl pkey -in "$IDENTITY_PATH" -pubout -out "$KEY_PUBLIC_PATH" >/dev/null 2>&1 || fail "The staged identity does not contain a usable private key"
/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -pubkey -noout > "$CERTIFICATE_PUBLIC_PATH" || fail "Could not read the staged certificate public key"
/usr/bin/cmp -s "$KEY_PUBLIC_PATH" "$CERTIFICATE_PUBLIC_PATH" || fail "The staged private key does not match the staged certificate"

CERTIFICATE_COMMON_NAME="$(/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -noout -subject -nameopt RFC2253 | /usr/bin/sed -n 's/^subject=.*CN=\([^,]*\).*$/\1/p')"
[[ -n "$CERTIFICATE_COMMON_NAME" ]] || fail "Could not determine the staged certificate common name"

INSTALLED_CERTIFICATE="$(run_as_console_user /usr/bin/security find-certificate -c "$CERTIFICATE_COMMON_NAME" -p "$LOGIN_KEYCHAIN" 2>/dev/null || true)"
if [[ -n "$INSTALLED_CERTIFICATE" ]]; then
  INSTALLED_CERT_SHA256="$(printf '%s' "$INSTALLED_CERTIFICATE" | certificate_fingerprint)" || fail "Could not read the existing certificate fingerprint"
  [[ "$INSTALLED_CERT_SHA256" == "$EXPECTED_CERT_SHA256" ]] || fail "A different certificate with the same common name is already present; rotate it explicitly"
fi

if ! identity_exists; then
  log "Importing the non-extractable identity into $CONSOLE_USER's login keychain"
  if ! /bin/cat "$IDENTITY_PATH" |
    run_as_console_user /usr/bin/security import /dev/stdin \
      -k "$LOGIN_KEYCHAIN" \
      -f pemseq \
      -x \
      -T "$SEB_BINARY" >/dev/null; then
    defer "macOS could not import into $CONSOLE_USER's unlocked login keychain"
  fi
fi

identity_exists || defer "macOS did not report the expected identity after import"
log "Installed a non-extractable SEB identity into $CONSOLE_USER's login keychain"
