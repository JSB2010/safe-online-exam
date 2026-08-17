#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_ID="seb-for-canvas"
readonly REGION="us-central1"
readonly INSTANCE="school-canvas-seb"
readonly DATABASE="canvas_seb"
readonly SERVICE="school-canvas-seb"
readonly MIGRATION_JOB="school-canvas-seb-migrate"
readonly PUBLIC_TOOL_URL="https://seb.jacobbarkin.com"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[[ $# -eq 0 ]] || {
  echo "usage: npm run db:reset:gcloud:testbed" >&2
  exit 64
}
[[ -t 0 && -t 1 ]] || fail "this destructive command requires an interactive terminal"

connection_name="$(gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" --format='value(connectionName)')"
[[ "$connection_name" == "$PROJECT_ID:$REGION:$INSTANCE" ]] || fail "Cloud SQL target mismatch"
charset="$(gcloud sql databases describe "$DATABASE" --instance="$INSTANCE" \
  --project="$PROJECT_ID" --format='value(charset)')"
collation="$(gcloud sql databases describe "$DATABASE" --instance="$INSTANCE" \
  --project="$PROJECT_ID" --format='value(collation)')"
[[ -n "$charset" && -n "$collation" ]] || fail "database charset/collation could not be preserved"
gcloud run jobs describe "$MIGRATION_JOB" --project="$PROJECT_ID" --region="$REGION" >/dev/null

confirmation="RESET $PROJECT_ID $REGION $INSTANCE $DATABASE"
cat <<EOF

DANGER: this permanently deletes all application data in the development testbed database.
It does not address any production service or database. Canvas objects are not deleted, but every user must reconnect Canvas.

Type this exact phrase to continue:
$confirmation
EOF
IFS= read -r answer
[[ "$answer" == "$confirmation" ]] || fail "confirmation did not match; nothing was changed"

gcloud sql databases delete "$DATABASE" --instance="$INSTANCE" --project="$PROJECT_ID" --quiet
gcloud sql databases create "$DATABASE" --instance="$INSTANCE" --project="$PROJECT_ID" \
  --charset="$charset" --collation="$collation"
gcloud run jobs execute "$MIGRATION_JOB" --project="$PROJECT_ID" --region="$REGION" --wait --quiet

for _ in $(seq 1 24); do
  if curl --fail --silent --show-error --max-time 20 "$PUBLIC_TOOL_URL/ready" >/dev/null; then
    echo "Development testbed database reset completed and migrations are healthy."
    exit 0
  fi
  sleep 5
done
fail "$SERVICE did not recover readiness within two minutes"
