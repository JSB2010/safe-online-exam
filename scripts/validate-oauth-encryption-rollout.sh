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

service_json="$(gcloud run services describe "$service" \
  --project="$project_id" \
  --region="$region" \
  --platform=managed \
  --format=json)"
serving_revision="$(python3 -c '
import json
import sys

service = json.load(sys.stdin)
traffic = service.get("status", {}).get("traffic", [])
revisions = [
    item.get("revisionName", "")
    for item in traffic
    if item.get("percent") == 100 and item.get("revisionName")
]
print(revisions[0] if len(revisions) == 1 else "")
' <<<"$service_json")"

[[ -n "$serving_revision" ]] || {
  echo "Existing service $service does not have one explicit 100% traffic-serving revision; complete or roll back the current rollout before enforce" >&2
  exit 1
}

revision_json="$(gcloud run revisions describe "$serving_revision" \
  --project="$project_id" \
  --region="$region" \
  --platform=managed \
  --format=json)"
current_mode="$(python3 -c '
import json
import sys

revision = json.load(sys.stdin)
containers = revision.get("spec", {}).get("containers", [])
environment = containers[0].get("env", []) if containers else []
print(next((item.get("value", "") for item in environment if item.get("name") == "OAUTH_TOKEN_ENCRYPTION_MODE"), ""))
' <<<"$revision_json")"

[[ "$current_mode" == "compat" || "$current_mode" == "enforce" ]] || {
  echo "Traffic-serving revision $serving_revision has not completed a compat-mode deployment; deploy compat and verify it before enforce" >&2
  exit 1
}

echo "Traffic-serving revision $serving_revision reports $current_mode mode; enforce deployment is rollback-staged." >&2
