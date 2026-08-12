#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_ID="seb-for-canvas"
readonly REGION="us-central1"
readonly SERVICE="school-canvas-seb"
readonly PUBLIC_TOOL_URL="https://seb.jacobbarkin.com"

if [[ $# -ne 2 || "$2" != "--confirm-schema-compatible" || ! "$1" =~ ^school-canvas-seb-[a-z0-9-]+$ ]]; then
  echo "usage: npm run rollback:testbed -- REVISION --confirm-schema-compatible" >&2
  exit 64
fi
readonly REVISION="$1"

gcloud run revisions describe "$REVISION" --project="$PROJECT_ID" --region="$REGION" >/dev/null
gcloud run services update-traffic "$SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --to-revisions="$REVISION=100" --quiet

for _ in $(seq 1 24); do
  if curl --fail --silent --show-error --max-time 20 "$PUBLIC_TOOL_URL/ready" >/dev/null; then
    echo "Development testbed traffic now targets $REVISION. Database migrations were not reversed."
    exit 0
  fi
  sleep 5
done

echo "Traffic changed to $REVISION, but readiness did not recover at $PUBLIC_TOOL_URL." >&2
exit 1
