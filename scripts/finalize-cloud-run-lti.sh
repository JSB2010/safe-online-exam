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
cloudrun_require_commands curl gcloud jq

for lti_file in lti_client_id lti_deployment_id; do
  [[ -s "$BOOTSTRAP_DIRECTORY/$lti_file" ]] ||
    cloudrun_die "LTI value is missing: $BOOTSTRAP_DIRECTORY/$lti_file"
  [[ "$(<"$BOOTSTRAP_DIRECTORY/$lti_file")" != "bootstrap-pending" ]] ||
    cloudrun_die "replace bootstrap-pending in $BOOTSTRAP_DIRECTORY/$lti_file before finalizing"
done
[[ -f "$CLOUDRUN_SECRET_VERSION_STATE" ]] ||
  cloudrun_die "initial installation secret-version state is missing"

for lti_spec in \
  "LTI_CLIENT_ID|lti_client_id|lti_client_id|LTI_CLIENT_ID_SECRET_VERSION" \
  "LTI_DEPLOYMENT_ID|lti_deployment_id|lti_deployment_id|LTI_DEPLOYMENT_ID_SECRET_VERSION"; do
  IFS='|' read -r environment_name suffix file_name version_key <<<"$lti_spec"
  secret_name="${SECRET_PREFIX}_${suffix}"
  version_resource="$(gcloud secrets versions add "$secret_name" \
    --project="$PROJECT_ID" \
    --data-file="$BOOTSTRAP_DIRECTORY/$file_name" \
    --format='value(name)')"
  version="${version_resource##*/}"
  [[ "$version" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_die "Secret Manager did not return a numeric version for $secret_name"
  cloudrun_set_secret_version "$version_key" "$version"
  printf -v "${environment_name}_REFERENCE" '%s=%s:%s' \
    "$environment_name" "$secret_name" "$version"
done

lti_secrets_csv="$LTI_CLIENT_ID_REFERENCE,$LTI_DEPLOYMENT_ID_REFERENCE"
for job in "$CLOUDRUN_MIGRATE_JOB" "$CLOUDRUN_CLEANUP_JOB"; do
  gcloud run jobs update "$job" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --update-secrets="$lti_secrets_csv" \
    --quiet
done

release_tag="$(cloudrun_release_tag)-lti"
gcloud run services update "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-secrets="$lti_secrets_csv" \
  --no-traffic \
  --tag="$release_tag" \
  --quiet
deployed_revision="$(cloudrun_cut_over_tag "$release_tag")"

if [[ "$DISABLE_DEFAULT_URL_AFTER_FINALIZE" == "true" ]]; then
  cloudrun_disable_default_url_after_finalization
  service_url="${TOOL_URL%/}"
  default_url_note="The generated Cloud Run default URL is disabled; this custom origin was verified before and after that change."
else
  service_url="$(gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.url)')"
  cloudrun_verify_url "$service_url"
  default_url_note=""
fi

cat <<EOF
Canvas LTI identifiers are pinned to their exact Secret Manager versions.

Service:  $service_url
Revision: $deployed_revision

$default_url_note

Keep $CLOUDRUN_SECRET_VERSION_STATE with the deployment records. It contains
version numbers only, not secret values.
EOF
