#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 8 ]]; then
  echo "usage: $0 PROJECT_ID IMAGE ATTESTOR KMS_PROJECT KMS_LOCATION KMS_KEYRING KMS_KEY KMS_KEY_VERSION" >&2
  exit 64
fi

project_id="$1"
image="$2"
attestor="$3"
kms_project="$4"
kms_location="$5"
kms_keyring="$6"
kms_key="$7"
kms_key_version="$8"

resource_name_pattern='^[a-z][a-z0-9-]{1,62}$'
[[ "$project_id" =~ $resource_name_pattern ]] || { echo "invalid PROJECT_ID" >&2; exit 64; }
[[ "$kms_project" =~ $resource_name_pattern ]] || { echo "invalid KMS_PROJECT" >&2; exit 64; }
[[ "$image" =~ ^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@sha256:[0-9a-f]{64}$ ]] || {
  echo "IMAGE must be an immutable GHCR sha256 reference" >&2
  exit 64
}
for value in "$attestor" "$kms_location" "$kms_keyring" "$kms_key"; do
  [[ "$value" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "invalid Binary Authorization resource name" >&2; exit 64; }
done
[[ "$kms_key_version" =~ ^[1-9][0-9]*$ ]] || { echo "invalid KMS key version" >&2; exit 64; }

existing_attestation="$(
  gcloud beta container binauthz attestations list \
    --project="$project_id" \
    --artifact-url="$image" \
    --attestor="$attestor" \
    --attestor-project="$project_id" \
    --format='value(name)' \
    --limit=1
)"
if [[ -n "$existing_attestation" ]]; then
  echo "Binary Authorization attestation already exists for the requested image and attestor; skipping creation." >&2
  exit 0
fi

gcloud beta container binauthz attestations sign-and-create \
  --project="$project_id" \
  --artifact-url="$image" \
  --attestor="$attestor" \
  --attestor-project="$project_id" \
  --keyversion-project="$kms_project" \
  --keyversion-location="$kms_location" \
  --keyversion-keyring="$kms_keyring" \
  --keyversion-key="$kms_key" \
  --keyversion="$kms_key_version" \
  --validate \
  --quiet
