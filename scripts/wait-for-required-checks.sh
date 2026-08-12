#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 COMMIT_SHA" >&2
  exit 64
fi

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

commit_sha="$1"
maximum_attempts="${RELEASE_CHECK_MAX_ATTEMPTS:-120}"
poll_interval_seconds="${RELEASE_CHECK_POLL_SECONDS:-15}"
required_checks=(
  "Application verification"
  "PostgreSQL integration"
  "Production Compose smoke"
  "Dependency integrity"
  "Analyze (javascript-typescript)"
  "Analyze (actions)"
)

for attempt in $(seq 1 "$maximum_attempts"); do
  response="$(gh api \
    -H "Accept: application/vnd.github+json" \
    "repos/$GITHUB_REPOSITORY/commits/$commit_sha/check-runs?per_page=100")"
  waiting=()

  for required_check in "${required_checks[@]}"; do
    latest="$(
      jq -c --arg name "$required_check" \
        '[.check_runs[] | select(.name == $name)] | sort_by(.started_at // .created_at) | last // empty' \
        <<<"$response"
    )"

    if [[ -z "$latest" ]]; then
      waiting+=("$required_check (not started)")
      continue
    fi

    status="$(jq -r ".status" <<<"$latest")"
    conclusion="$(jq -r ".conclusion // \"\"" <<<"$latest")"
    details_url="$(jq -r ".details_url // \"\"" <<<"$latest")"

    if [[ "$status" != "completed" ]]; then
      waiting+=("$required_check ($status)")
      continue
    fi
    if [[ "$conclusion" != "success" ]]; then
      echo "required check failed: $required_check ($conclusion) $details_url" >&2
      exit 1
    fi
  done

  if [[ ${#waiting[@]} -eq 0 ]]; then
    echo "all required checks passed for $commit_sha"
    exit 0
  fi

  if (( attempt == 1 || attempt % 4 == 0 )); then
    printf "waiting for required checks on %s: %s\n" \
      "$commit_sha" "$(IFS=", "; echo "${waiting[*]}")"
  fi
  sleep "$poll_interval_seconds"
done

echo "timed out waiting for required checks on $commit_sha" >&2
exit 1
