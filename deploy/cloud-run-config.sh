#!/usr/bin/env bash

# Shared Cloud Run deployment contract. This file is sourced by the portable
# release-bundle commands; it must not print secret values.

cloudrun_die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cloudrun_usage_error() {
  printf 'error: %s\n' "$*" >&2
  exit 64
}

cloudrun_require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null 2>&1 ||
      cloudrun_die "required command is unavailable: $command_name"
  done
}

cloudrun_require_explicit_oauth_token_encryption_mode() {
  local environment_file="$1"
  local line
  local found_assignment=false
  local assignment_pattern
  local key_pattern
  [[ -f "$environment_file" && ! -L "$environment_file" ]] ||
    cloudrun_usage_error "configuration file must be a regular file: $environment_file"
  assignment_pattern="^[[:space:]]*(export[[:space:]]+)?OAUTH_TOKEN_ENCRYPTION_MODE[[:space:]]*=[[:space:]]*(compat|enforce|\"compat\"|\"enforce\"|'compat'|'enforce')[[:space:]]*(#.*)?$"
  key_pattern='^[[:space:]]*(export[[:space:]]+)?OAUTH_TOKEN_ENCRYPTION_MODE[[:space:]]*='
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $assignment_pattern ]]; then
      [[ "$found_assignment" == "false" ]] ||
        cloudrun_usage_error "OAUTH_TOKEN_ENCRYPTION_MODE must be assigned exactly once in $environment_file"
      found_assignment=true
    elif [[ "$line" =~ $key_pattern ]]; then
      cloudrun_usage_error \
        "OAUTH_TOKEN_ENCRYPTION_MODE must be assigned literally to compat or enforce in $environment_file"
    fi
  done <"$environment_file"
  [[ "$found_assignment" == "true" ]] && return 0
  cloudrun_usage_error \
    "OAUTH_TOKEN_ENCRYPTION_MODE must be set explicitly in $environment_file before an upgrade"
}

cloudrun_script_directory() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

