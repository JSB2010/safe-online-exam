#!/bin/bash
# Build a signed Jamf School package that installs the SEB client identity
# through the root LaunchDaemon installer. Password material is supplied only
# as a root-readable input file; it is never a package argument or log value.

set -Eeuo pipefail

usage() {
  printf '%s\n' \
    'Usage:' \
    '  sudo bash scripts/build-jamf-seb-identity-package.sh \' \
    '    --p12 /secure/path/seb-config-encryption.p12 \' \
    '    --password-file /secure/path/seb-p12-password \' \
    '    --output /secure/path/safe-online-exam-seb-identity.pkg \' \
    '    --sign "Developer ID Installer: Organization (TEAMID)"' \
    '' \
    'The output package contains a private identity and must be handled as a secret.'
}

P12_INPUT=""
PASSWORD_INPUT=""
OUTPUT_PACKAGE=""
SIGNING_IDENTITY=""
PACKAGE_VERSION="1.0.0"

while (( $# > 0 )); do
  case "$1" in
    --p12) P12_INPUT="${2:-}"; shift 2 ;;
    --password-file) PASSWORD_INPUT="${2:-}"; shift 2 ;;
    --output) OUTPUT_PACKAGE="${2:-}"; shift 2 ;;
    --sign) SIGNING_IDENTITY="${2:-}"; shift 2 ;;
    --version) PACKAGE_VERSION="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 64 ;;
  esac
done

[[ -n "$P12_INPUT" && -n "$PASSWORD_INPUT" && -n "$OUTPUT_PACKAGE" && -n "$SIGNING_IDENTITY" ]] || {
  usage >&2
  exit 64
}
[[ "${EUID:-$(/usr/bin/id -u)}" == "0" ]] || { printf 'Run this package builder with sudo so payload files are root:wheel.\n' >&2; exit 77; }
[[ -f "$P12_INPUT" && -f "$PASSWORD_INPUT" ]] || { printf 'P12 or passphrase file is missing.\n' >&2; exit 66; }
[[ "$PACKAGE_VERSION" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || { printf 'Package version must be numeric (for example 1.0.1).\n' >&2; exit 64; }

readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly INSTALLER_SOURCE="$SCRIPT_DIRECTORY/install-seb-config-identity-login-keychain.sh"
if [[ -f "$SCRIPT_DIRECTORY/../deploy/jamf/org.safeonlineexam.seb-identity-installer.plist" ]]; then
  # Source checkout layout.
  readonly DAEMON_SOURCE="$SCRIPT_DIRECTORY/../deploy/jamf/org.safeonlineexam.seb-identity-installer.plist"
else
  # Public release-bundle layout.
  readonly DAEMON_SOURCE="$SCRIPT_DIRECTORY/org.safeonlineexam.seb-identity-installer.plist"
fi
[[ -x "$INSTALLER_SOURCE" && -f "$DAEMON_SOURCE" ]] || { printf 'Required package source files are missing.\n' >&2; exit 66; }

OUTPUT_DIRECTORY="$(/usr/bin/dirname "$OUTPUT_PACKAGE")"
[[ -d "$OUTPUT_DIRECTORY" ]] || { printf 'Output directory does not exist: %s\n' "$OUTPUT_DIRECTORY" >&2; exit 73; }
[[ ! -e "$OUTPUT_PACKAGE" ]] || { printf 'Refusing to overwrite existing package: %s\n' "$OUTPUT_PACKAGE" >&2; exit 73; }

temporary_directory="$(/usr/bin/mktemp -d /private/tmp/safe-online-exam-jamf-package.XXXXXX)"
cleanup() { /bin/rm -rf "$temporary_directory"; }
trap cleanup EXIT
umask 077

payload_root="$temporary_directory/payload"
scripts_root="$temporary_directory/scripts"
identity_root="$payload_root/Library/Application Support/SafeOnlineExam/SEBIdentity"
daemon_root="$payload_root/Library/LaunchDaemons"
/usr/bin/install -d -o root -g wheel -m 700 "$identity_root"
/usr/bin/install -d -o root -g wheel -m 755 "$daemon_root" "$scripts_root"

/usr/bin/openssl pkcs12 -in "$P12_INPUT" -passin "file:$PASSWORD_INPUT" -clcerts -nokeys 2>/dev/null |
  /usr/bin/openssl x509 -noout -fingerprint -sha256 |
  /usr/bin/sed 's/^.*=//; s/://g' > "$temporary_directory/certificate-fingerprint"
EXPECTED_CERT_SHA256="$(< "$temporary_directory/certificate-fingerprint")"
[[ "$EXPECTED_CERT_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || { printf 'P12 could not be opened with the supplied passphrase file.\n' >&2; exit 65; }

{
  printf 'EXPECTED_CERT_SHA256=%q\n' "$EXPECTED_CERT_SHA256"
} > "$identity_root/identity.conf"

/usr/bin/install -o root -g wheel -m 600 "$P12_INPUT" "$identity_root/seb-config-encryption.p12"
/usr/bin/install -o root -g wheel -m 600 "$PASSWORD_INPUT" "$identity_root/seb-config-encryption-password"
/usr/bin/install -o root -g wheel -m 700 "$INSTALLER_SOURCE" "$identity_root/install-login-keychain-identity.sh"
/usr/bin/install -o root -g wheel -m 644 "$DAEMON_SOURCE" "$daemon_root/org.safeonlineexam.seb-identity-installer.plist"

printf '%s\n' \
  '#!/bin/bash' \
  'set -Eeuo pipefail' \
  '' \
  'target_volume="${3:-/}"' \
  'daemon_path="$target_volume/Library/LaunchDaemons/org.safeonlineexam.seb-identity-installer.plist"' \
  '/bin/launchctl bootout system "$daemon_path" >/dev/null 2>&1 || true' \
  '/bin/launchctl bootstrap system "$daemon_path"' \
  '/bin/launchctl kickstart -k system/org.safeonlineexam.seb-identity-installer' \
  > "$scripts_root/postinstall"
/bin/chmod 755 "$scripts_root/postinstall"

/usr/bin/pkgbuild \
  --root "$payload_root" \
  --scripts "$scripts_root" \
  --identifier org.safeonlineexam.seb-identity-installer \
  --version "$PACKAGE_VERSION" \
  --install-location / \
  --sign "$SIGNING_IDENTITY" \
  "$OUTPUT_PACKAGE" >/dev/null
/usr/sbin/pkgutil --check-signature "$OUTPUT_PACKAGE" >/dev/null

printf 'Built signed Jamf identity package: %s\n' "$OUTPUT_PACKAGE"
printf 'Certificate SHA-256: %s\n' "$EXPECTED_CERT_SHA256"
