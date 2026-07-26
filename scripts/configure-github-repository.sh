#!/usr/bin/env bash
set -euo pipefail

repository="${1:-JSB2010/safe-online-exam}"
ruleset_file=".github/rulesets/protect-main.json"
ruleset_name="$(jq -r ".name" "$ruleset_file")"

for command in gh jq; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command is unavailable: $command" >&2
    exit 69
  }
done

gh auth status >/dev/null

existing_ruleset_id="$(
  gh api "repos/$repository/rulesets" \
    --jq ".[] | select(.name == \"$ruleset_name\" and .target == \"branch\") | .id" |
    head -n 1
)"

if [[ -n "$existing_ruleset_id" ]]; then
  gh api --method PUT "repos/$repository/rulesets/$existing_ruleset_id" \
    --input "$ruleset_file" >/dev/null
  echo "updated ruleset: $ruleset_name ($existing_ruleset_id)"
else
  existing_ruleset_id="$(
    gh api --method POST "repos/$repository/rulesets" \
      --input "$ruleset_file" --jq ".id"
  )"
  echo "created ruleset: $ruleset_name ($existing_ruleset_id)"
fi

jq -n '{enabled: true, allowed_actions: "all", sha_pinning_required: true}' |
  gh api --method PUT "repos/$repository/actions/permissions" --input - >/dev/null
echo "required full-length action SHA pins"

gh api --method PUT \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "repos/$repository/immutable-releases" >/dev/null
echo "enabled immutable GitHub Releases"

gh api "repos/$repository/rulesets/$existing_ruleset_id" \
  --jq '{id, name, enforcement, conditions, rules}'
gh api "repos/$repository/actions/permissions"
gh api -H "X-GitHub-Api-Version: 2026-03-10" \
  "repos/$repository/immutable-releases"