cloudrun_load_environment() {
  local environment_file="${1:-cloudrun.env}"
  local environment_directory environment_name
  [[ -f "$environment_file" && ! -L "$environment_file" ]] ||
    cloudrun_usage_error "configuration file must be a regular file: $environment_file"

  environment_directory="$(cd "$(dirname "$environment_file")" && pwd -P)"
  environment_name="$(basename "$environment_file")"
  CLOUDRUN_ENVIRONMENT_FILE="$environment_directory/$environment_name"
  CLOUDRUN_DEPLOYMENT_DIRECTORY="$environment_directory"

  # The operator owns this protected configuration file. Shell syntax keeps the
  # downloaded bundle usable in macOS, Linux, and Cloud Shell without another
  # parser dependency.
  set -a
  # shellcheck disable=SC1090
  source "$CLOUDRUN_ENVIRONMENT_FILE"
  set +a

  : "${RESOURCE_NAME:=safe-online-exam}"
  : "${SERVICE:=$RESOURCE_NAME}"
  : "${SQL_INSTANCE:=$RESOURCE_NAME}"
  : "${APP_ENV:=prod}"
  : "${DATABASE_NAME:=safe_online_exam}"
  : "${DATABASE_USER:=safe_online_exam}"
  : "${DATABASE_POOL_MAX:=5}"
  : "${SECRET_PREFIX:=${RESOURCE_NAME//-/_}}"
  : "${RUNTIME_SERVICE_ACCOUNT_NAME:=$RESOURCE_NAME}"
  : "${SCHEDULER_SERVICE_ACCOUNT_NAME:=${RESOURCE_NAME}-sched}"
  : "${CLOUD_SQL_PROFILE:=production-zonal}"
  : "${CLOUD_SQL_STORAGE_SIZE_GB:=20}"
  : "${CLOUD_SQL_STORAGE_AUTO_INCREASE_LIMIT_GB:=100}"
  : "${CLOUD_SQL_BACKUP_START_TIME:=06:00}"
  : "${CLOUD_SQL_RETAINED_BACKUPS:=14}"
  : "${CLOUD_SQL_PITR_DAYS:=7}"
  : "${CLOUD_SQL_FINAL_BACKUP_RETENTION_DAYS:=30}"
  : "${CLOUD_SQL_MAINTENANCE_DAY:=SUN}"
  : "${CLOUD_SQL_MAINTENANCE_HOUR:=9}"
  : "${LTI_DEPLOYMENT_ID_CHECKING_ENABLED:=true}"
  : "${LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS:=true}"
  : "${OAUTH_TOKEN_ENCRYPTION_MODE:=enforce}"
  : "${OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID:=primary}"
  : "${SEB_CONFIG_ENCRYPTION_ENABLED:=true}"
  : "${LTI_ISSUER:=https://canvas.instructure.com}"
  : "${LTI_KEY_SET_URL:=https://sso.canvaslms.com/api/lti/security/jwks}"
  : "${LTI_AUTH_URL:=https://sso.canvaslms.com/api/lti/authorize_redirect}"
  : "${MEMORY:=2Gi}"
  : "${CPU:=2}"
  : "${MIN_INSTANCES:=1}"
  : "${MAX_INSTANCES:=10}"
  : "${REQUEST_TIMEOUT:=600s}"
  : "${CLEANUP_SCHEDULE:=17 3 * * *}"
  : "${CLEANUP_TIME_ZONE:=Etc/UTC}"
  : "${PUBLIC_ACCESS:=true}"
  : "${DISABLE_DEFAULT_URL_AFTER_FINALIZE:=false}"
  : "${CLOUD_SQL_API_READY_TIMEOUT_SECONDS:=300}"
  : "${CLOUD_SQL_INSTANCE_READY_TIMEOUT_SECONDS:=900}"
  : "${CLOUD_SQL_RETRY_INTERVAL_SECONDS:=5}"
  : "${BOOTSTRAP_DIRECTORY:=.local/safe-online-exam-cloudrun-bootstrap}"
  : "${CLIENT_IDENTITY_DIRECTORY:=.local/safe-online-exam-client-identity}"
  : "${STATE_DIRECTORY:=.state}"
  : "${ALLOW_EXISTING_DATABASE_USER:=false}"
  : "${TOOL_URL:=}"
  : "${CANVAS_DOMAIN:=}"
  : "${CANVAS_API_CLIENT_ID:=}"

  # Relative protected paths belong to the durable directory containing the
  # operator's cloudrun.env, not to whichever new release bundle invokes the
  # upgrade command.
  [[ "$BOOTSTRAP_DIRECTORY" == /* ]] ||
    BOOTSTRAP_DIRECTORY="$CLOUDRUN_DEPLOYMENT_DIRECTORY/$BOOTSTRAP_DIRECTORY"
  [[ "$CLIENT_IDENTITY_DIRECTORY" == /* ]] ||
    CLIENT_IDENTITY_DIRECTORY="$CLOUDRUN_DEPLOYMENT_DIRECTORY/$CLIENT_IDENTITY_DIRECTORY"
  [[ "$STATE_DIRECTORY" == /* ]] ||
    STATE_DIRECTORY="$CLOUDRUN_DEPLOYMENT_DIRECTORY/$STATE_DIRECTORY"

  # Keep the original release-candidate profile names compatible without
  # changing the resources they describe.
  case "$CLOUD_SQL_PROFILE" in
    production-balanced) CLOUD_SQL_PROFILE=production-ha ;;
    production-capacity) CLOUD_SQL_PROFILE=production-capacity-ha ;;
  esac

  CLOUDRUN_BUNDLE_DIRECTORY="$(cloudrun_script_directory)"
  CLOUDRUN_CONTRACT="$CLOUDRUN_BUNDLE_DIRECTORY/cloud-run-contract.json"
  CLOUDRUN_SECRET_VERSION_STATE="$STATE_DIRECTORY/secret-versions.env"
  # These values are the public interface consumed by the sourcing scripts.
  # shellcheck disable=SC2034
  CLOUDRUN_RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT_NAME}@${PROJECT_ID:-invalid}.iam.gserviceaccount.com"
  # shellcheck disable=SC2034
  CLOUDRUN_SCHEDULER_SERVICE_ACCOUNT="${SCHEDULER_SERVICE_ACCOUNT_NAME}@${PROJECT_ID:-invalid}.iam.gserviceaccount.com"
  CLOUDRUN_CONNECTION_NAME="${PROJECT_ID:-invalid}:${REGION:-invalid}:${SQL_INSTANCE:-invalid}"
  # shellcheck disable=SC2034
  CLOUDRUN_MIGRATE_JOB="${SERVICE:-invalid}-migrate"
  # shellcheck disable=SC2034
  CLOUDRUN_CLEANUP_JOB="${SERVICE:-invalid}-cleanup"
  # shellcheck disable=SC2034
  CLOUDRUN_OAUTH_TOKEN_ENCRYPTION_JOB="${SERVICE:-invalid}-encrypt-oauth-tokens"
  # shellcheck disable=SC2034
  CLOUDRUN_SCHEDULER_JOB="${SERVICE:-invalid}-cleanup"
}

cloudrun_validate_boolean() {
  local name="$1"
  local value="$2"
  [[ "$value" == "true" || "$value" == "false" ]] ||
    cloudrun_usage_error "$name must be true or false"
}

cloudrun_sql_profile_ids() {
  printf '%s\n' \
    production-zonal \
    production-ha \
    production-capacity-zonal \
    production-capacity-ha \
    pilot-shared-small-zonal \
    pilot-shared-small-ha \
    development-micro-zonal \
    development-micro-ha \
    existing-reviewed
}

cloudrun_sql_profile_from_choice() {
  case "$1" in
    1 | production-zonal) printf 'production-zonal\n' ;;
    2 | production-ha) printf 'production-ha\n' ;;
    3 | production-capacity-zonal) printf 'production-capacity-zonal\n' ;;
    4 | production-capacity-ha) printf 'production-capacity-ha\n' ;;
    5 | pilot-shared-small-zonal) printf 'pilot-shared-small-zonal\n' ;;
    6 | pilot-shared-small-ha) printf 'pilot-shared-small-ha\n' ;;
    7 | development-micro-zonal) printf 'development-micro-zonal\n' ;;
    8 | development-micro-ha) printf 'development-micro-ha\n' ;;
    9 | existing-reviewed) printf 'existing-reviewed\n' ;;
    *) return 1 ;;
  esac
}

cloudrun_print_sql_profile_catalog() {
  cat <<'EOF'
Safe Online Exam Cloud SQL profiles
Prices are approximate USD/month for us-central1 as of July 26, 2026. Created
profiles include 20 GB SSD and an estimated $1/month of standard backup storage.
Other regions, storage use, taxes, networking, and future price changes vary.

1) production-zonal — Budget Production [RECOMMENDED]
   Price: ~$54 on demand; ~$41 with 1-year CUD; ~$28 with 3-year CUD
   Term:  On demand by default; optional 1- or 3-year billing commitment
   Features: 1 dedicated vCPU, 3.75 GiB RAM, one zone, predictable performance,
             backups, 7-day PITR, deletion protection, encrypted connector access
   Recommended? YES for most schools that accept manual recovery from a zone outage

2) production-ha — High Availability Production
   Price: ~$106 on demand; ~$82 with 1-year CUD; ~$55 with 3-year CUD
   Term:  On demand by default; optional 1- or 3-year billing commitment
   Features: 1 dedicated vCPU, 3.75 GiB RAM, regional cross-zone HA, automatic
             failover, 99.95% Enterprise HA SLA, and all data-protection controls
   Recommended? YES when uninterrupted exam-launch availability is required

3) production-capacity-zonal — Larger Budget Production
   Price: ~$103 on demand; ~$78 with 1-year CUD; ~$52 with 3-year CUD
   Term:  On demand by default; optional 1- or 3-year billing commitment
   Features: 2 dedicated vCPU, 7.5 GiB RAM, one zone, and all data-protection controls
   Recommended? CONDITIONAL; load-test before paying for capacity Safe Online Exam
                normally does not need

4) production-capacity-ha — Larger High Availability Production
   Price: ~$205 on demand; ~$156 with 1-year CUD; ~$103 with 3-year CUD
   Term:  On demand by default; optional 1- or 3-year billing commitment
   Features: 2 dedicated vCPU, 7.5 GiB RAM, regional HA, automatic failover,
             99.95% Enterprise HA SLA, and all data-protection controls
   Recommended? CONDITIONAL for unusually large, benchmarked workloads

5) pilot-shared-small-zonal — Shared-Core Pilot
   Price: ~$30 on demand
   Term:  On demand only; shared-core machines are not CUD eligible
   Features: db-g1-small, 1.7 GiB RAM, shared CPU, one zone, plus backups, PITR,
             deletion protection, and encrypted connector access
   Recommended? NO for production; acceptable only for a small measured pilot

6) pilot-shared-small-ha — Shared-Core Pilot with Cross-Zone Failover
   Price: ~$59 on demand
   Term:  On demand only; shared-core machines are not CUD eligible
   Features: db-g1-small, 1.7 GiB RAM, shared CPU, regional failover, plus all
             data-protection controls; shared-core remains outside the SLA
   Recommended? NO; dedicated production-zonal is faster and slightly cheaper

7) development-micro-zonal — Development Micro
   Price: ~$12 on demand
   Term:  On demand only; shared-core machines are not CUD eligible
   Features: db-f1-micro, ~0.6 GiB RAM, shared CPU, one zone, 20-operation limit,
             plus backups, PITR, deletion protection, and encrypted connector access
   Recommended? NO; development and disposable evaluation only

8) development-micro-ha — Development Micro with Cross-Zone Failover
   Price: ~$23 on demand
   Term:  On demand only; shared-core machines are not CUD eligible
   Features: db-f1-micro, ~0.6 GiB RAM, shared CPU, regional failover, plus all
             data-protection controls; shared-core remains outside the SLA
   Recommended? NO; failover does not fix the micro tier's capacity limitations

9) existing-reviewed — Institution-Supplied Cloud SQL
   Price: Institution selected
   Term:  Institution selected
   Features: Uses an existing PostgreSQL 17 instance in the configured region;
             the bundle does not create or resize it
   Recommended? CONDITIONAL when the institution already operates reviewed Cloud SQL

Cloud SQL committed use discounts (CUDs) apply to eligible CPU and memory
spend across a billing account and region. They do not attach to this instance,
do not discount storage or backups, and cannot be cancelled after purchase.
This installer never purchases a CUD. Complete that separate billing-account
decision only after verifying the live Google Cloud estimate.

Current pricing: https://cloud.google.com/sql/pricing
CUD terms:       https://cloud.google.com/sql/docs/postgres/cud
SLA:             https://cloud.google.com/sql/sla
EOF
}

cloudrun_prompt_sql_profile() {
  local choice selected
  cloudrun_print_sql_profile_catalog >&2
  while true; do
    printf '\nChoose a Cloud SQL profile [1]: ' >&2
    if ! IFS= read -r choice; then
      cloudrun_die "interactive Cloud SQL profile selection was cancelled"
    fi
    choice="${choice:-1}"
    if selected="$(cloudrun_sql_profile_from_choice "$choice")"; then
      printf '%s\n' "$selected"
      return
    fi
    printf 'Enter a number from 1 through 9 or an exact profile name.\n' >&2
  done
}

cloudrun_validate_base() {
  local required_variable
  for required_variable in APP_VERSION APP_IMAGE PROJECT_ID REGION RESOURCE_NAME SERVICE SQL_INSTANCE DATABASE_NAME DATABASE_USER SECRET_PREFIX; do
    [[ -n "${!required_variable:-}" ]] ||
      cloudrun_usage_error "$required_variable must be set in the configuration file"
  done

  [[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] ||
    cloudrun_usage_error "APP_VERSION must be SemVer without a leading v"
  [[ "$APP_IMAGE" =~ ^ghcr\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$ ||
    "$APP_IMAGE" =~ ^[a-z0-9.-]+-docker\.pkg\.dev/[a-z0-9:._-]+/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] ||
    cloudrun_usage_error "APP_IMAGE must be the exact GHCR or Artifact Registry digest"
  [[ "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] ||
    cloudrun_usage_error "PROJECT_ID is not a valid Google Cloud project ID"
  [[ "$REGION" =~ ^[a-z]+-[a-z0-9]+[0-9]$ ]] ||
    cloudrun_usage_error "REGION is not a valid Google Cloud region"
  [[ "$RESOURCE_NAME" =~ ^[a-z][a-z0-9-]{0,22}[a-z0-9]$ ]] ||
    cloudrun_usage_error "RESOURCE_NAME must be a 2-24 character lowercase resource stem"
  [[ "$SERVICE" =~ ^[a-z][a-z0-9-]{0,47}[a-z0-9]$ ]] ||
    cloudrun_usage_error "SERVICE is not a valid Cloud Run service name"
  [[ "$SQL_INSTANCE" =~ ^[a-z][a-z0-9-]{0,96}[a-z0-9]$ ]] ||
    cloudrun_usage_error "SQL_INSTANCE is not a valid Cloud SQL instance name"
  [[ "$DATABASE_NAME" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]] ||
    cloudrun_usage_error "DATABASE_NAME is not valid"
  [[ "$DATABASE_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]] ||
    cloudrun_usage_error "DATABASE_USER is not valid"
  [[ "$SECRET_PREFIX" =~ ^[A-Za-z0-9_-]{1,200}$ ]] ||
    cloudrun_usage_error "SECRET_PREFIX is not valid"
  [[ "$RUNTIME_SERVICE_ACCOUNT_NAME" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] ||
    cloudrun_usage_error "RUNTIME_SERVICE_ACCOUNT_NAME is not valid"
  [[ "$SCHEDULER_SERVICE_ACCOUNT_NAME" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] ||
    cloudrun_usage_error "SCHEDULER_SERVICE_ACCOUNT_NAME is not valid"
  [[ "$DATABASE_POOL_MAX" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_usage_error "DATABASE_POOL_MAX must be a positive integer"
  cloudrun_sql_profile_from_choice "$CLOUD_SQL_PROFILE" >/dev/null ||
    cloudrun_usage_error "CLOUD_SQL_PROFILE is invalid; run prepare.sh --list-cloud-sql-profiles"
  [[ "$CLOUD_SQL_STORAGE_SIZE_GB" =~ ^[1-9][0-9]*$ && "$CLOUD_SQL_STORAGE_SIZE_GB" -ge 10 ]] ||
    cloudrun_usage_error "CLOUD_SQL_STORAGE_SIZE_GB must be an integer of at least 10"
  [[ "$CLOUD_SQL_STORAGE_AUTO_INCREASE_LIMIT_GB" =~ ^[1-9][0-9]*$ &&
    "$CLOUD_SQL_STORAGE_AUTO_INCREASE_LIMIT_GB" -ge "$CLOUD_SQL_STORAGE_SIZE_GB" ]] ||
    cloudrun_usage_error "CLOUD_SQL_STORAGE_AUTO_INCREASE_LIMIT_GB must be at least CLOUD_SQL_STORAGE_SIZE_GB"
  [[ "$CLOUD_SQL_BACKUP_START_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] ||
    cloudrun_usage_error "CLOUD_SQL_BACKUP_START_TIME must be HH:MM in UTC"
  [[ "$CLOUD_SQL_RETAINED_BACKUPS" =~ ^[1-9][0-9]*$ &&
    "$CLOUD_SQL_RETAINED_BACKUPS" -le 365 ]] ||
    cloudrun_usage_error "CLOUD_SQL_RETAINED_BACKUPS must be between 1 and 365"
  [[ "$CLOUD_SQL_PITR_DAYS" =~ ^[1-7]$ ]] ||
    cloudrun_usage_error "CLOUD_SQL_PITR_DAYS must be between 1 and 7 for Cloud SQL Enterprise"
  [[ "$CLOUD_SQL_FINAL_BACKUP_RETENTION_DAYS" =~ ^[1-9][0-9]*$ &&
    "$CLOUD_SQL_FINAL_BACKUP_RETENTION_DAYS" -le 365 ]] ||
    cloudrun_usage_error "CLOUD_SQL_FINAL_BACKUP_RETENTION_DAYS must be between 1 and 365"
  [[ "$CLOUD_SQL_MAINTENANCE_DAY" =~ ^(MON|TUE|WED|THU|FRI|SAT|SUN)$ ]] ||
    cloudrun_usage_error "CLOUD_SQL_MAINTENANCE_DAY must be MON through SUN"
  [[ "$CLOUD_SQL_MAINTENANCE_HOUR" =~ ^([0-9]|1[0-9]|2[0-3])$ ]] ||
    cloudrun_usage_error "CLOUD_SQL_MAINTENANCE_HOUR must be between 0 and 23 UTC"
  [[ "$APP_ENV" =~ ^[a-z][a-z0-9_-]*$ ]] ||
    cloudrun_usage_error "APP_ENV is not valid"
  [[ "$MEMORY" =~ ^[1-9][0-9]*(Mi|Gi)$ ]] ||
    cloudrun_usage_error "MEMORY must use a positive Mi or Gi value"
  [[ "$CPU" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_usage_error "CPU must be a positive integer"
  [[ "$REQUEST_TIMEOUT" =~ ^[1-9][0-9]*s$ ]] ||
    cloudrun_usage_error "REQUEST_TIMEOUT must be a positive number of seconds"
  [[ "$MIN_INSTANCES" =~ ^[0-9]+$ && "$MAX_INSTANCES" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_usage_error "MIN_INSTANCES and MAX_INSTANCES must be non-negative integers"
  ((MIN_INSTANCES <= MAX_INSTANCES)) ||
    cloudrun_usage_error "MIN_INSTANCES cannot exceed MAX_INSTANCES"

  cloudrun_validate_boolean PUBLIC_ACCESS "$PUBLIC_ACCESS"
  cloudrun_validate_boolean DISABLE_DEFAULT_URL_AFTER_FINALIZE "$DISABLE_DEFAULT_URL_AFTER_FINALIZE"
  cloudrun_validate_boolean LTI_DEPLOYMENT_ID_CHECKING_ENABLED "$LTI_DEPLOYMENT_ID_CHECKING_ENABLED"
  [[ "$LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS" =~ ^[A-Za-z0-9._-]+$ ]] ||
    cloudrun_usage_error "LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS must be a single environment-safe value"
  [[ "$OAUTH_TOKEN_ENCRYPTION_MODE" == "compat" || "$OAUTH_TOKEN_ENCRYPTION_MODE" == "enforce" ]] ||
    cloudrun_usage_error "OAUTH_TOKEN_ENCRYPTION_MODE must be compat or enforce"
  [[ "$OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
    cloudrun_usage_error "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID is invalid"
  cloudrun_validate_boolean SEB_CONFIG_ENCRYPTION_ENABLED "$SEB_CONFIG_ENCRYPTION_ENABLED"
  cloudrun_validate_boolean ALLOW_EXISTING_DATABASE_USER "$ALLOW_EXISTING_DATABASE_USER"
  [[ "$CLOUD_SQL_API_READY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_usage_error "CLOUD_SQL_API_READY_TIMEOUT_SECONDS must be a positive integer"
  [[ "$CLOUD_SQL_INSTANCE_READY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_usage_error "CLOUD_SQL_INSTANCE_READY_TIMEOUT_SECONDS must be a positive integer"
  [[ "$CLOUD_SQL_RETRY_INTERVAL_SECONDS" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_usage_error "CLOUD_SQL_RETRY_INTERVAL_SECONDS must be a positive integer"
  [[ -r "$CLOUDRUN_CONTRACT" ]] ||
    cloudrun_die "deployment contract is missing: $CLOUDRUN_CONTRACT"
}

cloudrun_sql_cpu() {
  case "$CLOUD_SQL_PROFILE" in
    production-zonal | production-ha) printf '1\n' ;;
    production-capacity-zonal | production-capacity-ha) printf '2\n' ;;
    *) printf '\n' ;;
  esac
}

cloudrun_sql_memory() {
  case "$CLOUD_SQL_PROFILE" in
    production-zonal | production-ha) printf '3840MiB\n' ;;
    production-capacity-zonal | production-capacity-ha) printf '7680MiB\n' ;;
    *) printf '\n' ;;
  esac
}

cloudrun_sql_tier() {
  case "$CLOUD_SQL_PROFILE" in
    production-zonal | production-ha) printf 'db-custom-1-3840\n' ;;
    production-capacity-zonal | production-capacity-ha) printf 'db-custom-2-7680\n' ;;
    pilot-shared-small-zonal | pilot-shared-small-ha) printf 'db-g1-small\n' ;;
    development-micro-zonal | development-micro-ha) printf 'db-f1-micro\n' ;;
    existing-reviewed) printf '\n' ;;
  esac
}

cloudrun_sql_availability() {
  case "$CLOUD_SQL_PROFILE" in
    production-zonal | production-capacity-zonal | pilot-shared-small-zonal | development-micro-zonal)
      printf 'ZONAL\n'
      ;;
    production-ha | production-capacity-ha | pilot-shared-small-ha | development-micro-ha)
      printf 'REGIONAL\n'
      ;;
    existing-reviewed) printf '\n' ;;
  esac
}

cloudrun_sql_is_shared_core() {
  case "$CLOUD_SQL_PROFILE" in
    pilot-shared-small-zonal | pilot-shared-small-ha | development-micro-zonal | development-micro-ha)
      return 0
      ;;
    *) return 1 ;;
  esac
}

cloudrun_sql_price_summary() {
  case "$CLOUD_SQL_PROFILE" in
    production-zonal) printf '~$54/month on demand; ~$41 one-year CUD; ~$28 three-year CUD' ;;
    production-ha) printf '~$106/month on demand; ~$82 one-year CUD; ~$55 three-year CUD' ;;
    production-capacity-zonal) printf '~$103/month on demand; ~$78 one-year CUD; ~$52 three-year CUD' ;;
    production-capacity-ha) printf '~$205/month on demand; ~$156 one-year CUD; ~$103 three-year CUD' ;;
    pilot-shared-small-zonal) printf '~$30/month on demand; CUD ineligible' ;;
    pilot-shared-small-ha) printf '~$59/month on demand; CUD ineligible' ;;
    development-micro-zonal) printf '~$12/month on demand; CUD ineligible' ;;
    development-micro-ha) printf '~$23/month on demand; CUD ineligible' ;;
    existing-reviewed) printf 'institution selected' ;;
  esac
}

cloudrun_sql_profile_resources() {
  local availability
  if [[ "$CLOUD_SQL_PROFILE" == "existing-reviewed" ]]; then
    printf 'institution-supplied instance; the bundle will not create it'
    return
  fi

  availability="$(cloudrun_sql_availability)"
  if cloudrun_sql_is_shared_core; then
    printf '%s shared-core, Enterprise %s' "$(cloudrun_sql_tier)" "$availability"
  else
    printf '%s vCPU, %s, Enterprise %s' \
      "$(cloudrun_sql_cpu)" "$(cloudrun_sql_memory)" "$availability"
  fi
}

cloudrun_print_resource_plan() {
  cat <<EOF
Safe Online Exam resource plan
  Project:                    $PROJECT_ID
  Region:                     $REGION
  Resource stem:              $RESOURCE_NAME
  Cloud Run service:          $SERVICE
  Cloud SQL instance:         $SQL_INSTANCE
  Cloud SQL profile:          $CLOUD_SQL_PROFILE ($(cloudrun_sql_profile_resources))
  Cloud SQL price reference:  $(cloudrun_sql_price_summary)
  PostgreSQL database/user:   $DATABASE_NAME / $DATABASE_USER
  Runtime service account:    $CLOUDRUN_RUNTIME_SERVICE_ACCOUNT
  Scheduler service account:  $CLOUDRUN_SCHEDULER_SERVICE_ACCOUNT
  Migration/cleanup jobs:     $CLOUDRUN_MIGRATE_JOB / $CLOUDRUN_CLEANUP_JOB
  Secret prefix:              ${SECRET_PREFIX}_
EOF
}

cloudrun_validate_url() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^https://[^[:space:],]+$ ]] ||
    cloudrun_usage_error "$name must be an HTTPS URL without commas or whitespace"
}

cloudrun_validate_complete() {
  cloudrun_validate_base
  cloudrun_validate_url LTI_ISSUER "$LTI_ISSUER"
  cloudrun_validate_url LTI_KEY_SET_URL "$LTI_KEY_SET_URL"
  cloudrun_validate_url LTI_AUTH_URL "$LTI_AUTH_URL"
}

cloudrun_write_random_secret() {
  local output_path="$1"
  local byte_count="${2:-48}"
  local value
  [[ "$byte_count" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_die "random secret byte count must be a positive integer"

  # Command substitution removes OpenSSL's terminal line feed. Writing with
  # printf then keeps the Cloud SQL user password byte-for-byte identical to
  # the Secret Manager value uploaded later from this file.
  value="$(openssl rand -base64 "$byte_count")" ||
    cloudrun_die "OpenSSL could not generate required secret material"
  [[ "$value" =~ ^[A-Za-z0-9+/=]+$ ]] ||
    cloudrun_die "OpenSSL generated invalid random secret material"
  printf '%s' "$value" >"$output_path"
}

cloudrun_ensure_oauth_token_encryption_bootstrap() (
  local keyring_path="$BOOTSTRAP_DIRECTORY/oauth_token_encryption_keyring"
  local temporary_file oauth_token_key

  [[ -d "$BOOTSTRAP_DIRECTORY" && ! -L "$BOOTSTRAP_DIRECTORY" ]] ||
    cloudrun_die "bootstrap directory is missing: $BOOTSTRAP_DIRECTORY"

  # Existing installations keep every previously protected value. The 1.1
  # transition adds only this new file; never replace it once it exists, even
  # when the existing path is malformed (cloudrun_assert_bootstrap reports that
  # condition without destroying operator-managed material).
  if [[ -e "$keyring_path" || -L "$keyring_path" ]]; then
    return 0
  fi

  oauth_token_key="$(openssl rand -base64 32 | tr '/+' '_-' | tr -d '=\n')" ||
    cloudrun_die "OpenSSL could not generate the OAuth token encryption key"
  [[ "$oauth_token_key" =~ ^[A-Za-z0-9_-]{43}$ ]] ||
    cloudrun_die "OpenSSL generated an invalid OAuth token encryption key"

  temporary_file="$(mktemp "$BOOTSTRAP_DIRECTORY/.oauth-token-encryption-keyring.XXXXXX")"
  trap 'rm -f -- "$temporary_file"' EXIT
  jq -cn \
    --arg key_id "$OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID" \
    --arg key "$oauth_token_key" \
    '{($key_id): $key}' >"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$keyring_path"
  trap - EXIT

  echo "Generated the new protected OAuth token encryption keyring without changing existing bootstrap values." >&2
)

cloudrun_assert_oauth_token_encryption_keyring_not_established() {
  local keyring_path="$BOOTSTRAP_DIRECTORY/oauth_token_encryption_keyring"
  local describe_error recorded_version secret_name versions

  [[ ! -e "$keyring_path" && ! -L "$keyring_path" ]] || return 0

  recorded_version=""
  if [[ -f "$CLOUDRUN_SECRET_VERSION_STATE" ]]; then
    recorded_version="$(awk -F= -v key=OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION \
      '$1 == key { value=$2 } END { print value }' "$CLOUDRUN_SECRET_VERSION_STATE")"
  fi
  [[ ! "$recorded_version" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_die "the local OAuth token encryption keyring is missing but Secret Manager version $recorded_version is already recorded; restore the protected bootstrap file instead of replacing its encryption key"

  secret_name="${SECRET_PREFIX}_oauth_token_encryption_keyring"
  if describe_error="$(gcloud secrets describe "$secret_name" --project="$PROJECT_ID" 2>&1 >/dev/null)"; then
    versions="$(gcloud secrets versions list \
      --secret="$secret_name" \
      --project="$PROJECT_ID" \
      --limit=1 \
      --format='value(name)')" ||
      cloudrun_die "could not inspect existing versions of $secret_name"
    [[ -z "$versions" ]] ||
      cloudrun_die "the local OAuth token encryption keyring is missing but $secret_name already has a Secret Manager version; restore the protected bootstrap file instead of replacing its encryption key"
  elif ! grep -qE '(^|[[:space:]])NOT_FOUND:' <<<"$describe_error"; then
    cloudrun_die "could not determine whether $secret_name already exists; Secret Manager inspection failed: $describe_error"
  fi
}

cloudrun_require_single_line_secret() {
  local name="$1"
  local file_path="$2"
  [[ -f "$file_path" && ! -L "$file_path" && -s "$file_path" ]] ||
    cloudrun_die "$name must be a non-empty regular secret file: $file_path"
  if (( $(wc -l <"$file_path") != 0 )) || LC_ALL=C grep -q $'\r' "$file_path"; then
    cloudrun_die "$name must not contain line breaks; use printf or a no-newline secret writer before retrying"
  fi
}

cloudrun_canonical_local_path() {
  local value="$1"
  local absolute_path component candidate physical_path
  local -a input_components=()
  local -a normalized_components=()
  local -a missing_components=()

  if [[ "$value" == /* ]]; then
    absolute_path="$value"
  else
    absolute_path="$(pwd -P)/$value"
  fi

  # Normalize dot segments before checking temporary roots. Resolve the nearest
  # existing parent physically as well, so an existing symlink cannot disguise
  # a temporary destination. The final directory itself need not exist yet.
  IFS=/ read -r -a input_components <<<"${absolute_path#/}"
  for component in "${input_components[@]}"; do
    case "$component" in
      '' | .) ;;
      ..)
        if (( ${#normalized_components[@]} > 0 )); then
          unset "normalized_components[${#normalized_components[@]}-1]"
        fi
        ;;
      *) normalized_components+=("$component") ;;
    esac
  done
  local IFS=/
  absolute_path="/${normalized_components[*]}"
  [[ -n "$absolute_path" ]] || absolute_path=/

  candidate="$absolute_path"
  while [[ ! -d "$candidate" ]]; do
    [[ "$candidate" != / ]] ||
      cloudrun_die "could not resolve a directory parent for $value"
    missing_components=("${candidate##*/}" "${missing_components[@]}")
    candidate="${candidate%/*}"
    [[ -n "$candidate" ]] || candidate=/
  done
  physical_path="$(cd "$candidate" && pwd -P)"
  for component in "${missing_components[@]}"; do
    if [[ "$physical_path" == / ]]; then
      physical_path="/$component"
    else
      physical_path="$physical_path/$component"
    fi
  done
  printf '%s\n' "$physical_path"
}

cloudrun_require_durable_local_directory() {
  local name="$1"
  local value="$2"
  local absolute_path temporary_root
  absolute_path="$(cloudrun_canonical_local_path "$value")"

  case "$absolute_path" in
    /tmp | /tmp/* | /private/tmp | /private/tmp/*)
      cloudrun_die "$name resolves inside a temporary directory: $absolute_path. Set it to a protected durable location before bootstrap."
      ;;
  esac
  temporary_root="${TMPDIR:-}"
  temporary_root="${temporary_root%/}"
  if [[ -n "$temporary_root" &&
    ("$absolute_path" == "$temporary_root" || "$absolute_path" == "$temporary_root"/*) ]]; then
    cloudrun_die "$name resolves inside TMPDIR: $absolute_path. Set it to a protected durable location before bootstrap."
  fi
}

cloudrun_secret_specs() {
  jq -r '.secrets[] | [.environment, .suffix, .file, .versionKey] | @tsv' "$CLOUDRUN_CONTRACT"
}

cloudrun_secret_version() {
  local key="$1"
  local state_file="${2:-$CLOUDRUN_SECRET_VERSION_STATE}"
  local value
  [[ -f "$state_file" && ! -L "$state_file" ]] ||
    cloudrun_die "secret-version state is missing: $state_file"
  value="$(awk -F= -v key="$key" '$1 == key { value=$2 } END { print value }' "$state_file")"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_die "secret-version state is missing a numeric $key"
  printf '%s\n' "$value"
}

cloudrun_set_secret_version() {
  local key="$1"
  local value="$2"
  local state_file="${3:-$CLOUDRUN_SECRET_VERSION_STATE}"
  local temporary_file
  [[ "$key" =~ ^[A-Z0-9_]+$ && "$value" =~ ^[1-9][0-9]*$ ]] ||
    cloudrun_die "refusing to store invalid secret-version metadata"

  mkdir -p "$(dirname "$state_file")"
  chmod 700 "$(dirname "$state_file")"
  temporary_file="$(mktemp "${state_file}.tmp.XXXXXX")"
  if [[ -f "$state_file" ]]; then
    awk -F= -v key="$key" '$1 != key' "$state_file" >"$temporary_file"
  fi
  printf '%s=%s\n' "$key" "$value" >>"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$state_file"
}

cloudrun_secret_version_matches_bootstrap() (
  local version="$1"
  local secret_name="$2"
  local bootstrap_file="$3"
  local temporary_file
  temporary_file="$(mktemp "${CLOUDRUN_SECRET_VERSION_STATE}.compare.XXXXXX")"
  chmod 600 "$temporary_file"
  trap 'rm -f "$temporary_file"' EXIT

  if ! gcloud secrets versions access "$version" \
    --secret="$secret_name" \
    --project="$PROJECT_ID" \
    --out-file="$temporary_file" \
    --quiet >/dev/null 2>&1; then
    return 2
  fi
  cmp -s "$bootstrap_file" "$temporary_file"
)

cloudrun_ensure_secret_versions() {
  local _environment_name suffix file_name version_key secret_name bootstrap_file existing_version
  local comparison_status version_resource version
  while IFS=$'\t' read -r _environment_name suffix file_name version_key; do
    secret_name="${SECRET_PREFIX}_${suffix}"
    bootstrap_file="$BOOTSTRAP_DIRECTORY/$file_name"
    if ! gcloud secrets describe "$secret_name" \
      --project="$PROJECT_ID" >/dev/null 2>&1; then
      gcloud secrets create "$secret_name" \
        --project="$PROJECT_ID" \
        --replication-policy=automatic \
        --quiet
    fi
    gcloud secrets add-iam-policy-binding "$secret_name" \
      --project="$PROJECT_ID" \
      --member="serviceAccount:$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
      --role=roles/secretmanager.secretAccessor \
      --condition=None \
      --quiet >/dev/null

    existing_version=""
    if [[ -f "$CLOUDRUN_SECRET_VERSION_STATE" ]]; then
      existing_version="$(awk -F= -v key="$version_key" '$1 == key { value=$2 } END { print value }' "$CLOUDRUN_SECRET_VERSION_STATE")"
    fi
    if [[ "$existing_version" =~ ^[1-9][0-9]*$ ]] &&
      [[ "$(gcloud secrets versions describe "$existing_version" \
        --secret="$secret_name" \
        --project="$PROJECT_ID" \
        --format='value(state)' 2>/dev/null || true)" == "ENABLED" ]]; then
      if cloudrun_secret_version_matches_bootstrap \
        "$existing_version" "$secret_name" "$bootstrap_file"; then
        continue
      else
        comparison_status=$?
      fi
      [[ "$comparison_status" -eq 1 ]] ||
        cloudrun_die "could not compare the protected bootstrap value with $secret_name version $existing_version; grant the deployer access to that exact secret version"
    fi

    version_resource="$(gcloud secrets versions add "$secret_name" \
      --project="$PROJECT_ID" \
      --data-file="$bootstrap_file" \
      --format='value(name)')"
    version="${version_resource##*/}"
    [[ "$version" =~ ^[1-9][0-9]*$ ]] ||
      cloudrun_die "Secret Manager did not return a numeric version for $secret_name"
    cloudrun_set_secret_version "$version_key" "$version"
  done < <(cloudrun_secret_specs)
}

