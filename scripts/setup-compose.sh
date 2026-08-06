#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat >&2 <<EOF
usage: $0 [OPTIONS]

Options:
  --env-file FILE                       configuration file (default: .env.secrets)
  --interactive                         force the guided walkthrough
  --non-interactive                     never prompt
  --bootstrap                           generate missing runtime/client secrets
  --caddy                               enable managed public HTTPS
  --no-caddy                            use an existing reverse proxy
  --configure-only                      validate configuration without starting
  --canvas-api-client-secret-file FILE  copy the Developer Key secret securely
  --client-identity-directory DIR       client-only certificate output directory
  --help                                show this help
EOF
}

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/setup-common.sh" ]]; then
  # Release bundle layout.
  # shellcheck disable=SC1091
  source "$script_directory/setup-common.sh"
  template_file="$script_directory/.env.compose.secrets.example"
else
  # Source repository layout.
  # shellcheck disable=SC1091
  source "$script_directory/../deploy/setup-common.sh"
  template_file="$script_directory/../.env.compose.secrets.example"
fi

compose_bundle_command() {
  local bundle_name="$1"
  local source_name="$2"
  if [[ -x "$script_directory/$bundle_name" ]]; then
    printf '%s\n' "$script_directory/$bundle_name"
  else
    printf '%s\n' "$script_directory/$source_name"
  fi
}

environment_file=.env.secrets
interaction_mode=auto
bootstrap_requested=false
caddy_mode=auto
configure_only=false
canvas_api_client_secret_file=""
identity_directory=.local/seb-client-identity

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) shift; [[ $# -gt 0 ]] || setup_usage_error "--env-file requires a value"; environment_file="$1" ;;
    --env-file=*) environment_file="${1#*=}" ;;
    --interactive)
      [[ "$interaction_mode" != "non-interactive" ]] || setup_usage_error "--interactive conflicts with --non-interactive"
      interaction_mode=interactive
      ;;
    --non-interactive)
      [[ "$interaction_mode" != "interactive" ]] || setup_usage_error "--non-interactive conflicts with --interactive"
      interaction_mode=non-interactive
      ;;
    --bootstrap) bootstrap_requested=true ;;
    --caddy)
      [[ "$caddy_mode" != "disabled" ]] || setup_usage_error "--caddy conflicts with --no-caddy"
      caddy_mode=enabled
      ;;
    --no-caddy)
      [[ "$caddy_mode" != "enabled" ]] || setup_usage_error "--no-caddy conflicts with --caddy"
      caddy_mode=disabled
      ;;
    --configure-only) configure_only=true ;;
    --canvas-api-client-secret-file)
      shift
      [[ $# -gt 0 ]] || setup_usage_error "--canvas-api-client-secret-file requires a value"
      canvas_api_client_secret_file="$1"
      ;;
    --canvas-api-client-secret-file=*) canvas_api_client_secret_file="${1#*=}" ;;
    --client-identity-directory)
      shift
      [[ $# -gt 0 ]] || setup_usage_error "--client-identity-directory requires a value"
      identity_directory="$1"
      ;;
    --client-identity-directory=*) identity_directory="${1#*=}" ;;
    --help) usage; exit 0 ;;
    *) usage; setup_usage_error "unknown option: $1" ;;
  esac
  shift
done

interaction_mode="$(setup_resolve_mode "$interaction_mode")"
if [[ ! -e "$environment_file" ]]; then
  cp "$template_file" "$environment_file"
  chmod 600 "$environment_file"
elif [[ ! -f "$environment_file" || -L "$environment_file" ]]; then
  setup_usage_error "configuration file must be a regular file: $environment_file"
fi

if [[ "$interaction_mode" == "interactive" ]]; then
  printf '\nSafe Online Exam guided Docker Compose setup\n\n'
  if [[ "$caddy_mode" == "auto" ]]; then
    if setup_prompt_yes_no "Use bundled Caddy for public HTTPS" "yes"; then
      caddy_mode=enabled
    else
      caddy_mode=disabled
    fi
  fi
  if [[ "$caddy_mode" == "enabled" ]]; then
    public_host="$(setup_prompt_value "Public DNS hostname" "$(setup_read_env_value "$environment_file" PUBLIC_HOST)")"
    [[ "$public_host" == *.example.edu ]] && public_host="$(setup_prompt_value "Public DNS hostname" "")"
    tool_url="https://$public_host"
    setup_set_env_value "$environment_file" PUBLIC_HOST "$public_host"
  else
    tool_default="$(setup_read_env_value "$environment_file" TOOL_URL)"
    [[ "$tool_default" == *example.edu ]] && tool_default=""
    tool_url="$(setup_prompt_value "Public HTTPS tool URL from your reverse proxy" "$tool_default")"
    setup_set_env_value "$environment_file" PUBLIC_HOST ""
  fi
  canvas_default="$(setup_read_env_value "$environment_file" CANVAS_DOMAIN)"
  [[ "$canvas_default" == *example.* || "$canvas_default" == *school.instructure.com ]] && canvas_default=""
  canvas_domain="$(setup_prompt_value "Canvas origin, including https://" "$canvas_default")"
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
  lti_client_id="$(setup_prompt_value "Canvas LTI client ID" "")"
  lti_deployment_id="$(setup_prompt_value "Canvas LTI deployment ID" "")"
  canvas_api_client_id="$(setup_prompt_value "Canvas Developer Key ID" "")"
  setup_set_env_value "$environment_file" TOOL_URL "$tool_url"
  setup_set_env_value "$environment_file" CANVAS_REDIRECT_URI "${tool_url%/}/api/oauth2callback"
  setup_set_env_value "$environment_file" CANVAS_DOMAIN "$canvas_domain"
  setup_set_env_value "$environment_file" LTI_CLIENT_ID "$lti_client_id"
  setup_set_env_value "$environment_file" LTI_DEPLOYMENT_ID "$lti_deployment_id"
  setup_set_env_value "$environment_file" CANVAS_API_CLIENT_ID "$canvas_api_client_id"
  if setup_prompt_yes_no "Require managed-client certificate encryption for .seb files" "yes"; then
    setup_set_env_value "$environment_file" SEB_CONFIG_ENCRYPTION_ENABLED true
  else
    setup_set_env_value "$environment_file" SEB_CONFIG_ENCRYPTION_ENABLED false
  fi
  bootstrap_requested=true
