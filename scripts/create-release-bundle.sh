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
  echo "VERSION must be a SemVer version without a leading v" >&2
  exit 64
fi
if [[ ! "$image" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ]]; then
  echo "IMAGE_DIGEST must be the exact published Safe Online Exam GHCR digest" >&2
  exit 64
fi

mkdir -p "$output_directory"
output_directory="$(cd "$output_directory" && pwd)"
workspace="$(mktemp -d)"
bundle_name="safe-online-exam-${version}"
bundle_directory="$workspace/$bundle_name"
archive="$output_directory/${bundle_name}-compose.tar.gz"

cleanup() {
  rm -rf "$workspace"
}
trap cleanup EXIT

mkdir -p "$bundle_directory"
cp compose.yaml compose.secrets.yaml compose.caddy.yaml Caddyfile .env.compose.secrets.example "$bundle_directory/"
cp scripts/bootstrap-compose-secrets.sh "$bundle_directory/bootstrap-secrets.sh"
cp deploy/compose-README.md "$bundle_directory/README.md"
chmod 0755 "$bundle_directory/bootstrap-secrets.sh"

sed -i.bak "s|^APP_IMAGE=.*$|APP_IMAGE=$image|" "$bundle_directory/.env.compose.secrets.example"
sed -i.bak "s|^APP_ASSET_VERSION=.*$|APP_ASSET_VERSION=$version|" "$bundle_directory/.env.compose.secrets.example"
rm -f "$bundle_directory/.env.compose.secrets.example.bak"

tar -C "$workspace" -czf "$archive" "$bundle_name"
printf '%s\n' "$archive"