cloudrun_environment_csv() {
  printf '%s' \
    "NODE_ENV=production" \
    ",APP_ENV=$APP_ENV" \
    ",APP_DEBUG_ENABLED=false" \
    ",APP_DETECTOR_DIAGNOSTICS_ENABLED=false" \
    ",LTI_DEPLOYMENT_ID_CHECKING_ENABLED=$LTI_DEPLOYMENT_ID_CHECKING_ENABLED" \
    ",LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS=$LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS" \
    ",OAUTH_TOKEN_ENCRYPTION_MODE=$OAUTH_TOKEN_ENCRYPTION_MODE" \
    ",OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID=$OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID" \
    ",SEB_CONFIG_ENCRYPTION_ENABLED=$SEB_CONFIG_ENCRYPTION_ENABLED" \
    ",DATABASE_HOST=/cloudsql/$CLOUDRUN_CONNECTION_NAME" \
    ",DATABASE_PORT=5432" \
    ",DATABASE_NAME=$DATABASE_NAME" \
    ",DATABASE_USER=$DATABASE_USER" \
    ",DATABASE_SSL_MODE=disable" \
    ",DATABASE_POOL_MAX=$DATABASE_POOL_MAX" \
    ",LTI_ISSUER=$LTI_ISSUER" \
    ",LTI_KEY_SET_URL=$LTI_KEY_SET_URL" \
    ",LTI_AUTH_URL=$LTI_AUTH_URL"
}

