#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat >&2 <<EOF
usage: $0 [CLOUDRUN_ENV_FILE] [OPTIONS]

Options:
  --create-sql                    authorize creation of a missing billable instance
  --cloud-sql-profile PROFILE     override CLOUD_SQL_PROFILE for this run
  --interactive                   show the profile chooser and require confirmation
  --non-interactive               never prompt; suitable for automation
  --list-cloud-sql-profiles       print every supported profile and exit
  --help                          show this help
EOF
}

environment_file=cloudrun.env
environment_file_seen=false
create_sql=false
interaction_mode=auto
profile_override=""
list_profiles=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create-sql)
      create_sql=true
      ;;
    --cloud-sql-profile)
      shift
      [[ $# -gt 0 ]] || {
        usage
        exit 64
      }
      profile_override="$1"
      ;;
    --cloud-sql-profile=*)
      profile_override="${1#*=}"
      ;;
    --interactive)
      [[ "$interaction_mode" != "non-interactive" ]] || {
        printf 'error: --interactive conflicts with --non-interactive\n' >&2
        usage
        exit 64
      }
      interaction_mode=interactive
      ;;
    --non-interactive)
      [[ "$interaction_mode" != "interactive" ]] || {
        printf 'error: --non-interactive conflicts with --interactive\n' >&2
        usage
        exit 64
      }
      interaction_mode=non-interactive
      ;;
    --list-cloud-sql-profiles)
      list_profiles=true
      ;;
    --help)
      usage
      exit 0
      ;;
    -*)
      usage
      exit 64
      ;;
    *)
      [[ "$environment_file_seen" == "false" ]] || {
        usage
        exit 64
      }
      environment_file="$1"
      environment_file_seen=true
      ;;
  esac
  shift
done

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$script_directory/cloud-run-config.sh" ]]; then
  # shellcheck disable=SC1091
  source "$script_directory/cloud-run-config.sh"
else
  # shellcheck disable=SC1091
  source "$script_directory/../deploy/cloud-run-config.sh"
fi

if [[ "$list_profiles" == "true" ]]; then
  cloudrun_print_sql_profile_catalog
  exit 0
fi

cloudrun_load_environment "$environment_file"
if [[ -n "$profile_override" ]]; then
  CLOUD_SQL_PROFILE="$profile_override"
fi

if [[ "$create_sql" == "true" ]]; then
  if [[ "$interaction_mode" == "auto" ]]; then
    if [[ -t 0 && -t 1 ]]; then
      interaction_mode=interactive
    else
      interaction_mode=non-interactive
    fi
  fi
  if [[ "$interaction_mode" == "interactive" && -z "$profile_override" ]]; then
    CLOUD_SQL_PROFILE="$(cloudrun_prompt_sql_profile)"
  fi
fi

cloudrun_validate_base
cloudrun_require_commands gcloud jq

[[ -d "$BOOTSTRAP_DIRECTORY" && ! -L "$BOOTSTRAP_DIRECTORY" ]] ||
  cloudrun_die "run bootstrap-secrets.sh before preparing Google Cloud"
[[ -s "$BOOTSTRAP_DIRECTORY/database_password" ]] ||
  cloudrun_die "database password is missing from the bootstrap directory"
cloudrun_require_single_line_secret DATABASE_PASSWORD "$BOOTSTRAP_DIRECTORY/database_password"

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
[[ -n "$active_account" ]] || cloudrun_die "gcloud has no active authenticated account"

cloudrun_print_resource_plan
if [[ "$create_sql" == "true" && "$interaction_mode" == "interactive" ]]; then
  cat <<EOF

The selection applies to this run. Set this in $environment_file so later
preflight and recovery runs describe the same instance:
  CLOUD_SQL_PROFILE=$CLOUD_SQL_PROFILE
EOF
  printf '\nType %s to authorize billable Cloud SQL creation: ' "$SQL_INSTANCE" >&2
  IFS= read -r confirmation ||
    cloudrun_die "Cloud SQL creation confirmation was cancelled"
  [[ "$confirmation" == "$SQL_INSTANCE" ]] ||
    cloudrun_die "Cloud SQL creation was not confirmed"
fi

gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  iam.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet
cloudrun_wait_for_sql_admin_api

