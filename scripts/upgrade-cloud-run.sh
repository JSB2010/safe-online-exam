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

environment_file="${1:-cloudrun.env}"
cloudrun_require_explicit_oauth_token_encryption_mode "$environment_file"
cloudrun_load_environment "$environment_file"
cloudrun_validate_complete
cloudrun_require_commands cmp curl gcloud jq openssl
"$script_directory/validate-oauth-encryption-rollout.sh" \
  "$PROJECT_ID" "$SERVICE" "$REGION" "$OAUTH_TOKEN_ENCRYPTION_MODE"
cloudrun_assert_oauth_token_encryption_keyring_not_established
cloudrun_ensure_oauth_token_encryption_bootstrap
cloudrun_assert_bootstrap

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
default_url_was_disabled="$(jq -r '
  .metadata.annotations["run.googleapis.com/default-url-disabled"] == "true"
' <<<"$service_json")"
default_url_should_be_disabled="$DISABLE_DEFAULT_URL_AFTER_FINALIZE"
[[ "$default_url_was_disabled" == "true" ]] && default_url_should_be_disabled=true
default_url_restore_pending=false

if [[ -n "$TOOL_URL" ]]; then
  cloudrun_validate_url TOOL_URL "$TOOL_URL"
fi
if [[ "$default_url_should_be_disabled" == "true" ]]; then
  [[ -n "$TOOL_URL" ]] ||
    cloudrun_die "a disabled generated Cloud Run URL requires a configured custom TOOL_URL"
  if [[ "$default_url_was_disabled" != "true" ]]; then
    generated_service_url="$(jq -r '.status.url // empty' <<<"$service_json")"
    cloudrun_validate_url CLOUD_RUN_SERVICE_URL "$generated_service_url"
    [[ "${TOOL_URL%/}" != "${generated_service_url%/}" ]] ||
      cloudrun_die "TOOL_URL must differ from the generated Cloud Run URL before it can be disabled"
  fi
fi

cloudrun_restore_upgrade_default_url() {
  [[ "$default_url_restore_pending" == "true" ]] || return 0
  if [[ -z "$TOOL_URL" ]]; then
    printf 'error: cannot restore the disabled Cloud Run URL without TOOL_URL\n' >&2
    return 1
  fi
  if ! cloudrun_verify_url "${TOOL_URL%/}"; then
    printf 'error: custom TOOL_URL failed before disabling the generated Cloud Run URL\n' >&2
    return 1
  fi
  if ! gcloud run services update "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --no-default-url \
    --quiet; then
    printf 'error: could not disable the generated Cloud Run URL\n' >&2
    return 1
  fi
  if ! service_json="$(gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format=json)"; then
    printf 'error: could not verify the restored Cloud Run URL policy\n' >&2
    return 1
  fi
  if ! jq -e '.metadata.annotations["run.googleapis.com/default-url-disabled"] == "true"' \
    <<<"$service_json" >/dev/null; then
    printf 'error: Cloud Run did not confirm that its generated URL is disabled\n' >&2
    return 1
  fi
  if ! cloudrun_verify_url "${TOOL_URL%/}"; then
    printf 'error: custom TOOL_URL failed after disabling the generated Cloud Run URL\n' >&2
    return 1
  fi
  default_url_restore_pending=false
}

cloudrun_restore_upgrade_default_url_on_exit() {
  local exit_code=$?
  trap - EXIT
  if ! cloudrun_restore_upgrade_default_url; then
    exit_code=1
  fi
  exit "$exit_code"
}

mkdir -p "$STATE_DIRECTORY"
chmod 700 "$STATE_DIRECTORY"
cloudrun_ensure_secret_versions
environment_csv="$(cloudrun_environment_csv)"
secrets_csv="$(cloudrun_secrets_csv)"
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
  --set-env-vars="$environment_csv" \
  --set-secrets="$secrets_csv" \
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
  --set-env-vars="$environment_csv" \
  --set-secrets="$secrets_csv" \
  --quiet

release_tag="$(cloudrun_release_tag)"
gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$APP_IMAGE" \
  --set-env-vars="$environment_csv" \
  --set-secrets="$secrets_csv" \
  --no-traffic \
  --tag="$release_tag" \
  --quiet
if [[ "$default_url_was_disabled" == "true" ]]; then
  cloudrun_verify_url "${TOOL_URL%/}"
  default_url_restore_pending=true
  trap cloudrun_restore_upgrade_default_url_on_exit EXIT
  gcloud run services update "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --default-url \
    --quiet
fi
deployed_revision="$(cloudrun_cut_over_tag "$release_tag")"

service_url="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"
cloudrun_verify_url "$service_url"
if [[ -n "$TOOL_URL" ]]; then
  cloudrun_verify_url "${TOOL_URL%/}"
fi
if [[ "$default_url_should_be_disabled" == "true" ]]; then
  default_url_restore_pending=true
  trap cloudrun_restore_upgrade_default_url_on_exit EXIT
  cloudrun_restore_upgrade_default_url ||
    cloudrun_die "could not restore the generated Cloud Run URL policy after upgrade"
  trap - EXIT
fi
printf 'DEPLOYED_REVISION=%s\nCOMPLETED_AT=%s\n' \
  "$deployed_revision" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$rollback_state"

display_url="$service_url"
[[ -n "$TOOL_URL" ]] && display_url="${TOOL_URL%/}"

cat <<EOF
Cloud Run upgrade completed.

Service:         $display_url
Revision:        $deployed_revision
Image:           $APP_IMAGE
Verified backup: $backup_id on Cloud SQL instance $SQL_INSTANCE
Rollback record: $rollback_state

Application rollback does not reverse database migrations. Use rollback.sh only
after confirming the target revision is compatible with the migrated schema.
EOF