cloudrun_secrets_csv() {
  local first=true
  local environment_name suffix _file version_key version
  while IFS=$'\t' read -r environment_name suffix _file version_key; do
    version="$(cloudrun_secret_version "$version_key")"
    if [[ "$first" == "true" ]]; then
      first=false
    else
      printf ','
    fi
    printf '%s=%s_%s:%s' "$environment_name" "$SECRET_PREFIX" "$suffix" "$version"
  done < <(cloudrun_secret_specs)
}

cloudrun_assert_bootstrap() {
  local environment_name _suffix file_name _version_key file_path
  local canvas_domain tool_url
  [[ -d "$BOOTSTRAP_DIRECTORY" && ! -L "$BOOTSTRAP_DIRECTORY" ]] ||
    cloudrun_die "bootstrap directory is missing: $BOOTSTRAP_DIRECTORY"
  while IFS=$'\t' read -r environment_name _suffix file_name _version_key; do
    file_path="$BOOTSTRAP_DIRECTORY/$file_name"
    [[ -f "$file_path" && ! -L "$file_path" && -s "$file_path" ]] ||
      cloudrun_die "required bootstrap value is empty or missing: $file_path ($environment_name)"
  done < <(cloudrun_secret_specs)

  jq -e '
    .kty == "RSA" and
    (.kid | type == "string" and length > 0) and
    (.d | type == "string" and length > 0)
  ' "$BOOTSTRAP_DIRECTORY/lti_private_key" >/dev/null ||
    cloudrun_die "LTI private key is not a valid private RSA JWK with a key ID"
  jq -e --arg key_id "$OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID" '
    type == "object" and
    (.[$key_id] | type == "string" and test("^[A-Za-z0-9_-]{43}$"))
  ' "$BOOTSTRAP_DIRECTORY/oauth_token_encryption_keyring" >/dev/null ||
    cloudrun_die "OAuth token encryption keyring does not contain the configured 32-byte base64url key"
  openssl x509 -in "$BOOTSTRAP_DIRECTORY/seb-config-encryption.crt.pem" -noout -checkend 86400 >/dev/null ||
    cloudrun_die "SEB configuration-encryption certificate is invalid or expires within one day"
  ! cmp -s "$BOOTSTRAP_DIRECTORY/session_secret" "$BOOTSTRAP_DIRECTORY/state_encryption_key" ||
    cloudrun_die "session and state-encryption secrets must be different"
  cloudrun_require_single_line_secret DATABASE_PASSWORD "$BOOTSTRAP_DIRECTORY/database_password"
  canvas_domain="$(<"$BOOTSTRAP_DIRECTORY/canvas_domain")"
  tool_url="$(<"$BOOTSTRAP_DIRECTORY/tool_url")"
  cloudrun_validate_url CANVAS_DOMAIN "$canvas_domain"
  cloudrun_validate_url TOOL_URL "$tool_url"
  [[ "$(<"$BOOTSTRAP_DIRECTORY/canvas_api_client_id")" =~ ^[^[:space:],]+$ ]] ||
    cloudrun_die "Canvas API client ID must not contain whitespace or commas"
  [[ "$(<"$BOOTSTRAP_DIRECTORY/lti_client_id")" =~ ^[^[:space:],]+$ ]] ||
    cloudrun_die "LTI client ID must not contain whitespace or commas"
  [[ "$(<"$BOOTSTRAP_DIRECTORY/lti_deployment_id")" =~ ^[^[:space:],]+$ ]] ||
    cloudrun_die "LTI deployment ID must not contain whitespace or commas"
}

