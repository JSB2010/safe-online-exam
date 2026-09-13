#!/usr/bin/env bash
set -Eeuo pipefail

readonly CONTRACT_PATH="/workspace/deploy/testbed/school-canvas-seb.contract.sh"
[[ -f "$CONTRACT_PATH" ]] || {
  echo "Testbed runtime verification failed: contract is missing" >&2
  exit 1
}
# shellcheck source=/dev/null
source "$CONTRACT_PATH"

fail() {
  echo "Testbed runtime verification failed: $*" >&2
  exit 1
}

[[ $# -eq 2 ]] || fail "usage: $0 PROJECT_ID IMAGE_DIGEST"
[[ "$1" == "$TESTBED_PROJECT_ID" ]] || fail "project must be $TESTBED_PROJECT_ID"
readonly IMAGE_DIGEST="$2"
[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "image digest is invalid"
readonly EXPECTED_IMAGE="us-central1-docker.pkg.dev/$TESTBED_PROJECT_ID/canvas-seb-repo/$TESTBED_SERVICE@$IMAGE_DIGEST"
readonly CLOUDSDK_PYTHON="/usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3.14"
readonly METADATA_READER="/workspace/scripts/read-cloud-run-metadata.py"
[[ -x "$CLOUDSDK_PYTHON" ]] || fail "pinned Cloud SDK Python runtime is unavailable"
[[ -f "$METADATA_READER" ]] || fail "Cloud Run metadata reader is missing"

service_value() {
  local field="$1"
  gcloud run services describe "$TESTBED_SERVICE" --project="$TESTBED_PROJECT_ID" --region="$TESTBED_REGION" \
    --format="value($field)"
}

job_value() {
  local job="$1"
  local field="$2"
  gcloud run jobs describe "$job" --project="$TESTBED_PROJECT_ID" --region="$TESTBED_REGION" \
    --format="value($field)"
}

service_env_value() {
  local name="$1"
  gcloud run services describe "$TESTBED_SERVICE" --project="$TESTBED_PROJECT_ID" --region="$TESTBED_REGION" \
    --format=json | "$CLOUDSDK_PYTHON" "$METADATA_READER" env-value "$name"
}

service_secret_version() {
  local name="$1"
  gcloud run services describe "$TESTBED_SERVICE" --project="$TESTBED_PROJECT_ID" --region="$TESTBED_REGION" \
    --format=json | "$CLOUDSDK_PYTHON" "$METADATA_READER" secret-version "$name"
}

job_env_value() {
  local job="$1"
  local name="$2"
  gcloud run jobs describe "$job" --project="$TESTBED_PROJECT_ID" --region="$TESTBED_REGION" \
    --format=json | "$CLOUDSDK_PYTHON" "$METADATA_READER" env-value "$name"
}

job_secret_version() {
  local job="$1"
  local name="$2"
  gcloud run jobs describe "$job" --project="$TESTBED_PROJECT_ID" --region="$TESTBED_REGION" \
    --format=json | "$CLOUDSDK_PYTHON" "$METADATA_READER" secret-version "$name"
}

[[ "$(service_value 'spec.template.spec.containers[0].image')" == "$EXPECTED_IMAGE" ]] ||
  fail "service image does not match $IMAGE_DIGEST"
[[ "$(service_env_value DATABASE_SCHEMA_COMPATIBILITY_PROFILE)" == "$TESTBED_SCHEMA_COMPATIBILITY_PROFILE" ]] ||
  fail "service schema compatibility profile drifted"
[[ "$(service_secret_version LTI_CLIENT_ID)" == "$TESTBED_LTI_CLIENT_ID_SECRET_VERSION" ]] ||
  fail "service LTI client secret version drifted"
[[ "$(service_secret_version CANVAS_API_CLIENT_ID)" == "$TESTBED_CANVAS_API_CLIENT_ID_SECRET_VERSION" ]] ||
  fail "service Canvas API client secret version drifted"

for job in "$TESTBED_SERVICE-migrate" "$TESTBED_SERVICE-cleanup"; do
  [[ "$(job_value "$job" 'spec.template.spec.template.spec.containers[0].image')" == "$EXPECTED_IMAGE" ]] ||
    fail "$job image does not match $IMAGE_DIGEST"
  [[ "$(job_env_value "$job" DATABASE_SCHEMA_COMPATIBILITY_PROFILE)" == "$TESTBED_SCHEMA_COMPATIBILITY_PROFILE" ]] ||
    fail "$job schema compatibility profile drifted"
  [[ "$(job_secret_version "$job" LTI_CLIENT_ID)" == "$TESTBED_LTI_CLIENT_ID_SECRET_VERSION" ]] ||
    fail "$job LTI client secret version drifted"
  [[ "$(job_secret_version "$job" CANVAS_API_CLIENT_ID)" == "$TESTBED_CANVAS_API_CLIENT_ID_SECRET_VERSION" ]] ||
    fail "$job Canvas API client secret version drifted"
done

traffic="$(gcloud run services describe "$TESTBED_SERVICE" --project="$TESTBED_PROJECT_ID" --region="$TESTBED_REGION" \
  --format=json | "$CLOUDSDK_PYTHON" "$METADATA_READER" traffic-100)"
[[ "$traffic" =~ ^school-canvas-seb-[a-z0-9-]+$ ]] || fail "service does not have one 100% traffic revision"

echo "Testbed runtime contract verified for $traffic"
