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
cloudrun_require_commands gcloud jq
[[ "$OAUTH_TOKEN_ENCRYPTION_MODE" == "enforce" ]] ||
  cloudrun_usage_error "set OAUTH_TOKEN_ENCRYPTION_MODE=enforce before rewriting OAuth tokens"

environment_csv="$(cloudrun_environment_csv)"
secrets_csv="$(cloudrun_secrets_csv)"
gcloud run jobs deploy "$CLOUDRUN_OAUTH_TOKEN_ENCRYPTION_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$APP_IMAGE" \
  --command=/nodejs/bin/node \
  --args=dist/server/server/data/encrypt-oauth-tokens.js \
  --max-retries=0 \
  --task-timeout=10m \
  --set-cloudsql-instances="$CLOUDRUN_CONNECTION_NAME" \
  --set-env-vars="$environment_csv" \
  --set-secrets="$secrets_csv" \
  --service-account="$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
  --quiet
gcloud run jobs execute "$CLOUDRUN_OAUTH_TOKEN_ENCRYPTION_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait \
  --quiet
