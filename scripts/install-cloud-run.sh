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
cloudrun_validate_complete
cloudrun_require_commands cmp curl gcloud jq openssl
cloudrun_assert_bootstrap

for bootstrap_lti_file in lti_client_id lti_deployment_id; do
  [[ "$(<"$BOOTSTRAP_DIRECTORY/$bootstrap_lti_file")" == "bootstrap-pending" ]] ||
    cloudrun_usage_error "$bootstrap_lti_file must remain bootstrap-pending for the initial install"
done

mkdir -p "$STATE_DIRECTORY"
chmod 700 "$STATE_DIRECTORY"
cloudrun_ensure_secret_versions

environment_csv="$(cloudrun_environment_csv)"
secrets_csv="$(cloudrun_secrets_csv)"

gcloud run jobs deploy "$CLOUDRUN_MIGRATE_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$APP_IMAGE" \
  --command=/nodejs/bin/node \
  --args=dist/server/server/data/migrate.js \
  --max-retries=0 \
  --task-timeout=10m \
  --set-cloudsql-instances="$CLOUDRUN_CONNECTION_NAME" \
  --set-env-vars="$environment_csv" \
  --set-secrets="$secrets_csv" \
  --service-account="$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
  --quiet
gcloud run jobs execute "$CLOUDRUN_MIGRATE_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait \
  --quiet

gcloud run jobs deploy "$CLOUDRUN_CLEANUP_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$APP_IMAGE" \
  --command=/nodejs/bin/node \
  --args=dist/server/server/data/cleanup.js,--drain \
  --max-retries=1 \
  --task-timeout=10m \
  --set-cloudsql-instances="$CLOUDRUN_CONNECTION_NAME" \
  --set-env-vars="$environment_csv" \
  --set-secrets="$secrets_csv" \
  --service-account="$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
  --quiet

release_tag="$(cloudrun_release_tag)"
gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --platform=managed \
  --execution-environment=gen2 \
  --image="$APP_IMAGE" \
  --set-cloudsql-instances="$CLOUDRUN_CONNECTION_NAME" \
  --set-env-vars="$environment_csv" \
  --set-secrets="$secrets_csv" \
  --memory="$MEMORY" \
  --cpu="$CPU" \
  --min-instances="$MIN_INSTANCES" \
  --max-instances="$MAX_INSTANCES" \
  --timeout="$REQUEST_TIMEOUT" \
  --service-account="$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
  --no-traffic \
  --tag="$release_tag" \
  --quiet

if [[ "$PUBLIC_ACCESS" == "true" ]]; then
  gcloud run services add-iam-policy-binding "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --member=allUsers \
    --role=roles/run.invoker \
    --condition=None \
    --quiet >/dev/null
fi
deployed_revision="$(cloudrun_cut_over_tag "$release_tag")"

if ! gcloud iam service-accounts describe "$CLOUDRUN_SCHEDULER_SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SCHEDULER_SERVICE_ACCOUNT_NAME" \
    --project="$PROJECT_ID" \
    --display-name="Safe Online Exam cleanup scheduler" \
    --quiet
fi
gcloud run jobs add-iam-policy-binding "$CLOUDRUN_CLEANUP_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --member="serviceAccount:$CLOUDRUN_SCHEDULER_SERVICE_ACCOUNT" \
  --role=roles/run.invoker \
  --quiet >/dev/null

scheduler_uri="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$CLOUDRUN_CLEANUP_JOB:run"
if gcloud scheduler jobs describe "$CLOUDRUN_SCHEDULER_JOB" \
  --project="$PROJECT_ID" \
  --location="$REGION" >/dev/null 2>&1; then
  scheduler_action=(update)
else
  scheduler_action=(create)
fi
gcloud scheduler jobs "${scheduler_action[@]}" http "$CLOUDRUN_SCHEDULER_JOB" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --schedule="$CLEANUP_SCHEDULE" \
  --time-zone="$CLEANUP_TIME_ZONE" \
  --uri="$scheduler_uri" \
  --http-method=POST \
  --oauth-service-account-email="$CLOUDRUN_SCHEDULER_SERVICE_ACCOUNT" \
  --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform \
  --quiet
gcloud run jobs execute "$CLOUDRUN_CLEANUP_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait \
  --quiet

service_url="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"
cloudrun_verify_url "$service_url"

cat <<EOF
Initial Cloud Run installation completed.

Service:  $service_url
Revision: $deployed_revision
Image:    $APP_IMAGE

The service is intentionally using bootstrap LTI identifiers. Create the Canvas
LTI registration, replace lti_client_id and lti_deployment_id in
$BOOTSTRAP_DIRECTORY, then run finalize-lti.sh.
EOF