if ! gcloud iam service-accounts describe "$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$RUNTIME_SERVICE_ACCOUNT_NAME" \
    --project="$PROJECT_ID" \
    --display-name="Safe Online Exam runtime" \
    --quiet
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
  --role=roles/cloudsql.client \
  --condition=None \
  --quiet >/dev/null

if ! gcloud sql instances describe "$SQL_INSTANCE" \
  --project="$PROJECT_ID" \
  --format=json >/dev/null 2>&1; then
  if [[ "$CLOUD_SQL_PROFILE" == "existing-reviewed" ]]; then
    cloudrun_die "CLOUD_SQL_PROFILE=existing-reviewed requires an accessible existing instance: $SQL_INSTANCE"
  fi
  if [[ "$create_sql" != "true" ]]; then
    cloudrun_die "Cloud SQL instance $SQL_INSTANCE does not exist. Review the resource plan and rerun with --create-sql to create the billable $CLOUD_SQL_PROFILE profile."
  fi

  sql_compute_arguments=()
  if cloudrun_sql_is_shared_core; then
    sql_compute_arguments=(--tier="$(cloudrun_sql_tier)")
  else
    sql_compute_arguments=(--cpu="$(cloudrun_sql_cpu)" --memory="$(cloudrun_sql_memory)")
  fi
  sql_availability="$(cloudrun_sql_availability)"
  cat <<EOF

Creating billable Cloud SQL infrastructure:
  Profile: $CLOUD_SQL_PROFILE
  Resources: $(cloudrun_sql_profile_resources)
  Price reference: $(cloudrun_sql_price_summary)
  Enterprise PostgreSQL 17, 20-100 GB SSD auto-growth by default
  daily backups, 14 retained backups, seven-day PITR, deletion protection

Prices are approximate us-central1 estimates as of July 26, 2026. The script
does not purchase a one- or three-year Cloud SQL committed use discount.
Actual regional pricing and billing-account commitments apply.
EOF
  gcloud sql instances create "$SQL_INSTANCE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --database-version=POSTGRES_17 \
    --edition=ENTERPRISE \
    "${sql_compute_arguments[@]}" \
    --availability-type="$sql_availability" \
    --storage-type=SSD \
    --storage-size="$CLOUD_SQL_STORAGE_SIZE_GB" \
    --storage-auto-increase \
    --storage-auto-increase-limit="$CLOUD_SQL_STORAGE_AUTO_INCREASE_LIMIT_GB" \
    --backup \
    --backup-start-time="$CLOUD_SQL_BACKUP_START_TIME" \
    --enable-point-in-time-recovery \
    --retained-backups-count="$CLOUD_SQL_RETAINED_BACKUPS" \
    --retained-transaction-log-days="$CLOUD_SQL_PITR_DAYS" \
    --retain-backups-on-delete \
    --final-backup \
    --final-backup-retention-days="$CLOUD_SQL_FINAL_BACKUP_RETENTION_DAYS" \
    --deletion-protection \
    --assign-ip \
    --connector-enforcement=REQUIRED \
    --ssl-mode=ENCRYPTED_ONLY \
    --maintenance-window-day="$CLOUD_SQL_MAINTENANCE_DAY" \
    --maintenance-window-hour="$CLOUD_SQL_MAINTENANCE_HOUR" \
    --maintenance-release-channel=production \
    --tags="application=safe-online-exam,managed-by=safe-online-exam-bundle,environment=$APP_ENV" \
    --timeout=3600 \
    --quiet
fi

sql_description="$(cloudrun_wait_for_sql_instance)"

sql_region="$(jq -r '.region // empty' <<<"$sql_description")"
sql_database_version="$(jq -r '.databaseVersion // empty' <<<"$sql_description")"
[[ "$sql_region" == "$REGION" ]] ||
  cloudrun_die "Cloud SQL instance region $sql_region does not match configured region $REGION"
[[ "$sql_database_version" == POSTGRES_17* ]] ||
  cloudrun_die "Cloud SQL instance must run PostgreSQL 17; found $sql_database_version"

