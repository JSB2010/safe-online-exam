#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 sha256:DIGEST /workspace/DIGEST_FILE" >&2
  exit 64
fi

digest="$1"
output="$2"
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "invalid image digest" >&2
  exit 64
fi
if [[ ! "$output" =~ ^/workspace/[A-Za-z0-9._-]+$ ]]; then
  echo "output must be a direct child of /workspace" >&2
  exit 64
fi

umask 077
temporary="${output}.tmp.$$"
trap 'rm -f "$temporary"' EXIT
printf '%s\n' "$digest" >"$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$output"
