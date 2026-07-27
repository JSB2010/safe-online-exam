#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat >&2 <<EOF
usage: $0 [OPTIONS]

Guided mode is selected automatically on a terminal. Unattended mode never
prompts and reads configuration plus secret files supplied by the operator.

Options:
  --env-file FILE                       configuration file (default: cloudrun.env)
  --stage configure|prepare|install|finalize|all
  --interactive                         force the guided walkthrough
  --non-interactive                     never prompt
  --project-id ID                       set PROJECT_ID while configuring
  --region REGION                       set REGION while configuring
  --resource-name NAME                  set RESOURCE_NAME while configuring
  --cloud-sql-profile PROFILE           select the SQL profile
  --canvas-domain URL                   write the Canvas origin for install
  --canvas-api-client-id ID             write the Canvas Developer Key ID
  --canvas-api-client-secret-file FILE  copy the Developer Key secret securely
  --lti-client-id ID                    write the final Canvas LTI client ID
  --lti-deployment-id ID                write the final Canvas deployment ID
  --help                                show this help
EOF
}

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/setup-common.sh" ]]; then
  # Release bundle layout.
  # shellcheck disable=SC1091
  source "$script_directory/setup-common.sh"
  template_file="$script_directory/cloudrun.env.example"
else
  # Source repository layout.
  # shellcheck disable=SC1091
  source "$script_directory/../deploy/setup-common.sh"
  template_file="$script_directory/../deploy/cloudrun.env.example"
fi

cloudrun_phase_command() {
  local bundle_name="$1"
  local source_name="$2"
  if [[ -x "$script_directory/$bundle_name" ]]; then
    printf '%s\n' "$script_directory/$bundle_name"
  else
    printf '%s\n' "$script_directory/$source_name"
  fi
}

environment_file=cloudrun.env
stage=all
interaction_mode=auto
project_id=""
region=""
resource_name=""
sql_profile=""
canvas_domain=""
canvas_api_client_id=""
canvas_api_client_secret_file=""
lti_client_id=""
lti_deployment_id=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) shift; [[ $# -gt 0 ]] || setup_usage_error "--env-file requires a value"; environment_file="$1" ;;
    --env-file=*) environment_file="${1#*=}" ;;
    --stage) shift; [[ $# -gt 0 ]] || setup_usage_error "--stage requires a value"; stage="$1" ;;
    --stage=*) stage="${1#*=}" ;;
    --interactive)
      [[ "$interaction_mode" != "non-interactive" ]] || setup_usage_error "--interactive conflicts with --non-interactive"
      interaction_mode=interactive
      ;;
    --non-interactive)
      [[ "$interaction_mode" != "interactive" ]] || setup_usage_error "--non-interactive conflicts with --interactive"
      interaction_mode=non-interactive
      ;;
    --project-id) shift; [[ $# -gt 0 ]] || setup_usage_error "--project-id requires a value"; project_id="$1" ;;
    --project-id=*) project_id="${1#*=}" ;;
    --region) shift; [[ $# -gt 0 ]] || setup_usage_error "--region requires a value"; region="$1" ;;
    --region=*) region="${1#*=}" ;;
    --resource-name) shift; [[ $# -gt 0 ]] || setup_usage_error "--resource-name requires a value"; resource_name="$1" ;;
    --resource-name=*) resource_name="${1#*=}" ;;
    --cloud-sql-profile) shift; [[ $# -gt 0 ]] || setup_usage_error "--cloud-sql-profile requires a value"; sql_profile="$1" ;;
    --cloud-sql-profile=*) sql_profile="${1#*=}" ;;
    --canvas-domain) shift; [[ $# -gt 0 ]] || setup_usage_error "--canvas-domain requires a value"; canvas_domain="$1" ;;
    --canvas-domain=*) canvas_domain="${1#*=}" ;;
    --canvas-api-client-id) shift; [[ $# -gt 0 ]] || setup_usage_error "--canvas-api-client-id requires a value"; canvas_api_client_id="$1" ;;
    --canvas-api-client-id=*) canvas_api_client_id="${1#*=}" ;;
    --canvas-api-client-secret-file) shift; [[ $# -gt 0 ]] || setup_usage_error "--canvas-api-client-secret-file requires a value"; canvas_api_client_secret_file="$1" ;;
    --canvas-api-client-secret-file=*) canvas_api_client_secret_file="${1#*=}" ;;
    --lti-client-id) shift; [[ $# -gt 0 ]] || setup_usage_error "--lti-client-id requires a value"; lti_client_id="$1" ;;
    --lti-client-id=*) lti_client_id="${1#*=}" ;;
    --lti-deployment-id) shift; [[ $# -gt 0 ]] || setup_usage_error "--lti-deployment-id requires a value"; lti_deployment_id="$1" ;;
    --lti-deployment-id=*) lti_deployment_id="${1#*=}" ;;
    --help) usage; exit 0 ;;
    *) usage; setup_usage_error "unknown option: $1" ;;
  esac
  shift
done

