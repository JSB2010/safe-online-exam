#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 5 ]]; then
  echo "usage: $0 IMAGE_REPOSITORY DIGEST VERSION COMMIT_SHA TAG..." >&2
  exit 64
fi

image_repository="$1"
digest="$2"
version="$3"
commit_sha="$4"
shift 4
tags=("$@")

[[ "$image_repository" == "ghcr.io/jsb2010/safe-online-exam" ]] ||
  { echo "unexpected image repository: $image_repository" >&2; exit 64; }
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] ||
  { echo "invalid image digest: $digest" >&2; exit 64; }
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] ||
  { echo "invalid release version: $version" >&2; exit 64; }
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
  { echo "invalid release commit: $commit_sha" >&2; exit 64; }

image_reference="$image_repository@$digest"
manifest="$(docker buildx imagetools inspect "$image_reference" --format '{{json .Manifest}}')"
resolved_digest="$(jq -r ".digest" <<<"$manifest")"
[[ "$resolved_digest" == "$digest" ]] ||
  { echo "manifest digest mismatch: expected $digest, found $resolved_digest" >&2; exit 1; }

for platform in "linux/amd64" "linux/arm64"; do
  operating_system="${platform%/*}"
  architecture="${platform#*/}"
  jq -e --arg os "$operating_system" --arg arch "$architecture" \
    '.manifests | any(.platform.os == $os and .platform.architecture == $arch)' \
    <<<"$manifest" >/dev/null ||
    { echo "release manifest is missing $platform" >&2; exit 1; }
done

images="$(docker buildx imagetools inspect "$image_reference" --format '{{json .Image}}')"
for platform in "linux/amd64" "linux/arm64"; do
  jq -e --arg platform "$platform" --arg revision "$commit_sha" --arg version "$version" \
    '.[$platform].config.Labels["org.opencontainers.image.revision"] == $revision
      and .[$platform].config.Labels["org.opencontainers.image.version"] == $version' \
    <<<"$images" >/dev/null ||
    { echo "$platform OCI labels do not match release source" >&2; exit 1; }
done

for tag in "${tags[@]}"; do
  tag_digest="$(
    docker buildx imagetools inspect "$image_repository:$tag" \
      --format '{{json .Manifest}}' | jq -r ".digest"
  )"
  [[ "$tag_digest" == "$digest" ]] ||
    { echo "tag $tag points to $tag_digest instead of $digest" >&2; exit 1; }
done

echo "verified $image_reference for ${tags[*]}"
