#!/usr/bin/env bash

# Shared helpers for the guided Cloud Run and Docker Compose installers. Values
# written to dotenv files are intentionally restricted to a portable subset
# understood by Bash and Docker Compose.

setup_die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

setup_usage_error() {
  printf 'error: %s\n' "$*" >&2
  exit 64
}

setup_resolve_mode() {
  local requested="$1"
  if [[ "$requested" != "auto" ]]; then
    printf '%s\n' "$requested"
  elif [[ -t 0 && -t 1 ]]; then
    printf 'interactive\n'
  else
    printf 'non-interactive\n'
  fi
}

setup_prompt_value() {
  local label="$1"
  local default_value="${2:-}"
  local required="${3:-true}"
  local value
  while true; do
    if [[ -n "$default_value" ]]; then
      printf '%s [%s]: ' "$label" "$default_value" >&2
    else
      printf '%s: ' "$label" >&2
    fi
    IFS= read -r value || setup_die "interactive setup was cancelled"
    value="${value:-$default_value}"
    if [[ "$required" != "true" || -n "$value" ]]; then
      printf '%s\n' "$value"
      return
    fi
    printf 'A value is required.\n' >&2
  done
}

setup_prompt_secret() {
  local label="$1"
  local value
  while true; do
    printf '%s: ' "$label" >&2
    IFS= read -r -s value || setup_die "interactive setup was cancelled"
    printf '\n' >&2
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi
    printf 'A non-empty value is required.\n' >&2
  done
}

setup_prompt_yes_no() {
  local label="$1"
  local default_answer="${2:-no}"
  local hint answer normalized_answer
  if [[ "$default_answer" == "yes" ]]; then
    hint="Y/n"
  else
    hint="y/N"
  fi
  while true; do
    printf '%s [%s]: ' "$label" "$hint" >&2
    IFS= read -r answer || setup_die "interactive setup was cancelled"
    answer="${answer:-$default_answer}"
    normalized_answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
    case "$normalized_answer" in
      y | yes) return 0 ;;
      n | no) return 1 ;;
      *) printf 'Enter yes or no.\n' >&2 ;;
    esac
  done
}

setup_validate_dotenv_value() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[A-Za-z0-9._:/@+-]*$ ]] ||
    setup_usage_error "$name must use only portable URL, identifier, path, or hostname characters"
}

setup_set_env_value() {
  local environment_file="$1"
  local key="$2"
  local value="$3"
  local temporary_file
  [[ -f "$environment_file" && ! -L "$environment_file" ]] ||
    setup_usage_error "configuration file must be a regular file: $environment_file"
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] ||
    setup_die "refusing to write an invalid environment key"
  setup_validate_dotenv_value "$key" "$value"

  temporary_file="$(mktemp "${environment_file}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ ("^" key "=") {
      if (!replaced) {
        print key "=" value
        replaced = 1
      }
      next
    }
    { print }
    END {
      if (!replaced) {
        print key "=" value
      }
    }
  ' "$environment_file" >"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$environment_file"
}

setup_read_env_value() {
  local environment_file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' "$environment_file"
}

setup_copy_secret_file() {
  local source_file="$1"
  local destination_file="$2"
  [[ -f "$source_file" && ! -L "$source_file" && -s "$source_file" ]] ||
    setup_usage_error "secret input must be a non-empty regular file: $source_file"
  mkdir -p "$(dirname "$destination_file")"
  chmod 700 "$(dirname "$destination_file")"
  cp "$source_file" "$destination_file"
  chmod 600 "$destination_file"
}

setup_write_secret() {
  local destination_file="$1"
  local value="$2"
  [[ -n "$value" ]] || setup_usage_error "refusing to write an empty required secret"
  mkdir -p "$(dirname "$destination_file")"
  chmod 700 "$(dirname "$destination_file")"
  printf '%s' "$value" >"$destination_file"
  chmod 600 "$destination_file"
}

setup_require_configured_value() {
  local name="$1"
  local value="$2"
  [[ -n "$value" && "$value" != replace-* && "$value" != *REPLACE_WITH* &&
    "$value" != *example.edu && "$value" != *example.com &&
    "$value" != "https://school.instructure.com" ]] ||
    setup_usage_error "$name is missing or still contains an example placeholder"
}
