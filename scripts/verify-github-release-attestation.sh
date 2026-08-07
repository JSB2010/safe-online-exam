#!/usr/bin/env bash
set -euo pipefail

GH_CLI_VERSION="2.97.0"
GH_CLI_SHA256="a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112"

if [[ $# -ne 5 ]]; then
  echo "usage: $0 IMAGE REPOSITORY SIGNER_WORKFLOW SOURCE_DIGEST RELEASE_TAG" >&2
  exit 64
fi

image="$1"
repository="$2"
signer_workflow="$3"
source_digest="$4"
release_tag="$5"

[[ "$image" =~ ^ghcr\.io/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@sha256:[0-9a-f]{64}$ ]] || {
  echo "IMAGE must be an immutable GHCR sha256 reference" >&2
  exit 64
}
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "REPOSITORY must be owner/name" >&2
  exit 64
}
expected_workflow="$repository/.github/workflows/publish-release-image.yml"
[[ "$signer_workflow" == "$expected_workflow" ]] || {
  echo "SIGNER_WORKFLOW must be $expected_workflow" >&2
  exit 64
}
[[ "$source_digest" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SOURCE_DIGEST must be a full lowercase Git commit SHA" >&2
  exit 64
}
[[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]] || {
  echo "RELEASE_TAG must be a semantic v-prefixed release tag" >&2
  exit 64
}
[[ -n "${GH_TOKEN:-}" ]] || {
  echo "GH_TOKEN must contain a read-only token for GitHub attestation verification" >&2
  exit 64
}

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "$temporary_directory"' EXIT
archive="$temporary_directory/gh.tar.gz"

curl --fail --silent --show-error --location \
  --proto '=https' --proto-redir '=https' --tlsv1.2 \
  --retry 3 --retry-connrefused --max-time 120 \
  "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$GH_CLI_SHA256" "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$temporary_directory"

gh="$temporary_directory/gh_${GH_CLI_VERSION}_linux_amd64/bin/gh"
[[ -x "$gh" ]] || {
  echo "verified GitHub CLI archive did not contain the expected executable" >&2
  exit 1
}

release_state="$("$gh" api --method GET "repos/$repository/releases/tags/$release_tag" \
  --jq '[.tag_name, (.draft | tostring), (.prerelease | tostring), ((.immutable // false) | tostring), (.published_at // "")] | @tsv')"
IFS=$'\t' read -r actual_tag draft prerelease immutable published_at <<<"$release_state"
[[ "$actual_tag" == "$release_tag" && "$draft" == "false" && "$prerelease" == "false" && \
  "$immutable" == "true" && -n "$published_at" ]] || {
  echo "GitHub release $repository@$release_tag must be published, stable, and immutable before promotion" >&2
  exit 1
}

"$gh" attestation verify "oci://$image" \
  --repo "$repository" \
  --signer-workflow "$signer_workflow" \
  --source-digest "$source_digest" \
  --source-ref "refs/tags/$release_tag"
