# Deployment And Operations

Safe Online Exam is distributed as a single nonroot Node.js container. A
supported production installation also needs:

- PostgreSQL 17 or newer;
- a stable public HTTPS origin;
- protected environment values or mounted secret files;
- a migration job that completes before a new application image receives
  traffic;
- a scheduled cleanup job;
- database backups and tested recovery;
- monitoring and an incident-response path; and
- managed Safe Exam Browser clients when certificate encryption is enabled.

The maintained public installation paths are Google Cloud Run with Cloud SQL
and Docker Compose on a Linux host. Other container platforms are possible
when they preserve the same runtime contract, but their infrastructure is not
maintained in this repository.

## Choose A Deployment Mode

| Mode                                             | Best fit                                                                 | You operate                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Google Cloud Run With Cloud SQL                  | Institution that wants managed compute, ingress, PostgreSQL, and secrets | Google Cloud project, IAM, cost, Canvas setup, client certificates, monitoring, and recovery    |
| Docker Compose / Budget VM Alternative           | Institution with an established Linux/container operations practice      | Host, firewall, TLS, Docker, PostgreSQL volume, backups, scheduling, monitoring, and upgrades   |
| Existing container platform                      | Institution with Kubernetes or another reviewed platform                 | All provider-specific manifests plus the application runtime contract                           |
| Maintained source-based Cloud Build environments | Contributors/operators of the existing `canvas-seb-*` services           | Repository checkout, Google Cloud resources, source build, fixed service names, and secret pins |

For a new public installation, prefer a published release bundle over a source
checkout. The bundle contains the exact image digest, version-matched scripts,
and its own self-contained README.

## Release Trust And Image Selection

Stable images are published at:

```text
ghcr.io/jsb2010/safe-online-exam
```

The release workflow produces `linux/amd64` and `linux/arm64` images, an SBOM,
provenance, a GitHub artifact attestation, a manifest digest, and checksum
files for both deployment bundles. Stable tags include `X.Y.Z`, `X.Y`, `X`,
and `latest`; prereleases publish only their exact prerelease tag.

Production must use the immutable digest from the GitHub Release:

```text
ghcr.io/jsb2010/safe-online-exam@sha256:...
```

Do not treat a mutable tag as a production pin. Before installation:

1. Review the changelog and release notes.
2. Download the archive and adjacent `.sha256`.
3. Verify the checksum before extraction.
4. Verify the image attestation using the exact repository, signer workflow,
   source commit, and source tag printed in the release notes.
5. Preserve the release notes and digest in the change record.

Publishing a GitHub Release never deploys an institution’s service
automatically.

## Mode 1: Google Cloud Run With Cloud SQL

The recommended managed path is the versioned Cloud Run bundle attached to a
GitHub Release. Its scripts use plain `gcloud`, Docker, `gh`, `jq`, OpenSSL,
`cmp`, and `curl`; they do not require an application-source checkout or Cloud
Build.

Download the exact release:

```bash
export VERSION="X.Y.Z"
curl -fLO "https://github.com/JSB2010/safe-online-exam/releases/download/v${VERSION}/safe-online-exam-${VERSION}-cloud-run.tar.gz"
curl -fLO "https://github.com/JSB2010/safe-online-exam/releases/download/v${VERSION}/safe-online-exam-${VERSION}-cloud-run.tar.gz.sha256"
sha256sum --check "safe-online-exam-${VERSION}-cloud-run.tar.gz.sha256"
tar -xzf "safe-online-exam-${VERSION}-cloud-run.tar.gz"
cd "safe-online-exam-${VERSION}-cloud-run"
```

Read the extracted `README.md` before running `./setup.sh`. The source template
for that release manual is
[`deploy/cloud-run-README.md`](../deploy/cloud-run-README.md).

### What The Bundle Creates

With the default `RESOURCE_NAME=safe-online-exam`, a new install uses:

