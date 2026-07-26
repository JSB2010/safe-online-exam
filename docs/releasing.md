# Releasing Safe Online Exam

The tag-driven GitHub Actions workflow is the release authority. A maintainer
prepares and merges the version on `main`, then pushes one annotated
`vX.Y.Z` tag. The workflow performs every remaining action: it waits for the
exact commit's required CI and CodeQL checks, creates a draft GitHub Release,
builds and smokes the image, publishes attestations and the Compose bundle,
promotes the final GHCR tags, and publishes the draft as an immutable release.

Do not manually create or publish a GitHub Release. Do not move or reuse a
published version tag.

## Choose The Version

Use semantic versioning for the application:

- `X.Y.Z+1`, such as `1.0.1`, for backward-compatible fixes.
- `X.Y+1.0`, such as `1.1.0`, for backward-compatible features.
- `X+1.0.0` for breaking API, deployment, configuration, or behavior changes.
- A suffix such as `1.1.0-rc.1` for a prerelease.

The PolyForm Noncommercial License `1.0.0`, LTI protocol versions, numbered
database migrations, and dependency versions are independent identifiers. Do
not change them as part of an application version bump.

## Prepare The Release On Main

Start from a clean branch based on current `main`. Update `package.json` and
the root package-lock versions without letting npm create a premature commit
or tag:

```bash
npm version 1.0.1 --no-git-tag-version
```

Then update:

1. `CHANGELOG.md` with a dated `[X.Y.Z]` section and canonical release link.
2. The quick-start `VERSION` in `README.md`.
3. The `APP_IMAGE` tag in `.env.compose.example`.

Check all synchronized release metadata:

```bash
npm run release:check
```

Run the normal verification appropriate to the change, commit the preparation,
and merge it into `main`. The `Protect main` repository ruleset requires the
application, PostgreSQL, Compose, and CodeQL checks. No approval is required
for a solo-maintainer pull request, but the pull request and checks provide a
durable release record.

## Publish With One Tag

After the release-preparation commit is on `main` and its checks have started
or completed:

```bash
git switch main
git pull --ff-only
git tag -a v1.0.1 -m "Safe Online Exam 1.0.1"
git push origin v1.0.1
```

No other release interaction is required. The tag push starts
`.github/workflows/publish-release-image.yml`. It is safe to push the tag while
the commit checks are still running; the release workflow waits for them.

For stable releases, the workflow publishes `X.Y.Z`, `X.Y`, `X`, and `latest`
to one manifest digest. Prereleases publish only the exact prerelease tag.
Production installations must continue to use the digest recorded in the
release, not a moving tag.

## Failure And Recovery

Before publication, the GitHub Release remains a mutable draft and the final
version tags are not promoted. Fix infrastructure or transient failures and
rerun the failed workflow. The workflow refreshes the same draft and can reuse
a correctly promoted image if a failure occurred during the final publication
window.

If a source or test defect is discovered, do not move the version tag to a
different commit. Correct the defect on `main` and prepare a new patch version.
After a release is published, GitHub release immutability locks its Git tag and
assets.

Cloud Run promotion is intentionally separate. Use the immutable release digest
with `cloudbuild-release-promote.yaml` only after the public release succeeds.
