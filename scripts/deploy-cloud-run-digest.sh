#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 5 ]]; then
  echo "usage: deploy-cloud-run-digest.sh IMAGE_REPOSITORY DIGEST_FILE service|job RESOURCE GCLOUD_ARGS..." >&2
  exit 64
fi

repository="$1"
digest_file="$2"
resource_kind="$3"
resource="$4"
shift 4

if [[ ! "$repository" =~ ^[a-z0-9.-]+-docker\.pkg\.dev/[a-z0-9:._-]+/[a-z0-9._/-]+$ ]]; then
  echo "invalid Artifact Registry image repository" >&2
  exit 64
fi
if [[ "$resource_kind" != "service" && "$resource_kind" != "job" ]]; then
  echo "Cloud Run resource kind must be service or job" >&2
  exit 64
fi
if [[ ! "$resource" =~ ^[a-z][a-z0-9-]{0,62}$ ]]; then
  echo "invalid Cloud Run resource name" >&2
  exit 64
fi
if [[ ! "$digest_file" =~ ^/workspace/[A-Za-z0-9._-]+$ || ! -f "$digest_file" || -L "$digest_file" ]]; then
  echo "invalid image digest artifact" >&2
  exit 64
fi

digest=""
IFS= read -r digest < "$digest_file" || true
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "invalid image digest artifact" >&2
  exit 1
fi
if [[ "$(wc -l < "$digest_file")" -ne 1 ]]; then
  echo "invalid image digest artifact" >&2
  exit 1
fi

if [[ "$resource_kind" == "job" ]]; then
  exec gcloud run jobs deploy "$resource" "--image=${repository}@${digest}" "$@"
fi

exec gcloud run deploy "$resource" "--image=${repository}@${digest}" "$@"