| Resource                     | Default name               |
| ---------------------------- | -------------------------- |
| Cloud Run service            | `safe-online-exam`         |
| Cloud Run migration job      | `safe-online-exam-migrate` |
| Cloud Run cleanup job        | `safe-online-exam-cleanup` |
| Cloud SQL instance           | `safe-online-exam`         |
| PostgreSQL database and user | `safe_online_exam`         |
| Runtime service account      | `safe-online-exam`         |
| Scheduler service account    | `safe-online-exam-sched`   |
| Secret Manager prefix        | `safe_online_exam_`        |

Use a short suffix for multiple installations in one project. Do not rename a
service after Canvas has registered its `run.app` URL; that is a Canvas-facing
integration change.

The installer:

1. performs a read-only local/project preflight;
2. creates protected bootstrap state and signing/certificate material;
3. creates or validates Cloud SQL;
4. reserves the stable Cloud Run URL;
5. pauses for the Canvas API Developer Key;
6. deploys migrations, cleanup, and a candidate service;
7. pauses for the Canvas LTI registration and deployment ID; and
8. creates new numbered secret versions and cuts traffic to the finalized
   revision.

Do not run a release bundle from `/tmp`, `/private/tmp`, or `TMPDIR`. The
bootstrap command rejects local protected-state paths there so automatic cleanup
cannot remove the only SEB client identity or deployment records.

The matching SEB `.p12`, private key, and password stay in the protected client
identity directory until they are moved to the institution’s MDM/vault. They
must never be uploaded to Secret Manager or Cloud Run.

When `TOOL_URL` is a Cloud Run domain mapping, run the bundle's explicit
`./map-domain.sh cloudrun.env` command after prepare. It creates or reads the
mapping and prints required DNS/Ready conditions, but it does not change DNS.
Only set `DISABLE_DEFAULT_URL_AFTER_FINALIZE=true` after the custom origin has
passed health, readiness, JWKS, and LTI checks; finalization verifies its
candidate first, then disables the generated URL. Later upgrades preserve that
policy by temporarily restoring the generated URL only for tagged candidate
verification, then disabling it again after the custom origin passes.

### Cloud SQL Selection

The bundle’s default `production-zonal` profile is a cost-conscious dedicated,
single-zone PostgreSQL 17 baseline with backups, point-in-time recovery,
deletion protection, encrypted connector-only access, storage auto-growth,
and a maintenance window. It does not provide automatic cross-zone failover or
the HA SLA.

List the versioned profile catalog before accepting a billable resource:

```bash
./prepare.sh --list-cloud-sql-profiles
```

Use `existing-reviewed` when the institution supplies an existing PostgreSQL
17 Cloud SQL instance in the same region. In that mode, the institution owns
the HA, backup, retention, networking, sizing, and deletion-protection review.

Price text in a downloaded bundle is a dated planning reference, not a quote.
Check the live Google Cloud pricing and terms before creation or a committed
use purchase.

### IAM And Public Access

Use separate runtime, scheduler, and deployer identities. The runtime should
have Cloud SQL Client access limited to the configured project and secret
access limited to the exact secret resources it consumes. Do not grant
project-wide Secret Manager access to the runtime. The deployer must be able to
access each exact pinned secret version so upgrades can compare it with the
protected bootstrap value before deciding whether to create a new version.

Canvas must reach the service without an interactive Google login. The bundle
can grant public invocation only on the application service. If organization
policy prohibits that binding, put an approved public HTTPS load balancer in
front and set `TOOL_URL` to its stable origin. Migration and cleanup jobs must
remain non-public.

### Guided And Unattended Setup

Interactive install:

```bash
./setup.sh
```

The flow is resumable around the two Canvas handoffs:

```bash
./setup.sh --stage configure
./setup.sh --stage prepare
./setup.sh --stage install
./setup.sh --stage finalize
```

For automation, use the exact non-interactive/file-input examples in the
bundle README. Secret values are accepted through no-echo prompts or protected
files, never command-line arguments. Keep `cloudrun.env`, bootstrap state,
client identity, and `.state` outside source control and restrict their
permissions.

### Cloud Run Release Smoke Checks

