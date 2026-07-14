#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: push-image-capture-digest.sh IMAGE_TAG /workspace/DIGEST_FILE" >&2
  exit 64
fi

image_tag="$1"
digest_file="$2"

if [[ ! "$image_tag" =~ ^[a-z0-9.-]+-docker\.pkg\.dev/[a-z0-9:._-]+/[a-z0-9._/-]+:[a-zA-Z0-9._-]+$ ]]; then
  echo "invalid Artifact Registry image tag" >&2
  exit 64
fi
if [[ ! "$digest_file" =~ ^/workspace/[A-Za-z0-9._-]+$ ]]; then
  echo "digest file must be a direct child of /workspace" >&2
  exit 64
fi

umask 077
push_log="${digest_file}.push.$$.log"
digest_tmp="${digest_file}.tmp.$$"
trap 'rm -f "$push_log" "$digest_tmp"' EXIT

# Capture the digest returned by this exact push. Never resolve the tag again:
# another registry writer could retarget even a build-unique tag after this step.
docker push "$image_tag" 2>&1 | tee "$push_log"

digest=""
while IFS= read -r line; do
  if [[ "$line" =~ [Dd]igest:[[:space:]]*(sha256:[0-9a-f]{64}) ]]; then
    candidate="${BASH_REMATCH[1]}"
    if [[ -n "$digest" && "$digest" != "$candidate" ]]; then
      echo "push returned conflicting image digests" >&2
      exit 1
    fi
    digest="$candidate"
  fi
done < "$push_log"

if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "could not capture the digest produced by docker push" >&2
  exit 1
fi

printf '%s\n' "$digest" > "$digest_tmp"
chmod 0600 "$digest_tmp"
mv -f "$digest_tmp" "$digest_file"
