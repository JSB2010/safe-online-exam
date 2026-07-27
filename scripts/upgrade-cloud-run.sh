#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [CLOUDRUN_ENV_FILE]" >&2
  exit 64
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/cloud-run-config.sh" ]]; then
  # shellcheck disable=SC1091
  source "$script_directory/cloud-run-config.sh"
else
  # shellcheck disable=SC1091
  source "$script_directory/../deploy/cloud-run-config.sh"
fi

cloudrun_load_environment "${1:-cloudrun.env}"
cloudrun_validate_base
cloudrun_require_commands curl gcloud jq

for job in "$CLOUDRUN_MIGRATE_JOB" "$CLOUDRUN_CLEANUP_JOB"; do
  gcloud run jobs describe "$job" \
    --project="$PROJECT_ID" \
    --region="$REGION" >/dev/null ||
    cloudrun_die "required Cloud Run job is missing: $job"
done
service_json="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format=json)" ||
  cloudrun_die "Cloud Run service is missing: $SERVICE"

mkdir -p "$STATE_DIRECTORY"
chmod 700 "$STATE_DIRECTORY"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
rollback_state="$STATE_DIRECTORY/rollback-$APP_VERSION-$timestamp.env"
previous_revision="$(jq -er '
  [.status.traffic[] | select((.percent // 0) > 0)]
  | max_by(.percent)
  | .revisionName
' <<<"$service_json")"
previous_image="$(gcloud run revisions describe "$previous_revision" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(spec.containers[0].image)')"

cat >"$rollback_state" <<EOF
PROJECT_ID=$PROJECT_ID
REGION=$REGION
SERVICE=$SERVICE
PREVIOUS_REVISION=$previous_revision
PREVIOUS_IMAGE=$previous_image
TARGET_IMAGE=$APP_IMAGE
CREATED_AT=$timestamp
EOF
chmod 600 "$rollback_state"

backup_description="before Safe Online Exam $APP_VERSION ($timestamp)"
gcloud sql backups create \
  --project="$PROJECT_ID" \
  --instance="$SQL_INSTANCE" \
  --description="$backup_description" \
  --quiet
backup_json="$(gcloud sql backups list \
  --project="$PROJECT_ID" \
  --instance="$SQL_INSTANCE" \
  --sort-by='~endTime' \
  --limit=20 \
  --format=json)"
matching_backup="$(jq -er --arg description "$backup_description" '
  [.[] | select(.description == $description)]
  | max_by(.endTime)
' <<<"$backup_json")"
backup_id="$(jq -er '.id' <<<"$matching_backup")"
[[ "$(jq -er '.status' <<<"$matching_backup")" == "SUCCESSFUL" ]] ||
  cloudrun_die "the pre-upgrade Cloud SQL backup did not complete successfully"
printf 'BACKUP_ID=%s\n' "$backup_id" >>"$rollback_state"

gcloud run jobs update "$CLOUDRUN_MIGRATE_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$APP_IMAGE" \
  --quiet
gcloud run jobs execute "$CLOUDRUN_MIGRATE_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait \
  --quiet

gcloud run jobs update "$CLOUDRUN_CLEANUP_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$APP_IMAGE" \
  --quiet

release_tag="$(cloudrun_release_tag)"
gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$APP_IMAGE" \
  --no-traffic \
  --tag="$release_tag" \
  --quiet
deployed_revision="$(cloudrun_cut_over_tag "$release_tag")"

service_url="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"
cloudrun_verify_url "$service_url"
printf 'DEPLOYED_REVISION=%s\nCOMPLETED_AT=%s\n' \
  "$deployed_revision" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$rollback_state"

cat <<EOF
Cloud Run upgrade completed.

Service:         $service_url
Revision:        $deployed_revision
Image:           $APP_IMAGE
Verified backup: $backup_id on Cloud SQL instance $SQL_INSTANCE
Rollback record: $rollback_state

Application rollback does not reverse database migrations. Use rollback.sh only
after confirming the target revision is compatible with the migrated schema.
EOF