cloudrun_release_tag() {
  local tag="release-${APP_VERSION//./-}"
  tag="${tag//_/-}"
  tag="$(printf '%s' "$tag" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
  printf '%.50s\n' "$tag"
}

cloudrun_tag_metadata() {
  local tag="$1"
  local service_json
  service_json="$(gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format=json)"
  jq -er --arg tag "$tag" '
    .status.traffic[]
    | select(.tag == $tag)
    | [.revisionName, .url]
    | @tsv
  ' <<<"$service_json" | tail -n 1
}

cloudrun_wait_for_sql_admin_api() {
  local deadline=$((SECONDS + CLOUD_SQL_API_READY_TIMEOUT_SECONDS))
  local attempts=0
  printf 'Waiting for Cloud SQL Admin API activation' >&2
  while ! gcloud sql instances list \
    --project="$PROJECT_ID" \
    --limit=1 \
    --format='value(name)' >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      printf '\n' >&2
      cloudrun_die "Cloud SQL Admin API did not become usable within ${CLOUD_SQL_API_READY_TIMEOUT_SECONDS}s; wait for Google Cloud API propagation and rerun prepare.sh"
    fi
    attempts=$((attempts + 1))
    if ((attempts % 6 == 0)); then
      printf '.' >&2
    fi
    sleep "$CLOUD_SQL_RETRY_INTERVAL_SECONDS"
  done
  printf ' ready.\n' >&2
}

