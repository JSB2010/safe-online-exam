#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_ID="seb-for-canvas"
readonly INSTANCE="school-canvas-seb"

[[ $# -eq 2 && "$1" == "$PROJECT_ID" ]] || {
  echo "usage: $0 seb-for-canvas true|false" >&2
  exit 64
}

case "$2" in
  false)
    echo "Skipping the optional pre-migration testbed backup." >&2
    ;;
  true)
    echo "Creating an on-demand backup of the development database before migrations..." >&2
    gcloud sql backups create --project="$PROJECT_ID" --instance="$INSTANCE" --quiet
    ;;
  *)
    echo "backup selection must be true or false" >&2
    exit 64
    ;;
esac
