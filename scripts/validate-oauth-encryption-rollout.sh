#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 PROJECT_ID SERVICE REGION REQUESTED_MODE" >&2
  exit 64
fi

project_id="$1"
service="$2"
region="$3"
requested_mode="$4"

[[ "$project_id" =~ ^[a-z][a-z0-9-]{1,62}$ ]] || { echo "invalid PROJECT_ID" >&2; exit 64; }
[[ "$service" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || { echo "invalid SERVICE" >&2; exit 64; }
[[ "$region" =~ ^[a-z]+-[a-z0-9]+[0-9]$ ]] || { echo "invalid REGION" >&2; exit 64; }
[[ "$requested_mode" == "compat" || "$requested_mode" == "enforce" ]] || {
  echo "REQUESTED_MODE must be compat or enforce" >&2
  exit 64
}

if [[ "$requested_mode" == "compat" ]]; then
  echo "OAuth token encryption rollout is using rollback-compatible writes." >&2
  exit 0
fi

existing_service="$(gcloud run services list \
  --project="$project_id" \
  --region="$region" \
  --platform=managed \
  --filter="metadata.name=$service" \
  --limit=1 \
  --format='value(metadata.name)')"

if [[ -z "$existing_service" ]]; then
  echo "No existing Cloud Run service was found; a fresh installation may start in enforce mode." >&2
  exit 0
fi
[[ "$existing_service" == "$service" ]] || {
  echo "Cloud Run lookup returned an unexpected service: $existing_service" >&2
  exit 1
}

traffic_rows="$(gcloud run services describe "$service" \
  --project="$project_id" \
  --region="$region" \
  --platform=managed \
  --flatten='status.traffic[]' \
  --format='value(status.traffic.revisionName,status.traffic.percent)')"

serving_revision=""
serving_revision_count=0
while IFS=$'\t' read -r revision percent; do
  [[ -n "$revision" && "$percent" == "100" ]] || continue
  serving_revision="$revision"
  ((serving_revision_count += 1))
done <<<"$traffic_rows"

[[ "$serving_revision_count" -eq 1 && -n "$serving_revision" ]] || {
  echo "Existing service $service does not have one explicit 100% traffic-serving revision; complete or roll back the current rollout before enforce" >&2
  exit 1
}

revision_environment="$(gcloud run revisions describe "$serving_revision" \
  --project="$project_id" \
  --region="$region" \
  --platform=managed \
  --flatten='spec.containers[].env[]' \
  --format='value(spec.containers.env.name,spec.containers.env.value)')"

current_mode=""
current_mode_count=0
while IFS=$'\t' read -r name value; do
  [[ "$name" == "OAUTH_TOKEN_ENCRYPTION_MODE" ]] || continue
  current_mode="$value"
  ((current_mode_count += 1))
done <<<"$revision_environment"

[[ "$current_mode_count" -eq 1 && ( "$current_mode" == "compat" || "$current_mode" == "enforce" ) ]] || {
  echo "Traffic-serving revision $serving_revision has not completed a compat-mode deployment; deploy compat and verify it before enforce" >&2
  exit 1
}

echo "Traffic-serving revision $serving_revision reports $current_mode mode; enforce deployment is rollback-staged." >&2
