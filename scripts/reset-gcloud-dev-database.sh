#!/usr/bin/env bash
set -Eeuo pipefail

readonly REGION="us-central1"
readonly INSTANCE="canvas-seb-dev"
readonly DATABASE="canvas_seb"
readonly SERVICE="canvas-seb-dev"
readonly MIGRATION_JOB="canvas-seb-dev-migrate"

usage() {
  echo "Usage: npm run db:reset:gcloud:dev -- --project PROJECT_ID" >&2
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

if [[ $# -ne 2 || "$1" != "--project" || -z "$2" || "$2" == -* ]]; then
  usage
  exit 64
fi
readonly PROJECT_ID="$2"

[[ -t 0 && -t 1 ]] || fail "this destructive command requires an interactive terminal"
command -v gcloud >/dev/null 2>&1 || fail "gcloud is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
[[ -n "$active_account" ]] || fail "gcloud has no active authenticated account"

connection_name="$(gcloud sql instances describe "$INSTANCE" \
  --project="$PROJECT_ID" --format='value(connectionName)')" || fail "cannot read the dev Cloud SQL instance"
[[ "$connection_name" == "$PROJECT_ID:$REGION:$INSTANCE" ]] ||
  fail "Cloud SQL target mismatch: expected $PROJECT_ID:$REGION:$INSTANCE, got ${connection_name:-none}"

database_version="$(gcloud sql instances describe "$INSTANCE" \
  --project="$PROJECT_ID" --format='value(databaseVersion)')"
[[ "$database_version" == POSTGRES_* ]] || fail "$INSTANCE is not a PostgreSQL instance"

instance_state="$(gcloud sql instances describe "$INSTANCE" \
  --project="$PROJECT_ID" --format='value(state)')"
[[ "$instance_state" == "RUNNABLE" ]] || fail "$INSTANCE is not RUNNABLE (state: ${instance_state:-unknown})"

charset="$(gcloud sql databases describe "$DATABASE" --instance="$INSTANCE" \
  --project="$PROJECT_ID" --format='value(charset)')" || fail "database $DATABASE does not exist"
collation="$(gcloud sql databases describe "$DATABASE" --instance="$INSTANCE" \
  --project="$PROJECT_ID" --format='value(collation)')" || fail "cannot read the database collation"
[[ -n "$charset" && -n "$collation" ]] || fail "database charset/collation could not be preserved safely"

service_url="$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --project="$PROJECT_ID" --format='value(status.url)')" || fail "Cloud Run service $SERVICE does not exist"
[[ "$service_url" == https://* ]] || fail "Cloud Run service URL is missing or unsafe"

gcloud run jobs describe "$MIGRATION_JOB" --region="$REGION" --project="$PROJECT_ID" \
  --format='value(metadata.name)' >/dev/null || fail "migration job $MIGRATION_JOB does not exist"

confirmation="RESET $PROJECT_ID $REGION $INSTANCE $DATABASE"
cat <<EOF

DANGER: this permanently deletes every row in the development database.

  Account:   $active_account
  Project:   $PROJECT_ID
  Region:    $REGION
  Instance:  $INSTANCE
  Database:  $DATABASE
  Service:   $SERVICE

Assessment settings, course settings, administrator course connections and tool rollouts, Canvas OAuth
tokens, sessions, one-time proof state, grants, rate budgets, and operation locks
will all be destroyed.
The dev service may return errors until the database is recreated and migrated.

Type this exact phrase to continue:
$confirmation
EOF

IFS= read -r answer
[[ "$answer" == "$confirmation" ]] || fail "confirmation did not match; nothing was changed"

echo "Deleting $DATABASE from $INSTANCE..."
if ! gcloud sql databases delete "$DATABASE" --instance="$INSTANCE" \
  --project="$PROJECT_ID" --quiet; then
  fail "database deletion failed; recreation and migration were not attempted"
fi

echo "Recreating $DATABASE with its previous charset and collation..."
if ! gcloud sql databases create "$DATABASE" --instance="$INSTANCE" \
  --project="$PROJECT_ID" --charset="$charset" --collation="$collation"; then
  fail "database recreation failed; $DATABASE is currently absent and must be recreated before the service can recover"
fi

echo "Applying the deployed schema migrations..."
if ! gcloud run jobs execute "$MIGRATION_JOB" --region="$REGION" \
  --project="$PROJECT_ID" --wait; then
  fail "the database exists but migration failed; fix the job and rerun: gcloud run jobs execute $MIGRATION_JOB --region=$REGION --project=$PROJECT_ID --wait"
fi

echo "Waiting for $service_url/ready..."
for _ in $(seq 1 24); do
  if curl --fail --silent --show-error --max-time 10 "$service_url/ready" >/dev/null; then
    echo "Development database reset completed; readiness is healthy."
    exit 0
  fi
  sleep 5
done

fail "migrations succeeded, but $service_url/ready did not recover within two minutes; inspect the latest $SERVICE revision logs"
