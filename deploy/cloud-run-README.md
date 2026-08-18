# Safe Online Exam Cloud Run bundle

This bundle installs or upgrades the published Safe Online Exam image without
an application-source checkout or Cloud Build. It uses one immutable image
digest for the migration job, cleanup job, and application service.

The scripts never print secret values. Secret Manager references are pinned to
the exact numbered versions recorded in `.state/secret-versions.env`; they do
not use `latest`. Database migrations finish before application traffic moves.
A candidate revision receives no traffic until both `/ready` and the public
JWKS endpoint succeed.

## Requirements

- a Google Cloud project with billing enabled;
- the current `gcloud` and GitHub (`gh`) CLIs, Docker, `jq`, OpenSSL, `cmp`,
  and `curl`;
- a public GHCR release image reachable from Google Cloud;
- permission to enable APIs and administer Cloud Run, Cloud SQL, IAM, Secret
  Manager, and Cloud Scheduler, including access to compare each exact pinned
  Secret Manager version during an upgrade.

The bundle can create the reviewed Cloud SQL baseline below, or validate an
institution-supplied PostgreSQL 17 Cloud SQL instance in the same region.

Authenticate and verify the release before using the bundle:

```bash
gcloud auth login
gh auth login
gh attestation verify \
  oci://ghcr.io/jsb2010/safe-online-exam@sha256:REPLACE_WITH_RELEASE_DIGEST \
  --repo JSB2010/safe-online-exam \
  --signer-workflow JSB2010/safe-online-exam/.github/workflows/publish-release-image.yml \
  --source-digest REPLACE_WITH_RELEASE_COMMIT \
  --source-ref refs/tags/vX.Y.Z
```

## First installation

### Guided installation

Run the top-level setup command on a terminal:

```bash
./setup.sh
```

It walks through the Google Cloud project, region, branded resource prefix,
warm-instance cost choice, read-only preflight, protected key generation, the
Cloud SQL profile catalog and cost confirmation, Canvas Developer Key handoff,
initial deployment, Canvas LTI registration, and final secret-version cutover.
Secrets are entered without terminal echo. The walkthrough pauses at the two
Canvas steps so the operator can create the required records using the stable
Cloud Run URL it just reserved.

The setup is resumable by phase:

```bash
./setup.sh --stage configure
./setup.sh --stage prepare
./setup.sh --stage install
./setup.sh --stage finalize
```

Use the phase form when another administrator owns the corresponding Canvas
step or when resuming after a deliberate pause.

### Unattended installation

Every underlying phase remains non-interactive, and `setup.sh` has an explicit
unattended contract. Sensitive values are accepted through protected files,
not command-line arguments:

```bash
./setup.sh \
  --non-interactive \
  --stage prepare \
  --env-file cloudrun.env \
  --cloud-sql-profile production-zonal

./setup.sh \
  --non-interactive \
  --stage install \
  --env-file cloudrun.env \
  --canvas-domain https://school.instructure.com \
  --canvas-api-client-id 12345 \
  --canvas-api-client-secret-file /secure/input/canvas-api-secret

./setup.sh \
  --non-interactive \
  --stage finalize \
  --env-file cloudrun.env \
  --lti-client-id 67890 \
  --lti-deployment-id exact-canvas-deployment-id
```

This phase boundary is intentional: with a newly reserved `run.app` URL,
Canvas cannot issue the Developer Key and LTI identifiers until the preceding
phase supplies the URLs. An institution that automates Canvas separately can
run the three commands from its orchestration system without a prompt.

The lower-level commands documented below remain available for operators that
prefer explicit manual orchestration.

Copy and protect the configuration:

```bash
cp cloudrun.env.example cloudrun.env
chmod 600 cloudrun.env
```

Set `LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS=false` in `cloudrun.env` when
students should reach Safe Online Exam only from protected quiz pages. The
install and upgrade scripts pass this value to every Cloud Run job and service;
after deployment, refresh the Canvas LTI Developer Key from `/lti/config` so
Canvas stores the `admins` course-navigation visibility.

Do not extract a release bundle or keep `BOOTSTRAP_DIRECTORY`,
`CLIENT_IDENTITY_DIRECTORY`, or `STATE_DIRECTORY` under `/tmp`, `/private/tmp`,
or `TMPDIR`. `bootstrap-secrets.sh` rejects those locations because automatic
cleanup can destroy the only copy of the SEB client identity and deployment
records. Use a protected, durable operator directory or set those three paths
to approved durable locations before bootstrap.