if [[ "$CLOUD_SQL_PROFILE" != "existing-reviewed" ]]; then
  sql_state="$(jq -r '.state // empty' <<<"$sql_description")"
  sql_edition="$(jq -r '.settings.edition // empty' <<<"$sql_description")"
  sql_availability="$(jq -r '.settings.availabilityType // empty' <<<"$sql_description")"
  sql_tier="$(jq -r '.settings.tier // empty' <<<"$sql_description")"
  sql_disk_type="$(jq -r '.settings.dataDiskType // empty' <<<"$sql_description")"
  sql_storage_auto_resize="$(jq -r '.settings.storageAutoResize // false' <<<"$sql_description")"
  sql_storage_auto_resize_limit="$(jq -r '.settings.storageAutoResizeLimit // "0"' <<<"$sql_description")"
  sql_backups="$(jq -r '.settings.backupConfiguration.enabled // false' <<<"$sql_description")"
  sql_pitr="$(jq -r '.settings.backupConfiguration.pointInTimeRecoveryEnabled // false' <<<"$sql_description")"
  sql_retained_backups="$(
    jq -r '.settings.backupConfiguration.backupRetentionSettings.retainedBackups // 0' <<<"$sql_description"
  )"
  sql_pitr_days="$(jq -r '.settings.backupConfiguration.transactionLogRetentionDays // 0' <<<"$sql_description")"
  sql_deletion_protection="$(jq -r '.settings.deletionProtectionEnabled // false' <<<"$sql_description")"
  sql_retain_backups_on_delete="$(jq -r '.settings.retainBackupsOnDelete // false' <<<"$sql_description")"
  sql_final_backup="$(jq -r '.settings.finalBackupConfig.enabled // false' <<<"$sql_description")"
  sql_final_backup_days="$(jq -r '.settings.finalBackupConfig.retentionDays // 0' <<<"$sql_description")"
  sql_connector_enforcement="$(jq -r '.settings.connectorEnforcement // empty' <<<"$sql_description")"
  sql_ssl_mode="$(jq -r '.settings.ipConfiguration.sslMode // empty' <<<"$sql_description")"

  expected_sql_availability="$(cloudrun_sql_availability)"
  expected_sql_tier="$(cloudrun_sql_tier)"

  [[ "$sql_state" == "RUNNABLE" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require a RUNNABLE instance; found $sql_state"
  [[ "$sql_edition" == "ENTERPRISE" || "$sql_edition" == "ENTERPRISE_PLUS" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require Enterprise or Enterprise Plus"
  [[ "$sql_availability" == "$expected_sql_availability" ]] ||
    cloudrun_die "Cloud SQL availability $sql_availability does not match $CLOUD_SQL_PROFILE ($expected_sql_availability)"
  [[ "$sql_tier" == "$expected_sql_tier" ]] ||
    cloudrun_die "Cloud SQL tier $sql_tier does not match $CLOUD_SQL_PROFILE ($expected_sql_tier)"
  [[ "$sql_disk_type" == "PD_SSD" || "$sql_disk_type" == "HYPERDISK_BALANCED" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require SSD or balanced Hyperdisk storage"
  [[ "$sql_storage_auto_resize" == "true" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require storage auto-growth"
  [[ "$sql_storage_auto_resize_limit" =~ ^[0-9]+$ &&
    ("$sql_storage_auto_resize_limit" -eq 0 ||
      "$sql_storage_auto_resize_limit" -ge "$CLOUD_SQL_STORAGE_AUTO_INCREASE_LIMIT_GB") ]] ||
    cloudrun_die "Cloud SQL storage auto-growth stops below the configured safety limit"
  [[ "$sql_backups" == "true" && "$sql_pitr" == "true" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require backups and point-in-time recovery"
  [[ "$sql_retained_backups" =~ ^[0-9]+$ &&
    "$sql_retained_backups" -ge "$CLOUD_SQL_RETAINED_BACKUPS" ]] ||
    cloudrun_die "Cloud SQL retains fewer than $CLOUD_SQL_RETAINED_BACKUPS automated backups"
  [[ "$sql_pitr_days" =~ ^[0-9]+$ && "$sql_pitr_days" -ge "$CLOUD_SQL_PITR_DAYS" ]] ||
    cloudrun_die "Cloud SQL PITR retention is below $CLOUD_SQL_PITR_DAYS days"
  [[ "$sql_deletion_protection" == "true" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require deletion protection"
  [[ "$sql_retain_backups_on_delete" == "true" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require retaining backups after deletion"
  [[ "$sql_final_backup" == "true" &&
    "$sql_final_backup_days" =~ ^[0-9]+$ &&
    "$sql_final_backup_days" -ge "$CLOUD_SQL_FINAL_BACKUP_RETENTION_DAYS" ]] ||
    cloudrun_die "Cloud SQL final-backup retention is below the configured baseline"
  [[ "$sql_connector_enforcement" == "REQUIRED" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require Cloud SQL connector enforcement"
  [[ "$sql_ssl_mode" == "ENCRYPTED_ONLY" ]] ||
    cloudrun_die "bundle-managed Cloud SQL profiles require encrypted-only connections"
fi

if ! gcloud sql databases describe "$DATABASE_NAME" \
  --instance="$SQL_INSTANCE" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud sql databases create "$DATABASE_NAME" \
    --instance="$SQL_INSTANCE" \
    --project="$PROJECT_ID" \
    --quiet
fi

database_user_exists="$(
  gcloud sql users list \
    --instance="$SQL_INSTANCE" \
    --project="$PROJECT_ID" \
    --filter="name=$DATABASE_USER" \
    --format='value(name)' |
    head -n 1
)"
if [[ -z "$database_user_exists" ]]; then
  gcloud sql users create "$DATABASE_USER" \
    --instance="$SQL_INSTANCE" \
    --project="$PROJECT_ID" \
    --password="$(<"$BOOTSTRAP_DIRECTORY/database_password")" \
    --quiet
elif [[ "$ALLOW_EXISTING_DATABASE_USER" != "true" ]]; then
  cloudrun_die "database user already exists; provide its matching password and set ALLOW_EXISTING_DATABASE_USER=true"
fi

if gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" >/dev/null 2>&1; then
  service_url="$(gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.url)')"
else
  gcloud run deploy "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --platform=managed \
    --image=us-docker.pkg.dev/cloudrun/container/hello \
    --service-account="$CLOUDRUN_RUNTIME_SERVICE_ACCOUNT" \
    --memory=256Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=1 \
    --timeout=60s \
    --quiet
  service_url="$(gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.url)')"
fi
cloudrun_validate_url CLOUD_RUN_SERVICE_URL "$service_url"

if [[ "$PUBLIC_ACCESS" == "true" ]]; then
  gcloud run services add-iam-policy-binding "$SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --member=allUsers \
    --role=roles/run.invoker \
    --condition=None \
    --quiet >/dev/null
fi

if [[ -n "$TOOL_URL" ]]; then
  cloudrun_validate_url TOOL_URL "$TOOL_URL"
  printf '%s' "${TOOL_URL%/}" >"$BOOTSTRAP_DIRECTORY/tool_url"
else
  printf '%s' "$service_url" >"$BOOTSTRAP_DIRECTORY/tool_url"
fi
if [[ -n "$CANVAS_DOMAIN" ]]; then
  printf '%s' "$CANVAS_DOMAIN" >"$BOOTSTRAP_DIRECTORY/canvas_domain"
fi
if [[ -n "$CANVAS_API_CLIENT_ID" ]]; then
  printf '%s' "$CANVAS_API_CLIENT_ID" >"$BOOTSTRAP_DIRECTORY/canvas_api_client_id"
fi
chmod 600 "$BOOTSTRAP_DIRECTORY"/*

cat <<EOF
Google Cloud prerequisites are ready.

Stable Cloud Run origin: $service_url
Configured tool origin: $(<"$BOOTSTRAP_DIRECTORY/tool_url")

Before install.sh:
  1. Create the Canvas API Developer Key for the configured tool origin.
  2. Fill canvas_domain, canvas_api_client_id, and canvas_api_client_secret in:
       $BOOTSTRAP_DIRECTORY
  3. Keep lti_client_id and lti_deployment_id as bootstrap-pending until Canvas
     creates the LTI registration; finalize-lti.sh replaces them afterward.
  4. Generate and upload the Canvas Theme Desktop JavaScript loader before
     testing protected assessments. In a release bundle run:
       ./canvas-theme-loader.sh ${1:-cloudrun.env}
EOF