After install or upgrade, verify:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/ready"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsS "${TOOL_URL}/lti/config"
curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
curl -fsS "${TOOL_URL}/js/canvas-seb-theme-loader.js" | head
```

Then inspect:

- the active revision and exact image digest;
- migration and cleanup job executions;
- Cloud Scheduler’s last execution;
- Cloud SQL backup/PITR status, storage, and connections;
- numbered secret-version references;
- application 4xx/5xx and readiness logs; and
- the real [Canvas and SEB acceptance](testing.md#canvas-and-seb-acceptance).

Public route checks do not replace a real administrator, instructor, student,
Classic Quiz, New Quiz, and managed-client test.

### Cloud Run Upgrade And Rollback

Download and verify the next Cloud Run bundle. Preserve the protected
environment, bootstrap, state, and client-identity records; merge new template
keys instead of overwriting local configuration. The bundle’s `upgrade.sh`:

1. validates the complete current environment and bootstrap contract, creates
   any newly required numbered Secret Manager versions, and grants the existing
   runtime identity access;
2. creates an on-demand Cloud SQL backup, waits for its operation to finish,
   and requires the resulting backup status to be `SUCCESSFUL`;
3. runs the new migration job;
4. updates cleanup and applies the current environment and secret bindings to
   both jobs;
5. deploys a no-traffic candidate revision with those same current bindings;
6. temporarily enables a previously disabled generated URL so the tagged
   candidate can be verified;
7. verifies candidate readiness and JWKS;
8. cuts traffic over explicitly; and
9. verifies the custom origin and restores the prior generated-URL policy.

If a candidate check fails, the previous revision retains traffic. Completed
forward migrations still exist. Application rollback requires the explicit
schema-compatibility confirmation in the bundle and never reverses migrations.
Rollback verifies `TOOL_URL` when configured. Upgrade verifies that origin
before temporarily enabling—and after re-disabling—the generated URL.

For an existing installation that may contain plaintext OAuth tokens, first
merge the new template keys and run the upgrade with
`OAUTH_TOKEN_ENCRYPTION_MODE=compat`. When the protected bootstrap does not yet
contain `oauth_token_encryption_keyring`, `upgrade.sh` generates only that new
keyring file with the configured active key ID. It never replaces an existing
keyring or changes any other bootstrap value. The upgrade then creates and
binds its numbered Secret Manager version. That revision can read
both formats while continuing rollback-compatible writes. Then set the mode to
`enforce`, deploy the same image again, verify the service, and run:

```bash
./encrypt-oauth-tokens.sh cloudrun.env
```

The one-shot Cloud Run job rewrites legacy rows and rows encrypted under a
retired key. Run it a second time and require `0` updates before removing an
old key. A pre-encryption application revision is not a valid rollback target
after encrypted writes begin.

On every portable upgrade, the helper reads each exact enabled pinned version
into a mode-`0600` temporary file under the protected state directory,
byte-compares it with the corresponding bootstrap file, and removes the
temporary file immediately. An unchanged value reuses its version; a changed
value receives a new numbered version. If the deployer cannot access the
pinned value for comparison, the upgrade stops before backup or deployment.
The first 1.0.5-to-1.1 upgrade is the one exception to "already present": it
creates the newly required OAuth keyring locally and uploads version 1 (or the
next available version) without rotating established application secrets.

`upgrade.sh` requires `OAUTH_TOKEN_ENCRYPTION_MODE` to be assigned explicitly
in `cloudrun.env`; it never treats the default as approval to begin encrypted
writes during an upgrade. When `enforce` is requested for an existing Cloud Run
service, the upgrade also verifies that the sole traffic-serving revision
already reports `compat` or `enforce`; a 1.0.5 revision therefore cannot skip
the compatibility deployment.

For data recovery, restore a backup into a controlled target first. Do not
overwrite the active database as the first diagnostic action.

## Maintained Source-Based Cloud Build Deployments

The repository also maintains source-based deployments for the existing
services:

| Environment | Service           | Cloud SQL instance | Region        | Runtime service account |
| ----------- | ----------------- | ------------------ | ------------- | ----------------------- |
| Development | `canvas-seb-dev`  | `canvas-seb-dev`   | `us-central1` | `seb-canvas-dev`        |
| Production  | `canvas-seb-prod` | `canvas-seb-prod`  | `us-central1` | `seb-canvas-prod`       |

These are maintained environment contracts, not recommended names for a new
school installation. The development and parameterized school source-build
configs:

- build the image and reuse the previous cache image where valid;
- run the Dockerfile’s typecheck, lint, format, coverage, build, production
  prune, and runtime assembly;
- run real PostgreSQL migration/concurrency tests separately;
- push and capture an immutable Artifact Registry digest;
- deploy and wait for the migration job;
- update cleanup; and
- deploy the service with exact Secret Manager version pins.

After the project, Artifact Registry, Cloud SQL, runtime identity, secrets,
service URL, and Canvas registrations already exist, source-build only
development or a deliberately named school environment:

Development:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml \
  --substitutions=_OAUTH_TOKEN_ENCRYPTION_MODE=compat
```