Set `PROJECT_ID` first. `RESOURCE_NAME=safe-online-exam` keeps all newly
provisioned resources consistently branded:

| Resource                                 | New-install default                                    |
| ---------------------------------------- | ------------------------------------------------------ |
| Cloud Run service and Cloud SQL instance | `safe-online-exam`                                     |
| Migration and cleanup jobs               | `safe-online-exam-migrate`, `safe-online-exam-cleanup` |
| Runtime and scheduler service accounts   | `safe-online-exam`, `safe-online-exam-sched`           |
| PostgreSQL database and user             | `safe_online_exam`                                     |
| Secret Manager prefix                    | `safe_online_exam_`                                    |

For multiple installations in one project, use a short school suffix such as
`RESOURCE_NAME=safe-online-exam-school` and update the derived names in the
template. Keep the service name, project, and region stable after Canvas is
configured. These portable defaults do not rename the repository's existing
maintained `canvas-seb-dev` or `canvas-seb-prod` environments.

The template defaults to Canvas cloud issuer endpoints; override all three
`LTI_*` endpoint values together for a self-hosted Canvas instance.

## Cloud SQL profile chooser

`CLOUD_SQL_PROFILE=production-zonal` is the cost-conscious default. It uses
PostgreSQL 17 Enterprise, one dedicated vCPU, 3.75 GiB memory, and one zone.
It preserves 20 GB SSD with controlled auto-growth, daily backups, 14 retained
backups, seven-day point-in-time recovery, retained/final backups, deletion
protection, encrypted-only connections, required Connector use, and the
production maintenance channel. It trades automatic cross-zone failover and
the HA SLA for a substantially lower bill.

List every supported option without reading configuration or changing Google
Cloud:

```bash
./prepare.sh --list-cloud-sql-profiles
```

The catalog shows the profile name, approximate us-central1 monthly price as
of July 26, 2026, features, recommendation, and on-demand or committed term.
It includes dedicated zonal and HA profiles, larger dedicated profiles,
shared-core pilot/development profiles, and `existing-reviewed`. Shared-core
profiles keep the bundle's backup and connection controls but are clearly
marked as not recommended for production.

On a terminal, `--create-sql` starts the interactive chooser and requires the
operator to type the target SQL instance name before creating a billable
resource:

```bash
./prepare.sh cloudrun.env --create-sql
```

For automation, disable prompts and supply the exact profile through a flag:

```bash
./prepare.sh cloudrun.env \
  --create-sql \
  --non-interactive \
  --cloud-sql-profile production-zonal
```

`CLOUD_SQL_PROFILE` in `cloudrun.env` is also accepted in non-interactive mode.
`--cloud-sql-profile` is a one-run override; keep the selected value in the
protected environment file so later diagnostics describe the same instance.