cloudrun_wait_for_sql_instance() {
  local deadline=$((SECONDS + CLOUD_SQL_INSTANCE_READY_TIMEOUT_SECONDS))
  local description state attempts=0
  printf 'Waiting for Cloud SQL instance %s to become RUNNABLE' "$SQL_INSTANCE" >&2
  while true; do
    if description="$(gcloud sql instances describe "$SQL_INSTANCE" \
      --project="$PROJECT_ID" \
      --format=json 2>/dev/null)"; then
      state="$(jq -r '.state // empty' <<<"$description")"
      if [[ "$state" == "RUNNABLE" ]]; then
        printf ' ready.\n' >&2
        printf '%s\n' "$description"
        return
      fi
      if [[ "$state" == "FAILED" || "$state" == "SUSPENDED" ]]; then
        printf '\n' >&2
        cloudrun_die "Cloud SQL instance $SQL_INSTANCE entered terminal state $state; inspect the Cloud SQL operation before retrying"
      fi
    fi
    if ((SECONDS >= deadline)); then
      printf '\n' >&2
      cloudrun_die "Cloud SQL instance $SQL_INSTANCE did not become RUNNABLE within ${CLOUD_SQL_INSTANCE_READY_TIMEOUT_SECONDS}s; inspect the existing instance and rerun prepare.sh"
    fi
    attempts=$((attempts + 1))
    if ((attempts % 6 == 0)); then
      printf '.' >&2
    fi
    sleep "$CLOUD_SQL_RETRY_INTERVAL_SECONDS"
  done
}