A named school environment:

```bash
gcloud builds submit --config=cloudbuild-school.yaml \
  --substitutions=_OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION=KEYRING_VERSION,_OAUTH_TOKEN_ENCRYPTION_MODE=compat
```

### Commit testbed for the self-hosted Canvas sandbox

The repository has one deliberately narrower source-build workflow for the
existing `seb-for-canvas` sandbox. It is locked in code to the
`school-canvas-seb` service, jobs, Cloud SQL instance, service account, secret
versions, and `https://seb.jacobbarkin.com` public origin. It cannot be
retargeted through substitutions and never addresses a production resource.

Deploy a clean commit from the repository root:

```bash
npm run deploy:testbed
```

For an intentionally uncommitted experiment, make the exception visible and
record a SHA-256 fingerprint of the tracked diff and included untracked files:

```bash
npm run deploy:testbed -- --include-working-tree
```

Add `--backup` when a commit carries a data migration for which a disposable
testbed backup is still useful. Backups are intentionally opt-in because this
instance is a low-cost, resettable development environment.

The workflow refuses a second concurrent tagged testbed build, runs the full
Docker and real-PostgreSQL gates, pushes an immutable digest, optionally takes
the backup, applies migrations, updates cleanup, and deploys a tagged
no-traffic revision. It verifies health, readiness, JWKS, LTI metadata, the
detector, and build provenance at the candidate URL before traffic changes.
It then repeats those checks at the custom origin. A failed post-cutover check
automatically restores the prior revision; forward database migrations remain.

The root status page and `GET /api/testbed/status` show the commit, worktree
state or diff fingerprint, Cloud Build ID, image digest, Cloud Run revision,
and diagnostic state. The debug trace endpoint accepts only the exact Canvas
origin, caps detail and event sizes, redacts sensitive fields, and rate-limits
each instance. Those diagnostics cannot start under `APP_ENV=prod`.

To route traffic to a known schema-compatible earlier revision:

```bash
npm run rollback:testbed -- school-canvas-seb-REVISION --confirm-schema-compatible
```

To erase only the application database and reapply the currently deployed
migrations, use the interactive exact-target reset:

```bash
npm run db:reset:gcloud:testbed
```