[[ "$stage" =~ ^(configure|prepare|install|finalize|all)$ ]] ||
  setup_usage_error "--stage must be configure, prepare, install, finalize, or all"
interaction_mode="$(setup_resolve_mode "$interaction_mode")"

if [[ ! -e "$environment_file" ]]; then
  cp "$template_file" "$environment_file"
  chmod 600 "$environment_file"
elif [[ ! -f "$environment_file" || -L "$environment_file" ]]; then
  setup_usage_error "configuration file must be a regular file: $environment_file"
fi

if [[ "$interaction_mode" == "interactive" &&
  ("$stage" == "configure" || "$stage" == "prepare" || "$stage" == "all") ]]; then
  printf '\nSafe Online Exam guided Cloud Run setup\n\n'
  project_default="$(setup_read_env_value "$environment_file" PROJECT_ID)"
  [[ "$project_default" == replace-* ]] && project_default=""
  project_id="$(setup_prompt_value "Google Cloud project ID" "${project_id:-$project_default}")"
  region="$(setup_prompt_value "Google Cloud region" "${region:-$(setup_read_env_value "$environment_file" REGION)}")"
  resource_name="$(setup_prompt_value "Resource name prefix" "${resource_name:-$(setup_read_env_value "$environment_file" RESOURCE_NAME)}")"
  current_minimum_instances="$(setup_read_env_value "$environment_file" MIN_INSTANCES)"
  warm_default=no
  [[ "$current_minimum_instances" == "1" ]] && warm_default=yes
  if setup_prompt_yes_no "Keep one Cloud Run instance warm (about \$21/month)" "$warm_default"; then
    minimum_instances=1
  else
    minimum_instances=0
  fi
  setup_set_env_value "$environment_file" MIN_INSTANCES "$minimum_instances"
  if setup_prompt_yes_no "Use Instructure-hosted Canvas Cloud endpoints" "yes"; then
    setup_set_env_value "$environment_file" LTI_ISSUER https://canvas.instructure.com
    setup_set_env_value "$environment_file" LTI_KEY_SET_URL https://sso.canvaslms.com/api/lti/security/jwks
    setup_set_env_value "$environment_file" LTI_AUTH_URL https://sso.canvaslms.com/api/lti/authorize_redirect
  else
    lti_issuer="$(setup_prompt_value "Self-hosted Canvas LTI issuer" "$(setup_read_env_value "$environment_file" LTI_ISSUER)")"
    lti_key_set_url="$(setup_prompt_value "Self-hosted Canvas JWKS URL" "$(setup_read_env_value "$environment_file" LTI_KEY_SET_URL)")"
    lti_auth_url="$(setup_prompt_value "Self-hosted Canvas authorization URL" "$(setup_read_env_value "$environment_file" LTI_AUTH_URL)")"
    setup_set_env_value "$environment_file" LTI_ISSUER "$lti_issuer"
    setup_set_env_value "$environment_file" LTI_KEY_SET_URL "$lti_key_set_url"
    setup_set_env_value "$environment_file" LTI_AUTH_URL "$lti_auth_url"
  fi
fi

[[ -z "$project_id" ]] || setup_set_env_value "$environment_file" PROJECT_ID "$project_id"
[[ -z "$region" ]] || setup_set_env_value "$environment_file" REGION "$region"
[[ -z "$resource_name" ]] || setup_set_env_value "$environment_file" RESOURCE_NAME "$resource_name"
[[ -z "$sql_profile" ]] || setup_set_env_value "$environment_file" CLOUD_SQL_PROFILE "$sql_profile"

if [[ "$stage" == "configure" ]]; then
  printf 'Configuration saved in %s\n' "$environment_file"
  exit 0
fi

# Load the derived bootstrap directory after configuration is complete.
if [[ -f "$script_directory/cloud-run-config.sh" ]]; then
  # shellcheck disable=SC1091
  source "$script_directory/cloud-run-config.sh"
else
  # shellcheck disable=SC1091
  source "$script_directory/../deploy/cloud-run-config.sh"
fi
cloudrun_load_environment "$environment_file"
cloudrun_validate_base

doctor_command="$(cloudrun_phase_command doctor.sh doctor-cloud-run.sh)"
bootstrap_command="$(cloudrun_phase_command bootstrap-secrets.sh bootstrap-cloud-run-secrets.sh)"
prepare_command="$(cloudrun_phase_command prepare.sh prepare-cloud-run.sh)"
install_command="$(cloudrun_phase_command install.sh install-cloud-run.sh)"
finalize_command="$(cloudrun_phase_command finalize-lti.sh finalize-cloud-run-lti.sh)"

run_prepare=false
run_install=false
run_finalize=false
case "$stage" in
  prepare) run_prepare=true ;;
  install) run_install=true ;;
  finalize) run_finalize=true ;;
  all) run_prepare=true; run_install=true; run_finalize=true ;;
esac

