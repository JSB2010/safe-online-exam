#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_PROJECT="seb-for-canvas"
readonly REGION="us-central1"
readonly SERVICE="school-canvas-seb"
readonly INSTANCE="school-canvas-seb"
readonly MIGRATION_JOB="school-canvas-seb-migrate"
readonly CLEANUP_JOB="school-canvas-seb-cleanup"
readonly SERVICE_ACCOUNT="seb-canvas@seb-for-canvas.iam.gserviceaccount.com"

fail() {
  echo "Testbed target validation failed: $*" >&2
  exit 1
}

[[ $# -eq 1 && "$1" == "$EXPECTED_PROJECT" ]] ||
  fail "this workflow is locked to project $EXPECTED_PROJECT"

connection_name="$(gcloud sql instances describe "$INSTANCE" \
  --project="$EXPECTED_PROJECT" --format='value(connectionName)')"
[[ "$connection_name" == "$EXPECTED_PROJECT:$REGION:$INSTANCE" ]] ||
  fail "Cloud SQL connection name does not match the locked testbed"

for resource in "$SERVICE" "$MIGRATION_JOB" "$CLEANUP_JOB"; do
  if [[ "$resource" == "$SERVICE" ]]; then
    actual_account="$(gcloud run services describe "$resource" --project="$EXPECTED_PROJECT" \
      --region="$REGION" --format='value(spec.template.spec.serviceAccountName)')"
  else
    actual_account="$(gcloud run jobs describe "$resource" --project="$EXPECTED_PROJECT" \
      --region="$REGION" --format='value(spec.template.spec.template.spec.serviceAccountName)')"
  fi
  [[ "$actual_account" == "$SERVICE_ACCOUNT" ]] ||
    fail "$resource does not use the expected testbed service account"
done

echo "Locked development target validated: $EXPECTED_PROJECT/$REGION/$SERVICE" >&2