The reset does not delete Canvas courses, users, keys, or the LTI installation,
but it removes application OAuth grants and settings, so users must reconnect
Canvas. See [Commit testbed acceptance](testing.md#commit-testbed-acceptance)
for the stable Canvas fixture and per-commit checks.

`cloudbuild-school.yaml` is the parameterized source-build variant for a new
named environment. Inspect every substitution and referenced secret before
submission. A self-hosted Canvas must override its actual LTI authorization
and JWKS endpoints; `LTI_ISSUER` must match the signed claim and should not be
inferred from the hostname.

Those examples are the safe first pass for an existing deployment. After the
compatibility revision is healthy, rerun the selected build with
`_OAUTH_TOKEN_ENCRYPTION_MODE=enforce` and complete the token rewrite. A fresh
deployment with no existing service may select `enforce` immediately. The
shared rollout preflight rejects enforcement on an unstaged existing service.

The school build never creates or rotates secrets. Before its first submission,
use the protected Cloud Run bootstrap/install flow to create version `1` of
every `${_SECRET_PREFIX}_*` secret it references. In the default school profile,
that includes `safe_online_exam_oauth_token_encryption_keyring`, whose value must
contain a unique 32-byte base64url `primary` key. Existing plaintext OAuth rows
require the separately documented `compat` deployment and
`encrypt-oauth-tokens.sh` rewrite; the migration job intentionally does not
rewrite token data. Set `_OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION`
independently from the shared `_SECRET_VERSION`; the keyring may begin at
version `1` even when established secrets use later versions.

Production does not install or execute dependency code under its deploy
identity. The authoritative `cloudbuild-prod.yaml` promotion configuration
accepts only an already published public GHCR digest. The build independently
downloads a fixed GitHub CLI release, verifies its hard-coded checksum,
requires the matching GitHub Release to be published, stable, and immutable,
verifies the GitHub artifact attestation against the exact repository,
workflow, tag, and source commit, creates a KMS-backed Google Binary
Authorization attestation for that digest, and requests the project's default
Binary Authorization policy on the migration job, cleanup job, and service.
The policy becomes blocking only after the separately documented enforcement
step.

This Binary Authorization section applies to the repository-maintained
`canvas-seb-prod` Cloud Build target. It is not an application runtime
dependency, is not required to publish the 1.1 release, and is not required by
the portable `upgrade.sh` or Docker Compose upgrade paths. An institution may
adopt an equivalent admission policy for its own service, but the 1.0.5-to-1.1
OAuth migration does not depend on doing so.

Prepare these controls once before using the production promotion config:

```bash
bash scripts/configure-binary-authorization.sh prepare PROJECT_ID --apply
```

The command creates the `safe-online-exam-release` attestor, its Artifact
Analysis note, a `global/safe-online-exam/release-attestor` asymmetric signing
key, the empty `github_attestation_read_token` Secret Manager container, and
the minimum Cloud Build grants required to verify and create attestations. It
does not accept or print a token. Add a fine-grained, read-only GitHub token
with metadata and attestation read access as a numbered secret version, then
record that version in the promotion substitution. Do not give this token
repository contents write, packages write, workflow, or administration access.

The initial Google policy remains non-blocking. Run one promotion with the
prepared attestor, confirm the GitHub and Google attestations and all three
Cloud Run targets, then activate enforcement:

```bash
bash scripts/configure-binary-authorization.sh status PROJECT_ID
bash scripts/configure-binary-authorization.sh enforce PROJECT_ID --apply
```

Enforcement imports `deploy/binary-authorization-policy.yaml` and updates only
`canvas-seb-prod`, `canvas-seb-prod-migrate`, and
`canvas-seb-prod-cleanup`. Do not run `enforce` before the successful attested
test promotion: an unattested current image can be rejected. The imported
`defaultAdmissionRule` is project-wide: Cloud Run is unaffected until a service
or job opts in with `--binary-authorization=default`, while GKE clusters in the
same project are evaluated immediately. Confirm the target project contains no
GKE workloads before the first `enforce` run. Google documents
the Cloud Run behavior in
[Enable Binary Authorization for Cloud Run](https://docs.cloud.google.com/binary-authorization/docs/run/enabling-binauthz-cloud-run).

After verifying the release checksum and immutable release state, an existing
`canvas-seb-prod` installation must first submit the release in `compat` mode:

```bash
gcloud builds submit --config=cloudbuild-prod.yaml \
  --substitutions=_IMAGE_DIGEST=sha256:RELEASE_DIGEST,_RELEASE_TAG=vX.Y.Z,_SOURCE_DIGEST=40_CHARACTER_GIT_SHA,_GITHUB_ATTESTATION_TOKEN_SECRET_VERSION=SECRET_VERSION,_OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION=KEYRING_VERSION,_OAUTH_TOKEN_ENCRYPTION_MODE=compat
```

The OAuth keyring version is deliberately independent from `_SECRET_VERSION`.
Record the exact keyring version created for this environment; do not advance
or roll back unrelated secrets merely to select it.

After that revision is healthy, submit the same immutable release again with
`_OAUTH_TOKEN_ENCRYPTION_MODE=enforce`, verify it, and run the OAuth-token
rewrite documented above. The rollout preflight rejects `enforce` for an
existing service whose current revision has not already reported `compat` or
`enforce`. A fresh installation with no existing service may start directly in
`enforce`, as may the new-school build profile.

The promotion deploys the digest to migrations first, waits, then updates
cleanup and the service. Promotion remains an explicit operator action and
should run against development before production. Cloud Build builder images
are digest-pinned; update those pins only through a reviewed dependency change.
Binary Authorization is a second verification boundary, not a replacement for
GitHub release review, vulnerability scanning, migration testing, or post-deploy
health checks. Emergency breakglass must include an incident justification and
must be followed by a normal attested deployment because Cloud Run clears the
justification on the next update.

Do not change the maintained `canvas-seb-*` service names casually. A new
Cloud Run service has a new URL and therefore requires Canvas LTI and OAuth
configuration changes.

## Mode 2: Docker Compose / Budget VM Alternative

The Compose release bundle contains:

- the exact application image digest;
- PostgreSQL 17 with a named `postgres_data` volume;
- a one-shot migration service that gates application startup;
- an opt-in cleanup service;
- mounted file secrets;
- protected LTI and SEB identity bootstrap;
- a backup/upgrade helper; and
- an optional Caddy profile.

Download and checksum the release as shown in the
[README quick start](../README.md#docker-compose), then read the extracted
`README.md`. Its source template is
[`deploy/compose-README.md`](../deploy/compose-README.md).

### Host Requirements

Use a supported Linux distribution with current security updates, Docker
Engine, the Docker Compose v2 plugin, stable DNS, encrypted storage, time
synchronization, and monitored disk capacity. Restrict SSH to administrative
networks. Do not publish PostgreSQL port 5432.

The guided installer creates a protected `.env.secrets`, secrets directory,
and client-only identity:

```bash
./setup.sh
```

For a manual source-topology install, protect the environment file:

```bash
cp .env.compose.secrets.example .env
chmod 600 .env
```

Prefer the bundle’s generated file-secret topology over placing production
secret values directly in the environment file.

### TLS Reverse Proxy

The application binds to `127.0.0.1:8080` by default. Put Caddy, nginx,
Traefik, or a managed ingress in front and set:

```text
TOOL_URL=https://safe-online-exam.example.edu
CANVAS_REDIRECT_URI=https://safe-online-exam.example.edu/api/oauth2callback
```

The optional bundled Caddy profile terminates public HTTPS after `PUBLIC_HOST`
is set and ports 80/443 are available. Keep the application and PostgreSQL
ports private. Do not use a production HTTP `TOOL_URL`.

### Compose Cleanup

Run the maintenance profile at least daily using systemd timer, cron, or the
host’s scheduler:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  --profile maintenance run --rm cleanup
```

Use absolute paths in an unattended scheduler, rotate its logs, and alert when
executions stop.

### Compose Backups And Restore Drill

The named volume is not a substitute for a database backup. Use `pg_dump`
inside the PostgreSQL container to create a custom-format backup:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  exec -T postgres \
  pg_dump --username=canvas_seb --dbname=canvas_seb \
    --format=custom --no-owner --no-acl >safe-online-exam.dump
```

The dump is compressed but not encrypted. Encrypt it immediately with the
institution’s approved tool, move it to access-controlled off-host storage,
and remove the plaintext copy.

Perform a restore drill into a separate database or isolated host. Validate
the archive with `pg_restore --list`, restore with `--exit-on-error`, run the
intended image’s migrations, inspect all application tables, and exercise an
isolated LTI/assessment flow. Record recovery time and the newest restored row.
A backup that has never been restored is not verified.

### Compose Upgrade, Schema And Application Rollback

Download and checksum the next bundle. Preserve the protected environment,
secret files, client identity record, and database volume; merge new template
keys. Run:

```bash
./upgrade.sh .env.secrets
```

The helper creates a PostgreSQL custom-format backup, validates it, pulls the
exact pinned images, applies checked forward migrations, restarts the
topology, and verifies readiness. Copy the backup to encrypted off-host
storage.

Existing installations use the same staged mode transition: upgrade once with
`OAUTH_TOKEN_ENCRYPTION_MODE=compat`, then change it to `enforce`, recreate the
application, and run the maintenance service:

```bash
docker compose --env-file .env.secrets -f compose.yaml -f compose.secrets.yaml \
  --profile maintenance run --rm encrypt-oauth-tokens
```

Run it again and require `0` updates before removing a retired key. Fresh
installations start directly in `enforce` mode.
The Compose upgrade helper inspects the current application container and
rejects an `enforce` upgrade until a `compat` or `enforce` revision has already
run.

Application rollback does not undo database migrations. Restore an older image
only after confirming it supports the current schema. Data rollback requires a
reviewed restore into a controlled target, not an automatic down-migration.

## Existing Container Platforms

A custom platform must preserve:

1. the exact published image digest;
2. a PostgreSQL 17+ database with durable storage;
3. all hardened runtime variables from [Configuration](configuration.md);
4. secret-file or provider-secret injection without logging values;
5. `node dist/server/server/data/migrate.js` as a one-shot pre-traffic job;
6. `node dist/server/server/data/cleanup.js --drain` on a schedule;
7. readiness at `/ready` before receiving traffic;
8. a stable public HTTPS `TOOL_URL`; and
9. backups, restore drills, monitoring, and schema-aware rollback.

The runtime filesystem is disposable. Do not store application state or client
private identities in it. Multiple instances can share PostgreSQL state and do
not require sticky sessions.

## PostgreSQL Pool Sizing

`DATABASE_POOL_MAX` is per application process. Reserve connections for
migrations, cleanup, administrators, monitoring, and restore work:

```text
(maximum app instances × DATABASE_POOL_MAX) + job/admin reserve < max_connections
```

The maintained Cloud Run configs use a pool maximum of 5 and up to 10
application instances, or 50 potential application connections before the
job/administrative reserve. Recalculate both sides before changing either
setting.

## Backups, Monitoring, And Routine Operations

At minimum:

- back up PostgreSQL on a documented schedule and before high-risk changes;
- test restoration into an isolated target at least annually and after
  material backup-policy changes;
- monitor application 5xx, `/ready`, migration/cleanup failures, database
  connections, storage, backup age, cleanup age, and certificate expiry;
- preserve deployment version, image digest, migration result, and secret
  version metadata;
- test Classic Quiz, New Quiz, administrator, instructor, student, detector,
  certificate decryption, Config Key proof, approved tools, and exit after
  meaningful changes; and
- review current Canvas, SEB, OS, and accessibility behavior before each
  high-stakes assessment period.

## Incident Response

For a bad release, stop promotion and preserve logs and database state.
Determine whether the failure is application-only or schema/data-affecting
before moving traffic. Prefer a reviewed forward correction when an older
application is not compatible with the migrated schema.

For a secret incident, rotate only the affected value and deploy the exact new
version. Session-secret rotation invalidates sessions; state-key rotation
invalidates outstanding LTI/OAuth state; LTI key rotation requires Canvas/JWKS
coordination.

For a client-identity incident, pause affected assessments, rotate and
redistribute the private identity, deploy the matching public certificate, and
require fresh `.seb` downloads. Never move private client identity material
into the server or enable production diagnostics as a shortcut.

## Official References

- [Cloud Run deployment with Cloud Build](https://cloud.google.com/build/docs/deploying-builds/deploy-cloud-run)
- [Cloud Run secrets](https://cloud.google.com/run/docs/configuring/services/secrets)
- [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/create-instance)
- [Cloud SQL backup and recovery](https://cloud.google.com/sql/docs/postgres/backup-recovery/restore)
- [Scheduling Cloud Run jobs](https://cloud.google.com/run/docs/execute/jobs-on-schedule)
- [Docker Compose production guidance](https://docs.docker.com/compose/how-tos/production/)

Continue with [Canvas setup](canvas-setup.md), then complete the
[deployment acceptance sequence](testing.md#canvas-and-seb-acceptance).