if [[ "$run_prepare" == "true" ]]; then
  "$doctor_command" "$environment_file"
  if [[ ! -e "$BOOTSTRAP_DIRECTORY" && ! -e "$CLIENT_IDENTITY_DIRECTORY" ]]; then
    "$bootstrap_command" "$environment_file"
  elif [[ ! -d "$BOOTSTRAP_DIRECTORY" || ! -d "$CLIENT_IDENTITY_DIRECTORY" ]]; then
    setup_die "bootstrap state is incomplete; inspect it before continuing"
  fi
  prepare_arguments=("$environment_file" --create-sql)
  if [[ "$interaction_mode" == "interactive" ]]; then
    prepare_arguments+=(--interactive)
  else
    prepare_arguments+=(--non-interactive)
  fi
  [[ -z "$sql_profile" ]] || prepare_arguments+=(--cloud-sql-profile "$sql_profile")
  "$prepare_command" "${prepare_arguments[@]}"
fi

if [[ "$run_install" == "true" ]]; then
  [[ -d "$BOOTSTRAP_DIRECTORY" ]] ||
    setup_die "bootstrap state is missing; run --stage prepare first"
  tool_url="$(<"$BOOTSTRAP_DIRECTORY/tool_url")"
  if [[ "$interaction_mode" == "interactive" ]]; then
    cat <<EOF

Cloud Run is reserved at:
  $tool_url

In Canvas, create the API Developer Key with redirect URI:
  $tool_url/api/oauth2callback

Return here with the Canvas values. The secret is entered without echo.
EOF
    canvas_domain="$(setup_prompt_value "Canvas origin, including https://" "$canvas_domain")"
    canvas_api_client_id="$(setup_prompt_value "Canvas Developer Key ID" "$canvas_api_client_id")"
    canvas_api_client_secret="$(setup_prompt_secret "Canvas Developer Key secret")"
    setup_write_secret "$BOOTSTRAP_DIRECTORY/canvas_api_client_secret" "$canvas_api_client_secret"
  elif [[ -n "$canvas_api_client_secret_file" ]]; then
    setup_copy_secret_file "$canvas_api_client_secret_file" "$BOOTSTRAP_DIRECTORY/canvas_api_client_secret"
  fi
  [[ -z "$canvas_domain" ]] || setup_write_secret "$BOOTSTRAP_DIRECTORY/canvas_domain" "$canvas_domain"
  [[ -z "$canvas_api_client_id" ]] || setup_write_secret "$BOOTSTRAP_DIRECTORY/canvas_api_client_id" "$canvas_api_client_id"
  setup_require_configured_value CANVAS_DOMAIN "$(<"$BOOTSTRAP_DIRECTORY/canvas_domain")"
  setup_require_configured_value CANVAS_API_CLIENT_ID "$(<"$BOOTSTRAP_DIRECTORY/canvas_api_client_id")"
  [[ -s "$BOOTSTRAP_DIRECTORY/canvas_api_client_secret" ]] ||
    setup_usage_error "provide --canvas-api-client-secret-file for unattended installation"
  "$install_command" "$environment_file"
fi

if [[ "$run_finalize" == "true" ]]; then
  [[ -d "$BOOTSTRAP_DIRECTORY" ]] ||
    setup_die "bootstrap state is missing; run the earlier stages first"
  tool_url="$(<"$BOOTSTRAP_DIRECTORY/tool_url")"
  if [[ "$interaction_mode" == "interactive" ]]; then
    cat <<EOF

Create and install the Canvas LTI registration using:
  $tool_url/lti/config

Return here with the identifiers Canvas assigned.
EOF
    lti_client_id="$(setup_prompt_value "Canvas LTI client ID" "$lti_client_id")"
    lti_deployment_id="$(setup_prompt_value "Canvas LTI deployment ID" "$lti_deployment_id")"
  fi
  [[ -z "$lti_client_id" ]] || setup_write_secret "$BOOTSTRAP_DIRECTORY/lti_client_id" "$lti_client_id"
  [[ -z "$lti_deployment_id" ]] || setup_write_secret "$BOOTSTRAP_DIRECTORY/lti_deployment_id" "$lti_deployment_id"
  setup_require_configured_value LTI_CLIENT_ID "$(<"$BOOTSTRAP_DIRECTORY/lti_client_id")"
  setup_require_configured_value LTI_DEPLOYMENT_ID "$(<"$BOOTSTRAP_DIRECTORY/lti_deployment_id")"
  [[ "$(<"$BOOTSTRAP_DIRECTORY/lti_client_id")" != "bootstrap-pending" ]] ||
    setup_usage_error "provide --lti-client-id for unattended finalization"
  [[ "$(<"$BOOTSTRAP_DIRECTORY/lti_deployment_id")" != "bootstrap-pending" ]] ||
    setup_usage_error "provide --lti-deployment-id for unattended finalization"
  "$finalize_command" "$environment_file"
fi

cat <<EOF

Cloud Run setup stage '$stage' completed.
Configuration: $environment_file
Next operations: use doctor.sh, upgrade.sh, and rollback.sh as documented.
EOF
