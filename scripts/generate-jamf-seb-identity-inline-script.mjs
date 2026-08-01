#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [p12Path, passwordPath, outputPath] = process.argv.slice(2);

if (!p12Path || !passwordPath || !outputPath) {
  throw new Error("Usage: node scripts/generate-jamf-seb-identity-inline-script.mjs P12 PASSWORD_FILE OUTPUT_SCRIPT");
}

const p12 = readFileSync(p12Path);
const password = readFileSync(passwordPath, "utf8").replace(/[\r\n]+$/u, "");

if (p12.length === 0 || password.length === 0) {
  throw new Error("P12 or password file is empty");
}

const bashSingleQuote = (value) => `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
const certificatePem = execFileSync(
  "/usr/bin/openssl",
  ["pkcs12", "-in", p12Path, "-passin", `file:${passwordPath}`, "-clcerts", "-nokeys"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
);
const expectedFingerprint = execFileSync("/usr/bin/openssl", ["x509", "-noout", "-fingerprint", "-sha256"], {
  encoding: "utf8",
  input: certificatePem
})
  .trim()
  .replace(/^.*=/u, "")
  .replaceAll(":", "");

if (!/^[A-Fa-f0-9]{64}$/u.test(expectedFingerprint)) {
  throw new Error("Could not determine the P12 certificate SHA-256 fingerprint");
}

const script = `#!/bin/bash
#
# Jamf School direct identity installer. This file contains a private P12 and
# its passphrase. Upload it only to the restricted Jamf School Scripts area;
# never commit, email, or place it in a student-readable location.
#
# This is a root-run, one-user installer. Schedule it after the student logs
# in. It exits 75 when no normal console user/login keychain is available.

set -Eeuo pipefail

readonly P12_BASE64=${bashSingleQuote(p12.toString("base64"))}
readonly P12_PASSWORD=${bashSingleQuote(password)}
readonly EXPECTED_CERT_SHA256=${bashSingleQuote(expectedFingerprint)}
readonly SEB_APP="/Applications/Safe Exam Browser.app"
readonly SEB_BINARY="$SEB_APP/Contents/MacOS/Safe Exam Browser"
readonly EXPECTED_SEB_TEAM_ID="6F38DNSC7X"
readonly EXPECTED_SEB_BUNDLE_ID="org.safeexambrowser.SafeExamBrowser"
readonly TEMPORARY_FAILURE=75

log() {
  /usr/bin/logger -t safe-online-exam-seb-identity -- "$*"
  printf '%s\\n' "[SEB identity] $*"
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
  log "ERROR: unexpected installer failure near line \${BASH_LINENO[0]:-unknown} (status $status)"
  exit "$status"
}

cleanup() {
  if [[ -n "\${TEMPORARY_DIRECTORY:-}" && -d "$TEMPORARY_DIRECTORY" ]]; then
    /bin/rm -rf "$TEMPORARY_DIRECTORY" || true
  fi
}
trap cleanup EXIT
trap on_error ERR

run_as_console_user() {
  /bin/launchctl asuser "$USER_UID" /usr/bin/sudo -u "$CONSOLE_USER" "$@"
}

[[ "\${EUID:-$(/usr/bin/id -u)}" == "0" ]] || fail "This Jamf script must run as root"

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
P12_PATH="$TEMPORARY_DIRECTORY/identity.p12"
PASSWORD_PATH="$TEMPORARY_DIRECTORY/password"
CERTIFICATE_PATH="$TEMPORARY_DIRECTORY/certificate.pem"
IDENTITY_PATH="$TEMPORARY_DIRECTORY/identity.pem"
KEY_PUBLIC_PATH="$TEMPORARY_DIRECTORY/private-key-public.pem"
CERTIFICATE_PUBLIC_PATH="$TEMPORARY_DIRECTORY/certificate-public.pem"

printf '%s' "$P12_BASE64" | /usr/bin/base64 -D > "$P12_PATH" || fail "Embedded P12 could not be decoded"
printf '%s' "$P12_PASSWORD" > "$PASSWORD_PATH"
/bin/chmod 600 "$P12_PATH" "$PASSWORD_PATH"

/usr/bin/openssl pkcs12 -in "$P12_PATH" -passin "file:$PASSWORD_PATH" -clcerts -nokeys -out "$CERTIFICATE_PATH" >/dev/null 2>&1 ||
  fail "Embedded P12 could not be opened"
ACTUAL_CERT_SHA256="$(/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -noout -fingerprint -sha256 | /usr/bin/sed 's/^.*=//' | /usr/bin/tr -d ':')"
ACTUAL_CERT_SHA256_UPPER="$(printf '%s' "$ACTUAL_CERT_SHA256" | /usr/bin/tr '[:lower:]' '[:upper:]')"
[[ "$ACTUAL_CERT_SHA256_UPPER" == "$EXPECTED_CERT_SHA256" ]] || fail "Embedded certificate fingerprint mismatch"

/usr/bin/openssl pkcs12 -in "$P12_PATH" -passin "file:$PASSWORD_PATH" -nodes -out "$IDENTITY_PATH" >/dev/null 2>&1 ||
  fail "Could not prepare the identity for import"
/bin/chmod 600 "$CERTIFICATE_PATH" "$IDENTITY_PATH"
/usr/bin/openssl pkey -in "$IDENTITY_PATH" -pubout -out "$KEY_PUBLIC_PATH" >/dev/null 2>&1 || fail "Identity does not contain a private key"
/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -pubkey -noout > "$CERTIFICATE_PUBLIC_PATH" || fail "Could not read the certificate public key"
/usr/bin/cmp -s "$KEY_PUBLIC_PATH" "$CERTIFICATE_PUBLIC_PATH" || fail "Private key does not match certificate"

CERTIFICATE_COMMON_NAME="$(/usr/bin/openssl x509 -in "$CERTIFICATE_PATH" -noout -subject -nameopt RFC2253 | /usr/bin/sed -n 's/^subject=.*CN=\\([^,]*\\).*$/\\1/p')"
[[ -n "$CERTIFICATE_COMMON_NAME" ]] || fail "Could not determine certificate common name"

if run_as_console_user /usr/bin/security find-identity "$LOGIN_KEYCHAIN" 2>/dev/null | /usr/bin/grep -F -- "$CERTIFICATE_COMMON_NAME" >/dev/null; then
  log "Matching identity is already present in $CONSOLE_USER's login keychain"
  exit 0
fi

# The PEM remains root-only on disk and is streamed directly to the active
# user's security session. security receives no passphrase argument. -x makes
# the imported key non-extractable; -T permits automatic access only for the
# validated SEB executable.
if ! /bin/cat "$IDENTITY_PATH" |
  run_as_console_user /usr/bin/security import /dev/stdin \\
    -k "$LOGIN_KEYCHAIN" \\
    -f pemseq \\
    -x \\
    -T "$SEB_BINARY" >/dev/null; then
  defer "macOS could not import into $CONSOLE_USER's unlocked login keychain"
fi

run_as_console_user /usr/bin/security find-identity "$LOGIN_KEYCHAIN" 2>/dev/null | /usr/bin/grep -F -- "$CERTIFICATE_COMMON_NAME" >/dev/null ||
  defer "macOS did not report the expected identity after import"
log "Installed a non-extractable SEB identity into $CONSOLE_USER's login keychain"
`;

writeFileSync(outputPath, script, { encoding: "utf8", mode: 0o700 });
chmodSync(outputPath, 0o700);
console.log(`Created secret-bearing Jamf script at ${outputPath}`);
console.log(`Embedded certificate SHA-256: ${expectedFingerprint}`);
