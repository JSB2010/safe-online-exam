#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 3 ]]; then
  echo "usage: $0 VERSION IMAGE_DIGEST OUTPUT_DIRECTORY" >&2
  exit 64
fi

version="$1"
image="$2"
output_directory="$3"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
  echo "VERSION must be SemVer without a leading v" >&2
  exit 64
fi
if [[ ! "$image" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ]]; then
  echo "IMAGE_DIGEST must be the exact published Safe Online Exam GHCR digest" >&2
  exit 64
fi

mkdir -p "$output_directory"
output_directory="$(cd "$output_directory" && pwd)"
workspace="$(mktemp -d)"
bundle_name="safe-online-exam-${version}-cloud-run"
bundle_directory="$workspace/$bundle_name"
archive="$output_directory/safe-online-exam-${version}-cloud-run.tar.gz"

cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT

mkdir -p "$bundle_directory"
cp \
  deploy/cloudrun.env.example \
  deploy/cloud-run-contract.json \
  deploy/cloud-run-config.sh \
  deploy/setup-common.sh \
  "$bundle_directory/"
cp deploy/cloud-run-README.md "$bundle_directory/README.md"
cp scripts/setup-cloud-run.sh "$bundle_directory/setup.sh"
cp scripts/bootstrap-cloud-run-secrets.sh "$bundle_directory/bootstrap-secrets.sh"
cp scripts/doctor-cloud-run.sh "$bundle_directory/doctor.sh"
cp scripts/prepare-cloud-run.sh "$bundle_directory/prepare.sh"
cp scripts/render-canvas-theme-loader.sh "$bundle_directory/canvas-theme-loader.sh"
cp scripts/map-cloud-run-domain.sh "$bundle_directory/map-domain.sh"
cp scripts/install-seb-config-identity-user-keychain.sh "$bundle_directory/install-seb-config-identity-user-keychain.sh"
cp scripts/install-seb-config-identity-login-keychain.sh "$bundle_directory/install-seb-config-identity-login-keychain.sh"
cp scripts/build-jamf-seb-identity-package.sh "$bundle_directory/build-jamf-seb-identity-package.sh"
cp scripts/generate-jamf-seb-identity-inline-script.mjs "$bundle_directory/generate-jamf-seb-identity-inline-script.mjs"
cp deploy/jamf/org.safeonlineexam.seb-identity-installer.plist \
  "$bundle_directory/org.safeonlineexam.seb-identity-installer.plist"
cp scripts/install-cloud-run.sh "$bundle_directory/install.sh"
cp scripts/finalize-cloud-run-lti.sh "$bundle_directory/finalize-lti.sh"
cp scripts/upgrade-cloud-run.sh "$bundle_directory/upgrade.sh"
cp scripts/encrypt-cloud-run-oauth-tokens.sh "$bundle_directory/encrypt-oauth-tokens.sh"
cp scripts/rollback-cloud-run.sh "$bundle_directory/rollback.sh"
chmod 0755 \
  "$bundle_directory/setup.sh" \
  "$bundle_directory/bootstrap-secrets.sh" \
  "$bundle_directory/doctor.sh" \
  "$bundle_directory/prepare.sh" \
  "$bundle_directory/canvas-theme-loader.sh" \
  "$bundle_directory/map-domain.sh" \
  "$bundle_directory/install-seb-config-identity-user-keychain.sh" \
  "$bundle_directory/install-seb-config-identity-login-keychain.sh" \
  "$bundle_directory/build-jamf-seb-identity-package.sh" \
  "$bundle_directory/generate-jamf-seb-identity-inline-script.mjs" \
  "$bundle_directory/install.sh" \
  "$bundle_directory/finalize-lti.sh" \
  "$bundle_directory/upgrade.sh" \
  "$bundle_directory/encrypt-oauth-tokens.sh" \
  "$bundle_directory/rollback.sh"
chmod 0644 \
  "$bundle_directory/cloudrun.env.example" \
  "$bundle_directory/cloud-run-contract.json" \
  "$bundle_directory/cloud-run-config.sh" \
  "$bundle_directory/setup-common.sh" \
  "$bundle_directory/org.safeonlineexam.seb-identity-installer.plist" \
  "$bundle_directory/README.md"

sed -i.bak "s|^APP_VERSION=.*$|APP_VERSION=$version|" "$bundle_directory/cloudrun.env.example"
sed -i.bak "s|^APP_IMAGE=.*$|APP_IMAGE=$image|" "$bundle_directory/cloudrun.env.example"
rm -f "$bundle_directory/cloudrun.env.example.bak"

tar -C "$workspace" -czf "$archive" "$bundle_name"
printf '%s\n' "$archive"
