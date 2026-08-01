#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [CLOUDRUN_ENV_FILE]" >&2
  exit 64
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/cloud-run-config.sh" ]]; then
  # Release bundle layout.
  # shellcheck disable=SC1091
  source "$script_directory/cloud-run-config.sh"
else
  # Source repository layout.
  # shellcheck disable=SC1091
  source "$script_directory/../deploy/cloud-run-config.sh"
fi

cloudrun_load_environment "${1:-cloudrun.env}"
cloudrun_validate_base
cloudrun_require_commands gcloud jq
[[ -n "$TOOL_URL" ]] ||
  cloudrun_die "set TOOL_URL to the intended custom HTTPS origin before creating a domain mapping"
cloudrun_validate_url TOOL_URL "$TOOL_URL"

domain="${TOOL_URL#https://}"
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ && "$domain" == *.* ]] ||
  cloudrun_die "TOOL_URL for Cloud Run domain mapping must be an HTTPS hostname without a path, port, query, or fragment"

if ! gcloud beta run domain-mappings describe \
  --domain="$domain" \
  --project="$PROJECT_ID" \
  --region="$REGION" >/dev/null 2>&1; then
  gcloud beta run domain-mappings create \
    --service="$SERVICE" \
    --domain="$domain" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --quiet
fi

mapping_json="$(gcloud beta run domain-mappings describe \
  --domain="$domain" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format=json)"

cat <<EOF
Cloud Run domain mapping exists for $domain.

Required DNS records and current mapping conditions:
EOF
jq '{resourceRecords: .status.resourceRecords, conditions: .status.conditions}' <<<"$mapping_json"

if jq -e '.status.conditions[]? | select(.type == "Ready" and .status == "True")' \
  <<<"$mapping_json" >/dev/null; then
  printf '\nMapping is Ready. Verify the custom origin before finalization.\n'
else
  cat <<EOF

The mapping is not Ready yet. Complete the printed DNS and domain-ownership
requirements, wait for the managed certificate, then rerun this command. Do
not set DISABLE_DEFAULT_URL_AFTER_FINALIZE=true until the custom origin passes
the documented health, readiness, JWKS, and LTI checks.
EOF
fi
