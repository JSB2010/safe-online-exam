#!/usr/bin/env bash
set -Eeuo pipefail

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
cloudrun_require_commands gcloud docker jq openssl curl

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
[[ -n "$active_account" ]] || cloudrun_die "gcloud has no active authenticated account"
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null ||
  cloudrun_die "Google Cloud project is missing or inaccessible: $PROJECT_ID"

if billing_enabled="$(
  gcloud billing projects describe "$PROJECT_ID" \
    --format='value(billingEnabled)' 2>/dev/null
)"; then
  [[ "$billing_enabled" == "True" || "$billing_enabled" == "true" ]] ||
    cloudrun_die "billing is not enabled for Google Cloud project $PROJECT_ID"
else
  printf 'warning: unable to verify billing; confirm it before provisioning Cloud SQL\n' >&2
fi

docker info >/dev/null 2>&1 ||
  cloudrun_die "Docker is installed but its engine is not available"
docker manifest inspect "$APP_IMAGE" >/dev/null ||
  cloudrun_die "the configured immutable application image is not accessible: $APP_IMAGE"

cloudrun_print_resource_plan

if gcloud sql instances describe "$SQL_INSTANCE" \
  --project="$PROJECT_ID" \
  --format=json >/dev/null 2>&1; then
  printf '\nExisting Cloud SQL instance detected. prepare.sh will validate its production controls.\n'
elif [[ "$CLOUD_SQL_PROFILE" == "existing-reviewed" ]]; then
  cloudrun_die "existing-reviewed requires an existing accessible Cloud SQL instance: $SQL_INSTANCE"
else
  cat <<EOF

Cloud SQL does not exist yet. It will be created only by:
  ./prepare.sh ${1:-cloudrun.env} --create-sql

The selected profile reference is: $(cloudrun_sql_price_summary).
Run ./prepare.sh --list-cloud-sql-profiles to compare every supported machine,
availability model, term, current reference price, and recommendation before
approving creation.
EOF
fi

if command -v gh >/dev/null 2>&1; then
  printf '\nGitHub CLI detected; use the release-note command to verify image provenance.\n'
else
  printf '\nwarning: GitHub CLI is unavailable; install it before image-attestation verification\n' >&2
fi

cat <<EOF

Preflight passed for account: $active_account
No Google Cloud resources were changed.
EOF
