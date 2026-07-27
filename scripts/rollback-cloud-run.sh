#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -ne 3 || "$3" != "--confirm-schema-compatible" ]]; then
  echo "usage: $0 CLOUDRUN_ENV_FILE ROLLBACK_STATE_FILE --confirm-schema-compatible" >&2
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

cloudrun_load_environment "$1"
cloudrun_validate_base
cloudrun_require_commands curl gcloud

rollback_state="$2"
[[ -f "$rollback_state" && ! -L "$rollback_state" ]] ||
  cloudrun_usage_error "rollback state must be a regular file"
previous_revision="$(awk -F= '$1 == "PREVIOUS_REVISION" { print $2 }' "$rollback_state")"
state_project="$(awk -F= '$1 == "PROJECT_ID" { print $2 }' "$rollback_state")"
state_region="$(awk -F= '$1 == "REGION" { print $2 }' "$rollback_state")"
state_service="$(awk -F= '$1 == "SERVICE" { print $2 }' "$rollback_state")"
[[ "$state_project" == "$PROJECT_ID" && "$state_region" == "$REGION" && "$state_service" == "$SERVICE" ]] ||
  cloudrun_die "rollback record does not match the configured Cloud Run target"
[[ "$previous_revision" =~ ^${SERVICE}-[a-z0-9-]+$ ]] ||
  cloudrun_die "rollback record contains an invalid previous revision"

gcloud run revisions describe "$previous_revision" \
  --project="$PROJECT_ID" \
  --region="$REGION" >/dev/null ||
  cloudrun_die "previous revision no longer exists: $previous_revision"
gcloud run services update-traffic "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions="$previous_revision=100" \
  --quiet

service_url="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"
cloudrun_verify_url "$service_url"
printf 'Application traffic now targets %s.\nDatabase migrations were not reversed.\n' "$previous_revision"
