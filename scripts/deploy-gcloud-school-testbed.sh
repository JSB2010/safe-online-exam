#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROJECT_ID="seb-for-canvas"
readonly CONFIG="cloudbuild-testbed.yaml"
include_worktree=false
create_backup=false

usage() {
  echo "usage: npm run deploy:testbed -- [--include-working-tree] [--backup]" >&2
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-working-tree) include_worktree=true ;;
    --backup) create_backup=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 64
      ;;
  esac
  shift
done

command -v gcloud >/dev/null 2>&1 || fail "gcloud is required"
command -v git >/dev/null 2>&1 || fail "git is required"
command -v shasum >/dev/null 2>&1 || fail "shasum is required"
[[ -f "$CONFIG" ]] || fail "run this command from the repository root"

source_commit_sha="$(git rev-parse --verify HEAD)"
[[ "$source_commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "HEAD is not a full Git commit"
source_ref="$(git symbolic-ref --quiet --short HEAD || printf 'detached')"
[[ "$source_ref" =~ ^[A-Za-z0-9._/-]{1,200}$ ]] || fail "the current Git ref is not safe for provenance"

status="$(git status --porcelain=v1 --untracked-files=all)"
source_worktree_state="clean"
source_diff_sha="$(printf '' | shasum -a 256 | awk '{print $1}')"
if [[ -n "$status" ]]; then
  source_worktree_state="dirty"
  [[ "$include_worktree" == "true" ]] ||
    fail "the working tree is dirty; commit it or explicitly pass --include-working-tree"
  source_diff_sha="$({
    git diff --binary HEAD --
    while IFS= read -r path; do
      printf 'untracked:%s\n' "$path"
      shasum -a 256 -- "$path"
    done < <(git ls-files --others --exclude-standard)
  } | shasum -a 256 | awk '{print $1}')"
fi

ongoing_build="$(gcloud builds list --project="$PROJECT_ID" --ongoing \
  --filter='tags=school-canvas-seb-testbed' --format='value(id)' --limit=1)"
[[ -z "$ongoing_build" ]] || fail "testbed build $ongoing_build is already running"

echo "Submitting the locked development testbed build:" >&2
echo "  Project:  $PROJECT_ID" >&2
echo "  Service:  school-canvas-seb" >&2
echo "  Commit:   $source_commit_sha" >&2
echo "  Ref:      $source_ref" >&2
echo "  Worktree: $source_worktree_state" >&2
echo "  Diff:     $source_diff_sha" >&2
echo "  Backup:   $create_backup" >&2

gcloud builds submit . --project="$PROJECT_ID" --config="$CONFIG" \
  --substitutions="_SOURCE_COMMIT_SHA=$source_commit_sha,_SOURCE_REF=$source_ref,_SOURCE_WORKTREE_STATE=$source_worktree_state,_SOURCE_DIFF_SHA=$source_diff_sha,_CREATE_BACKUP=$create_backup"
