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
and `curl`; they do not require an application-source checkout or Cloud Build.

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
candidate first, then disables the generated URL.

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
project-wide Secret Manager access to the runtime.

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

1. validates the existing target;
2. creates and verifies an on-demand Cloud SQL backup;
3. runs the new migration job;
4. updates cleanup;
5. deploys a no-traffic candidate revision;
6. verifies candidate readiness and JWKS; and
7. cuts traffic over explicitly.

If a candidate check fails, the previous revision retains traffic. Completed
forward migrations still exist. Application rollback requires the explicit
schema-compatibility confirmation in the bundle and never reverses migrations.

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
school installation. The Cloud Build configs:

- build the image and reuse the previous cache image where valid;
- run the Dockerfile’s typecheck, lint, format, coverage, build, production
  prune, and runtime assembly;
- run real PostgreSQL migration/concurrency tests separately;
- push and capture an immutable Artifact Registry digest;
- deploy and wait for the migration job;
- update cleanup; and
- deploy the service with exact Secret Manager version pins.

After the project, Artifact Registry, Cloud SQL, runtime identity, secrets,
service URL, and Canvas registrations already exist:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
gcloud builds submit --config=cloudbuild-prod.yaml
```

`cloudbuild-school.yaml` is the parameterized source-build variant for a new
named environment. Inspect every substitution and referenced secret before
submission. A self-hosted Canvas must override its actual LTI authorization
and JWKS endpoints; `LTI_ISSUER` must match the signed claim and should not be
inferred from the hostname.

`cloudbuild-release-promote.yaml` promotes an already published public GHCR
digest without rebuilding source. It deploys the digest to migrations first,
waits, then updates cleanup and the service. Promotion remains an explicit
operator action and should run against development before production.

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