cloudrun_verify_url() {
  local url="$1"
  if [[ "$PUBLIC_ACCESS" == "true" ]]; then
    curl --fail --silent --show-error --location \
      --retry 8 --retry-delay 2 --retry-all-errors \
      "$url/ready" >/dev/null || return 1
    curl --fail --silent --show-error --location \
      --retry 4 --retry-delay 2 --retry-all-errors \
      "$url/.well-known/jwks.json" >/dev/null || return 1
    return
  fi

  local authorization="Authorization: Bearer $(gcloud auth print-identity-token)"
  curl --fail --silent --show-error --location \
    --retry 8 --retry-delay 2 --retry-all-errors \
    -H "$authorization" "$url/ready" >/dev/null || return 1
  curl --fail --silent --show-error --location \
    --retry 4 --retry-delay 2 --retry-all-errors \
    -H "$authorization" "$url/.well-known/jwks.json" >/dev/null || return 1
}

cloudrun_disable_default_url_after_finalization() {
  local service_url service_json
  [[ "$DISABLE_DEFAULT_URL_AFTER_FINALIZE" == "true" ]] || return
  [[ -n "$TOOL_URL" ]] ||
    cloudrun_die "DISABLE_DEFAULT_URL_AFTER_FINALIZE=true requires a configured custom TOOL_URL"
  cloudrun_validate_url TOOL_URL "$TOOL_URL"

  # Candidate verification must happen first. Verify the custom origin before
  # and after removal so an incomplete domain mapping cannot strand Canvas.
  cloudrun_verify_url "${TOOL_URL%/}"
  service_json="$(gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format=json)"
  if jq -e '.metadata.annotations["run.googleapis.com/default-url-disabled"] == "true"' \
    <<<"$service_json" >/dev/null; then
    cloudrun_verify_url "${TOOL_URL%/}"
    return
  fi
  service_url="$(jq -r '.status.url // empty' <<<"$service_json")"
  cloudrun_validate_url CLOUD_RUN_SERVICE_URL "$service_url"
  [[ "${TOOL_URL%/}" != "${service_url%/}" ]] ||
    cloudrun_die "DISABLE_DEFAULT_URL_AFTER_FINALIZE=true requires TOOL_URL to differ from the generated Cloud Run URL"

  gcloud run services update "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --no-default-url \
    --quiet
  service_json="$(gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format=json)"
  jq -e '.metadata.annotations["run.googleapis.com/default-url-disabled"] == "true"' \
    <<<"$service_json" >/dev/null ||
    cloudrun_die "Cloud Run did not confirm that its generated default URL is disabled"
  cloudrun_verify_url "${TOOL_URL%/}"
}

cloudrun_cut_over_tag() {
  local tag="$1"
  local metadata revision url
  metadata="$(cloudrun_tag_metadata "$tag")" ||
    cloudrun_die "Cloud Run did not report a URL for deployment tag $tag"
  IFS=$'\t' read -r revision url <<<"$metadata"
  [[ -n "$revision" && -n "$url" ]] ||
    cloudrun_die "Cloud Run returned incomplete tag metadata for $tag"

  cloudrun_verify_url "$url"
  gcloud run services update-traffic "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --to-revisions="$revision=100" \
    --quiet >&2
  cloudrun_verify_url "$url"
  printf '%s\n' "$revision"
}