fi

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a

for required_name in APP_IMAGE TOOL_URL CANVAS_DOMAIN CANVAS_REDIRECT_URI LTI_ISSUER LTI_KEY_SET_URL LTI_AUTH_URL LTI_CLIENT_ID LTI_DEPLOYMENT_ID CANVAS_API_CLIENT_ID DATABASE_NAME DATABASE_USER APP_ASSET_VERSION; do
  setup_require_configured_value "$required_name" "${!required_name:-}"
done
[[ "$APP_IMAGE" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ]] ||
  setup_usage_error "APP_IMAGE must be the exact published GHCR digest"
[[ "$TOOL_URL" =~ ^https://[^[:space:]]+$ ]] ||
  setup_usage_error "TOOL_URL must be a public HTTPS URL"
[[ "$CANVAS_DOMAIN" =~ ^https://[^[:space:]]+$ ]] ||
  setup_usage_error "CANVAS_DOMAIN must be an HTTPS origin"

secrets_directory="${SECRETS_DIRECTORY:-./secrets}"
bootstrap_command="$(compose_bundle_command bootstrap-secrets.sh bootstrap-compose-secrets.sh)"
if [[ ! -e "$secrets_directory" ]]; then
  [[ ! -e "$identity_directory" ]] ||
    setup_die "client identity exists without runtime secrets; inspect it before continuing"
  [[ "$bootstrap_requested" == "true" ]] ||
    setup_usage_error "runtime secrets are missing; rerun with --bootstrap"
  APP_IMAGE="$APP_IMAGE" "$bootstrap_command" "$secrets_directory" "$identity_directory"
elif [[ ! -d "$secrets_directory" ]]; then
  setup_die "runtime secret path is not a directory: $secrets_directory"
fi

if [[ "$interaction_mode" == "interactive" ]]; then
  canvas_api_client_secret="$(setup_prompt_secret "Canvas Developer Key secret")"
  setup_write_secret "$secrets_directory/canvas_api_client_secret" "$canvas_api_client_secret"
elif [[ -n "$canvas_api_client_secret_file" ]]; then
  setup_copy_secret_file "$canvas_api_client_secret_file" "$secrets_directory/canvas_api_client_secret"
fi
[[ -s "$secrets_directory/canvas_api_client_secret" ]] ||
  setup_usage_error "provide --canvas-api-client-secret-file in unattended mode"

for secret_file in database_password lti_private_key session_secret state_encryption_key oauth_token_encryption_keyring seb-config-encryption.crt.pem; do
  [[ -f "$secrets_directory/$secret_file" && ! -L "$secrets_directory/$secret_file" &&
    -s "$secrets_directory/$secret_file" ]] ||
    setup_die "required runtime secret is missing or empty: $secrets_directory/$secret_file"
done
[[ -f "$secrets_directory/seb_quit_password" && ! -L "$secrets_directory/seb_quit_password" ]] ||
  setup_die "required runtime secret file is missing: $secrets_directory/seb_quit_password"

for command_name in curl docker; do
  command -v "$command_name" >/dev/null 2>&1 ||
    setup_die "required command is unavailable: $command_name"
done
docker info >/dev/null 2>&1 || setup_die "Docker is installed but its engine is unavailable"

compose=(docker compose --env-file "$environment_file" -f compose.yaml -f compose.secrets.yaml)
if [[ "$caddy_mode" == "enabled" ]]; then
  setup_require_configured_value PUBLIC_HOST "${PUBLIC_HOST:-}"
  compose+=(-f compose.caddy.yaml --profile caddy)
fi
"${compose[@]}" config --quiet

if [[ "$configure_only" == "true" ]]; then
  printf 'Compose configuration and protected inputs are valid.\n'
  exit 0
fi
if [[ "$interaction_mode" == "interactive" ]] &&
  ! setup_prompt_yes_no "Start Safe Online Exam now" "yes"; then
  printf 'Configuration is ready. Re-run setup.sh when you are ready to start.\n'
  exit 0
fi

"${compose[@]}" pull
"${compose[@]}" up -d --wait
bind_address="${BIND_ADDRESS:-127.0.0.1}"
[[ "$bind_address" == "0.0.0.0" ]] && bind_address=127.0.0.1
curl --fail --silent --show-error \
  --retry 8 --retry-delay 2 --retry-all-errors \
  "http://$bind_address:${APP_PORT:-8080}/ready" >/dev/null

cat <<EOF

Docker Compose setup completed.
Public URL:      $TOOL_URL
Configuration:   $environment_file
Runtime secrets: $secrets_directory
Client identity: $identity_directory

Move the client identity to approved MDM storage and configure backups before
go-live. Use backup.sh and upgrade.sh for ongoing operations.
EOF