Cloud SQL committed use discounts apply to eligible CPU and memory spend
across a billing account and region; they do not attach to one instance or
discount storage and backups. Because they cannot be cancelled after purchase,
the installer displays one- and three-year reference prices but never silently
purchases a commitment. Review the live
[Cloud SQL pricing](https://cloud.google.com/sql/pricing) and
[committed-use terms](https://cloud.google.com/sql/docs/postgres/cud) before
making that separate billing decision. Shared-core and single-zone instances
are excluded from the [Cloud SQL SLA](https://cloud.google.com/sql/sla).

Set `CLOUD_SQL_PROFILE=existing-reviewed` when the institution provisions and
reviews its own instance. That mode never creates Cloud SQL and checks only
PostgreSQL 17 and the configured region. The institution then owns HA,
capacity, backup, recovery, network, and deletion-protection review.

Standard Cloud SQL backups are the cost-conscious default. For stricter
separation, retention locks, or protection from project deletion, evaluate
[enhanced backups in a separate backup project](https://cloud.google.com/sql/docs/postgres/backup-recovery/backup-options).
That option adds cost and operational complexity and is therefore not created
silently by this bundle.

Run the read-only preflight:

```bash
./doctor.sh cloudrun.env
```

It validates the local tools, active Google account, project, billing when the
caller can inspect it, Docker engine, immutable image availability, config,
and exact resource plan. It changes no Google Cloud resources.

Run the installation phases in order:

```bash
./bootstrap-secrets.sh cloudrun.env
./prepare.sh cloudrun.env --create-sql
./canvas-theme-loader.sh cloudrun.env
```

`--create-sql` remains an explicit cost authorization. Without it, `prepare.sh`
refuses to create a missing instance and prints the safe rerun command. It is
not used with `existing-reviewed`. Interactive selection never weakens that
separate authorization requirement.

`prepare.sh` enables the required APIs, creates the least-privileged runtime
identity, grants Cloud SQL Client, creates or validates the selected SQL
instance, creates the database and user when absent, and reserves the stable
Cloud Run URL. It verifies that the instance's exact tier and availability
model match the selected profile, then requires the shared backup, PITR,
storage, deletion-protection, and encrypted connector controls for every
bundle-created profile. It waits for Cloud SQL Admin API propagation and for a
new instance to become `RUNNABLE`; it does not blindly retry an ambiguous
create operation. It writes the URL into the protected bootstrap directory.

### Custom domain and generated Cloud Run URL

When using a Cloud Run domain mapping, set `TOOL_URL` to the intended custom
HTTPS hostname before `prepare.sh`. After prepare reserves the service, create
or inspect the mapping explicitly:

```bash
./map-domain.sh cloudrun.env
```

The command prints the required DNS records and mapping conditions. Complete
DNS/domain ownership and wait until the mapping is `Ready`, then verify the
custom origin's health, readiness, JWKS, and LTI endpoints. The helper does not
change external DNS or purchase a load balancer. Cloud Run domain mapping is a
Preview feature; use an approved load balancer instead when that risk is not
acceptable.

Set `DISABLE_DEFAULT_URL_AFTER_FINALIZE=true` only after the custom origin has
passed those checks. Finalization verifies its zero-traffic candidate using the
generated URL, cuts over only after that succeeds, verifies the custom origin,
and then disables the generated URL. Later upgrades preserve that policy: they
verify the custom origin, temporarily restore the generated URL for tagged
candidate checks, cut over, and disable it again even when the upgrade exits
early. This prevents the restriction from blocking its own guarded cutover.

Create the Canvas API Developer Key for the stable URL. Fill these protected
files without adding a trailing newline:

```text
.local/safe-online-exam-cloudrun-bootstrap/canvas_domain
.local/safe-online-exam-cloudrun-bootstrap/canvas_api_client_id
.local/safe-online-exam-cloudrun-bootstrap/canvas_api_client_secret
```

Leave `lti_client_id` and `lti_deployment_id` set to `bootstrap-pending`, then:

```bash
./install.sh cloudrun.env
```

The install creates secret containers and exact versions, grants secret access
only to the runtime service account, deploys and executes migrations, creates
the cleanup job, verifies a no-traffic application revision, cuts traffic over,
creates the cleanup scheduler, and executes cleanup once.

Upload the generated `canvas-theme-loader.js` to the active Canvas account or
sub-account Theme Desktop JavaScript before testing a protected assessment. It
loads the detector from the configured tool origin only on supported Classic
Quiz and New Quiz routes. This Canvas theme step is separate from the LTI
registration and cannot be safely inferred or changed by deployment
credentials.

Use the now-public `${TOOL_URL}/lti/config` document to create and install the
Canvas LTI registration. Replace the two bootstrap values with the actual
Canvas IDs and finalize them:

```bash
./finalize-lti.sh cloudrun.env
```

This creates new numbered versions for only the two LTI identifiers, updates
both jobs, stages and verifies a service revision, and explicitly cuts traffic
over. Keep `.state/secret-versions.env` with protected deployment records. It
contains version numbers and resource metadata, not secret values.

The matching SEB `.p12`, private key, and password under
`.local/safe-online-exam-client-identity` are client-only material. Move that
directory into the approved MDM/client-deployment vault. Never upload it to
Secret Manager, Cloud Run, source control, support tickets, or a GitHub
Release.

## Public access

Canvas must be able to reach the tool without a Google login. With
`PUBLIC_ACCESS=true`, the installer grants `roles/run.invoker` to `allUsers` on
the one service. If organization policy forbids that binding, set
`PUBLIC_ACCESS=false`, place an approved public HTTPS load balancer in front,
and set `TOOL_URL` to its stable origin. The operator running the scripts still
needs permission to invoke candidate revisions for readiness verification.

## Upgrade

Treat the directory containing the protected `cloudrun.env` as the durable
installation home. Its relative bootstrap, state, and client-identity paths
remain anchored there even when a command is run from a newly extracted
bundle. Download and checksum the new bundle, preserve that installation home,
merge any new keys from `cloudrun.env.example`, then replace only `APP_VERSION`
and `APP_IMAGE` with the new bundle's values:

```bash
NEW_BUNDLE=/opt/safe-online-exam-X.Y.Z-cloud-run
EXISTING_ENV=/srv/safe-online-exam/cloudrun.env
"$NEW_BUNDLE/upgrade.sh" "$EXISTING_ENV"
```

Do not copy `.bootstrap`, `.state`, or `.client-identity` into each versioned
bundle. Absolute paths remain absolute; relative protected paths resolve from
the existing environment file, not from the new bundle or current directory.

The upgrade refuses to continue unless `OAUTH_TOKEN_ENCRYPTION_MODE` is
assigned explicitly in `cloudrun.env`. Use `compat` for the first deployment
to an existing installation; do not let a default opt the installation into
encrypted writes.

For the first upgrade from a release without OAuth-token encryption,
`upgrade.sh` generates only the missing protected
`oauth_token_encryption_keyring` file. It never reruns bootstrap, overwrites an
existing keyring, or rotates any established secret. The normal version check
then uploads and records the new keyring as its own numbered Secret Manager
version. If the local file is missing after a keyring version has been recorded
locally or created in Secret Manager, the upgrade stops and requires the
protected file to be restored instead of silently generating replacement key
bytes. The upgrade also rejects `enforce` until the existing traffic-serving
revision has completed a `compat` deployment.

Before reusing a recorded secret version, the helper byte-compares that exact
enabled Secret Manager version with its protected bootstrap file. The
comparison uses a mode-`0600` temporary file under the protected state
directory and removes it immediately. Changed bootstrap values receive a new
numbered version; a deployer that cannot access the pinned version is stopped
before backup or deployment rather than silently reusing it.

When introducing or rotating OAuth-token encryption keys, follow the staged
`compat` then `enforce` deployment documented in `docs/deployment.md` and run:

```bash
./encrypt-oauth-tokens.sh cloudrun.env
```

The command:

1. validates the complete current environment and bootstrap contract, creates
   any newly required numbered secrets, and grants the runtime identity access;
2. creates an on-demand backup of `SQL_INSTANCE`, waits for the Cloud SQL
   operation to finish, and requires the backup status to be `SUCCESSFUL`;
3. records the previous traffic revision;
4. updates and executes the migration job;
5. updates the cleanup job and applies the current environment and numbered
   secret bindings to both jobs;
6. deploys the application image with those same bindings to a tagged revision
   with no traffic;
7. when the generated URL was disabled, verifies the custom origin and
   temporarily enables the generated URL for the tagged candidate;
8. verifies `/ready` and `/.well-known/jwks.json`;
9. moves 100% of traffic to the verified revision;
10. verifies the custom origin and restores the prior generated-URL policy.

If any candidate check fails, the explicit cutover does not run. The old
application revision therefore keeps traffic, although completed forward
migrations remain in the database. A guarded exit attempts to restore a
previously disabled generated URL before returning the failure.

There is no unattended application-image updater. Review each release,
attestation, migration notes, and backup before running the upgrade.

## Rollback

Every upgrade writes a protected rollback record under `.state`. Application
rollback does not undo database migrations. Only after confirming the previous
revision supports the migrated schema:

```bash
./rollback.sh \
  cloudrun.env \
  .state/rollback-X.Y.Z-YYYYMMDDTHHMMSSZ.env \
  --confirm-schema-compatible
```

For schema or data recovery, restore the verified Cloud SQL backup into a
controlled target and follow the institution's recovery procedure. Do not
automatically run down-migrations or overwrite the active database.

Rollback verifies `TOOL_URL` when a custom origin is configured, so it remains
usable when the generated Cloud Run URL is disabled.

## Post-deployment checks

Verify the stable HTTPS origin, then complete a real Canvas and SEB acceptance
pass:

```bash
curl -fsS "$TOOL_URL/health"
curl -fsS "$TOOL_URL/ready"
curl -fsS "$TOOL_URL/.well-known/jwks.json"
curl -fsS "$TOOL_URL/lti/config"
curl -fsS "$TOOL_URL/js/canvas-seb-detector.js"
```

Also inspect migration and cleanup executions, the active revision and image
digest, Cloud SQL backup status, the daily Scheduler job, and application
errors. Test Classic Quiz, New Quiz, OAuth, detector, `.seb` generation,
managed-client certificate decryption, Config Key proof, and exit behavior.

Set alerts before go-live for Cloud Run 5xx/readiness failures, failed
migration or cleanup jobs, Cloud SQL failovers and backup failures, connection
pool saturation, and storage growth. The default 100 GB auto-growth cap is a
cost guardrail, not a substitute for an alert; raise it before the database
approaches the cap. Run a restore drill into a separate instance at least
annually and after material backup-policy changes.
