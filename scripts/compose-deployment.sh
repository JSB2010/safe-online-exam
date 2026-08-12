#!/usr/bin/env bash

# Shared durable-installation helpers for the Compose release workflow. This
# file is sourced by setup, backup, and upgrade commands.

compose_deployment_die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

compose_deployment_resolve_file() {
  local value="$1"
  local directory base
  directory="$(dirname "$value")"
  base="$(basename "$value")"
  printf '%s/%s\n' "$(cd "$directory" && pwd -P)" "$base"
}

compose_deployment_resolve_path() {
  local base_directory="$1"
  local value="$2"
  if [[ "$value" == /* ]]; then
    printf '%s\n' "$value"
  else
    printf '%s/%s\n' "$base_directory" "$value"
  fi
}

compose_deployment_load() {
  local caller_directory="$1"
  local environment_file="$2"

  [[ -f "$environment_file" && ! -L "$environment_file" ]] ||
    compose_deployment_die "configuration file must be a regular file: $environment_file"

  COMPOSE_DEPLOYMENT_ENV_FILE="$(compose_deployment_resolve_file "$environment_file")"
  COMPOSE_DEPLOYMENT_DIRECTORY="$(dirname "$COMPOSE_DEPLOYMENT_ENV_FILE")"
  if [[ -f "$caller_directory/compose.yaml" ]]; then
    COMPOSE_DEPLOYMENT_TOPOLOGY_DIRECTORY="$caller_directory"
  elif [[ -f "$caller_directory/../compose.yaml" ]]; then
    COMPOSE_DEPLOYMENT_TOPOLOGY_DIRECTORY="$(cd "$caller_directory/.." && pwd -P)"
  else
    compose_deployment_die "could not locate compose.yaml from $caller_directory"
  fi

  set -a
  # shellcheck disable=SC1090
  source "$COMPOSE_DEPLOYMENT_ENV_FILE"
  set +a

  APP_ENV_FILE="$COMPOSE_DEPLOYMENT_ENV_FILE"
  SECRETS_DIRECTORY="$(compose_deployment_resolve_path \
    "$COMPOSE_DEPLOYMENT_DIRECTORY" "${SECRETS_DIRECTORY:-secrets}")"
  BACKUP_DIRECTORY="$(compose_deployment_resolve_path \
    "$COMPOSE_DEPLOYMENT_DIRECTORY" "${BACKUP_DIRECTORY:-backups}")"
  export APP_ENV_FILE SECRETS_DIRECTORY BACKUP_DIRECTORY
}

compose_deployment_validate_project_name() {
  local value="$1"
  [[ "$value" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] ||
    compose_deployment_die "COMPOSE_PROJECT_NAME must be a lowercase Compose project name"
}

compose_deployment_persist_project_name() {
  local value="$1"
  local temporary_file
  temporary_file="$(mktemp "${COMPOSE_DEPLOYMENT_ENV_FILE}.tmp.XXXXXX")"
  awk -F= '$1 != "COMPOSE_PROJECT_NAME" { print }' \
    "$COMPOSE_DEPLOYMENT_ENV_FILE" >"$temporary_file"
  printf 'COMPOSE_PROJECT_NAME=%s\n' "$value" >>"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$COMPOSE_DEPLOYMENT_ENV_FILE"
}

compose_deployment_resolve_project_name() {
  local resolution_mode="${1:-existing-only}"
  local container_id container_tool_url environment_entry project_name
  local matching_projects=""
  local default_project_exists="false"
  local matching_count
  COMPOSE_DEPLOYMENT_PROJECT_DISCOVERED="false"

  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
    compose_deployment_validate_project_name "$COMPOSE_PROJECT_NAME"
    export COMPOSE_PROJECT_NAME
    return
  fi

  [[ -n "${TOOL_URL:-}" ]] ||
    compose_deployment_die "TOOL_URL is required to discover a legacy Compose project"
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    container_tool_url=""
    while IFS= read -r environment_entry; do
      case "$environment_entry" in
        TOOL_URL=*) container_tool_url="${environment_entry#*=}" ;;
      esac
    done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id")
    project_name="$(docker inspect \
      --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container_id")"
    [[ "$project_name" == "safe-online-exam" ]] && default_project_exists="true"
    [[ "$container_tool_url" == "$TOOL_URL" ]] || continue
    compose_deployment_validate_project_name "$project_name"
    if ! printf '%s\n' "$matching_projects" | grep -Fx "$project_name" >/dev/null 2>&1; then
      matching_projects="${matching_projects}${matching_projects:+$'\n'}${project_name}"
    fi
  done < <(docker ps -a \
    --filter label=com.docker.compose.service=app \
    --format '{{.ID}}')

  matching_count="$(printf '%s\n' "$matching_projects" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$matching_count" == "0" && "$resolution_mode" == "allow-new" ]]; then
    [[ "$default_project_exists" == "false" ]] ||
      compose_deployment_die \
        "the default Compose project safe-online-exam already exists for another TOOL_URL; set a unique COMPOSE_PROJECT_NAME before installing"
    COMPOSE_PROJECT_NAME="safe-online-exam"
    compose_deployment_persist_project_name "$COMPOSE_PROJECT_NAME"
    export COMPOSE_PROJECT_NAME
    printf 'Recorded new Compose project %s in %s for stable future upgrades.\n' \
      "$COMPOSE_PROJECT_NAME" "$COMPOSE_DEPLOYMENT_ENV_FILE" >&2
    return
  fi
  [[ "$matching_count" == "1" ]] ||
    compose_deployment_die \
      "COMPOSE_PROJECT_NAME is missing and exactly one legacy app project matching TOOL_URL could not be found; set it to the existing Compose project name before continuing"

  COMPOSE_PROJECT_NAME="$matching_projects"
  COMPOSE_DEPLOYMENT_PROJECT_DISCOVERED="true"
  export COMPOSE_PROJECT_NAME
  if [[ "$resolution_mode" == "defer-persist" ]]; then
    return
  fi
  compose_deployment_persist_discovered_project_name
}

compose_deployment_persist_discovered_project_name() {
  [[ "${COMPOSE_DEPLOYMENT_PROJECT_DISCOVERED:-false}" == "true" ]] || return 0
  compose_deployment_persist_project_name "$COMPOSE_PROJECT_NAME"
  COMPOSE_DEPLOYMENT_PROJECT_DISCOVERED="false"
  printf 'Recorded existing Compose project %s in %s for stable future upgrades.\n' \
    "$COMPOSE_PROJECT_NAME" "$COMPOSE_DEPLOYMENT_ENV_FILE" >&2
}

compose_deployment_command() {
  COMPOSE_DEPLOYMENT_COMMAND=(
    docker compose
    --project-name "$COMPOSE_PROJECT_NAME"
    --env-file "$COMPOSE_DEPLOYMENT_ENV_FILE"
    -f "$COMPOSE_DEPLOYMENT_TOPOLOGY_DIRECTORY/compose.yaml"
    -f "$COMPOSE_DEPLOYMENT_TOPOLOGY_DIRECTORY/compose.secrets.yaml"
  )
}
