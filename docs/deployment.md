# Deployment And Operations

The application has two supported deployment modes:

1. **Google Cloud Run with Cloud SQL (recommended):** managed HTTPS ingress, managed PostgreSQL, immutable Artifact Registry images, Secret Manager, migration and cleanup jobs, and Cloud Build as the release gate.
2. **Docker Compose on a Linux VPS or container host:** the same application image, PostgreSQL 17, mounted secrets, a persistent volume, and an operator-managed TLS reverse proxy, scheduler, backups, and monitoring.

The runtime itself is provider-agnostic. It needs a Node.js container, PostgreSQL 17 or newer, environment variables or mounted secret files, an HTTPS public origin, a one-shot migration command before a new revision, and a scheduled cleanup command. Google-specific behavior is confined to the checked-in Cloud Build deployment configuration.

## Public Releases And Image Tags

GitHub Releases are the public release authority. Publishing a stable release from a `vX.Y.Z` tag whose `X.Y.Z` version matches `package.json` runs verification, PostgreSQL integration, and Compose smoke tests before publishing the multi-architecture image:

```text
ghcr.io/jsb2010/safe-online-exam:X.Y.Z   immutable release
ghcr.io/jsb2010/safe-online-exam:X.Y     current patch release for that minor
ghcr.io/jsb2010/safe-online-exam:X       current stable release for that major
ghcr.io/jsb2010/safe-online-exam:latest  newest stable GitHub Release
```

Each release also publishes a provenance attestation, SBOM, an exact manifest digest, and `safe-online-exam-X.Y.Z-compose.tar.gz`. Pre-releases publish only their exact prerelease tag and never move `latest`, `X`, or `X.Y`. The repository owner must make the linked GHCR package public once in GitHub Packages settings.

Tags are mutable pointers. Production Compose and Cloud Run deployments must use the exact digest shown in the GitHub Release, for example `ghcr.io/jsb2010/safe-online-exam@sha256:...`.

## Release Invariants

- Keep each Canvas environment isolated by public URL, database, credentials, secrets, LTI deployment, and runtime identity.
- Run the exact image's migrations before sending traffic to that image.
- Deploy immutable image digests in managed environments.
- Treat application rollback and schema recovery as separate decisions.
- Keep PostgreSQL private. Only the HTTPS application endpoint is public.
- Use `/health` for process liveness and `/ready` for database and schema readiness.
- Do not change an existing Cloud Run service name, project, or region unless a Canvas URL change is intentional.

## Mode 1: Google Cloud Run With Cloud SQL (Recommended)

The maintained resources are:

| Environment | Cloud Run service | Cloud SQL instance | Runtime service account | Region        |
| ----------- | ----------------- | ------------------ | ----------------------- | ------------- |
| Development | `canvas-seb-dev`  | `canvas-seb-dev`   | `seb-canvas-dev`        | `us-central1` |
| Production  | `canvas-seb-prod` | `canvas-seb-prod`  | `seb-canvas-prod`       | `us-central1` |

The default database is `canvas_seb`, the database user is `canvas_seb`, and the Artifact Registry repository is `canvas-seb-repo`.

Deploying a new revision to the same Cloud Run service in the same project and region is an in-place application replacement. The service URL remains the same, Cloud SQL data remains in the existing instance, and Canvas does not need a URL change. Cloud Run creates a new revision and moves traffic only after the migration job and deployment succeed.

The commands below provision development. Substitute the production names and use `cloudbuild-prod.yaml` for production.

### 1. Select The Project And Enable APIs

Install the current Google Cloud CLI or use Cloud Shell. The account running these commands needs permission to enable services and create IAM, Cloud SQL, Artifact Registry, Secret Manager, Cloud Run, Cloud Scheduler, and Cloud Build resources.

```bash
gcloud auth login

export PROJECT_ID="your-google-cloud-project-id"
export REGION="us-central1"
export SERVICE="canvas-seb-dev"
export SQL_INSTANCE="canvas-seb-dev"
export DATABASE_NAME="canvas_seb"
export DATABASE_USER="canvas_seb"
export REPOSITORY="canvas-seb-repo"
export IMAGE="canvas-seb-dev"
export RUNTIME_SA_NAME="seb-canvas-dev"
export RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"
gcloud config set run/region "$REGION"

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  serviceusage.googleapis.com
```

Confirm that billing is enabled before creating Cloud SQL. Keep these shell variables for the remaining steps.

### 2. Create Artifact Registry And Runtime Identity

```bash
gcloud artifacts repositories describe "$REPOSITORY" \
  --location="$REGION" >/dev/null 2>&1 || \
gcloud artifacts repositories create "$REPOSITORY" \
  --location="$REGION" \
  --repository-format=docker \
  --description="Safe Online Exam application images"

gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 || \
gcloud iam service-accounts create "$RUNTIME_SA_NAME" \
  --display-name="Safe Online Exam development runtime"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudsql.client"
```

Grant Cloud SQL Client access limited to the configured project. Secret access is granted separately on the exact secret resources below; do not grant project-wide Secret Accessor.

### 3. Create Cloud SQL

This development-sized example uses a zonal Cloud SQL Enterprise instance. For production, choose a reviewed capacity, `--availability-type=regional`, a backup location and retention policy that meet institutional requirements, and deletion protection.

```bash
gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 || \
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_17 \
  --edition=ENTERPRISE \
  --cpu=1 \
  --memory=3840MiB \
  --region="$REGION" \
  --availability-type=zonal \
  --storage-type=SSD \
  --storage-size=20 \
  --storage-auto-increase \
  --backup-start-time=06:00 \
  --enable-point-in-time-recovery \
  --retained-backups-count=7 \
  --deletion-protection

gcloud sql databases describe "$DATABASE_NAME" \
  --instance="$SQL_INSTANCE" >/dev/null 2>&1 || \
gcloud sql databases create "$DATABASE_NAME" \
  --instance="$SQL_INSTANCE"
```

Create protected local bootstrap files. `.local/` is ignored by Git and build contexts, but it is not a long-term secret store.

```bash
umask 077
export BOOTSTRAP_DIR=".local/gcloud-${SERVICE}"
mkdir -p "$BOOTSTRAP_DIR"
openssl rand -base64 48 >"$BOOTSTRAP_DIR/database_password"

gcloud sql users describe "$DATABASE_USER" \
  --instance="$SQL_INSTANCE" >/dev/null 2>&1 || \
gcloud sql users create "$DATABASE_USER" \
  --instance="$SQL_INSTANCE" \
  --password="$(tr -d '\r\n' <"$BOOTSTRAP_DIR/database_password")"
```

Do not add broad Cloud SQL authorized networks. Cloud Run connects through the Cloud SQL attachment and authenticated Unix socket configured by the build.

### 4. Reserve The Stable Cloud Run URL

If the service already exists, skip the placeholder deployment and read its current URL. For a new installation, create a same-name placeholder first so the final `TOOL_URL` is known before Canvas and Secret Manager are configured:

```bash
if ! gcloud run services describe "$SERVICE" --region="$REGION" >/dev/null 2>&1; then
  gcloud run deploy "$SERVICE" \
    --image="us-docker.pkg.dev/cloudrun/container/hello" \
    --region="$REGION" \
    --platform=managed
fi

export TOOL_URL="$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --format='value(status.url)')"
printf 'Stable service URL: %s\n' "$TOOL_URL"
```

Keep the same project, region, and service name on later deployments. If you use a custom domain, finish and verify that mapping first and use the custom HTTPS origin as `TOOL_URL` instead.

Canvas browsers must be able to reach the service without Google IAM authentication. Cloud Build deliberately does not modify the service's public IAM policy, so grant Cloud Run Invoker to `allUsers` once during provisioning:

```bash
gcloud run services add-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Later same-service deployments preserve this policy. If organization policy forbids public Cloud Run invocation, place an approved public HTTPS load balancer in front and use that stable origin; Canvas cannot launch a service that requires a Google sign-in challenge.

### 5. Create Canvas API Credentials And Certificates

Use the stable callback `${TOOL_URL}/api/oauth2callback` to create the Canvas API Developer Key described in [Canvas setup](canvas-setup.md). Record its client ID and secret in protected files:

```bash
printf '%s' 'your-canvas-api-client-id' >"$BOOTSTRAP_DIR/api_client_id"
printf '%s' 'your-canvas-api-client-secret' >"$BOOTSTRAP_DIR/api_client_secret"
printf '%s' 'https://school.instructure.com' >"$BOOTSTRAP_DIR/canvas_domain"
printf '%s' "$TOOL_URL" >"$BOOTSTRAP_DIR/tool_url"
```

Generate the LTI signing key and SEB configuration-encryption identity:

```bash
node scripts/generate-lti-private-key.mjs "$SERVICE" \
  >"$BOOTSTRAP_DIR/lti_private_key"

openssl rand -base64 48 >"$BOOTSTRAP_DIR/seb_p12_password"
SEB_CERT_NAME=seb-config-encryption \
SEB_CERT_SUBJECT="/CN=Safe Online Exam Configuration Encryption/O=Organization" \
bash scripts/generate-seb-config-cert.sh \
  "$BOOTSTRAP_DIR/seb-certs" \
  "$BOOTSTRAP_DIR/seb_p12_password"

openssl rand -base64 48 >"$BOOTSTRAP_DIR/session_secret"
openssl rand -base64 48 >"$BOOTSTRAP_DIR/state_encryption_key"
printf '%s' 'bootstrap-pending' >"$BOOTSTRAP_DIR/lti_client_id"
printf '%s' 'bootstrap-pending' >"$BOOTSTRAP_DIR/lti_deployment_id"
```

Move the `.p12`, matching private PEM, and passphrase into approved restricted client-deployment storage. Only the public certificate PEM is uploaded to the service. See [Certificate management](certificate-management.md).

### 6. Create And Authorize Secret Manager Secrets

The dev build expects these exact secret names:

| Secret                               | Source file or value                      |
| ------------------------------------ | ----------------------------------------- |
| `dev_canvas_domain`                  | `canvas_domain`                           |
| `dev_lti_client_id`                  | `lti_client_id`                           |
| `dev_lti_deployment_id`              | `lti_deployment_id`                       |
| `dev_tool_url`                       | `tool_url`                                |
| `dev_lti_private_key`                | `lti_private_key`                         |
| `dev_session_secret`                 | `session_secret`                          |
| `dev_state_encryption_key`           | `state_encryption_key`                    |
| `dev_api_client_id`                  | `api_client_id`                           |
| `dev_api_client_secret`              | `api_client_secret`                       |
| `dev_seb_config_encryption_cert_pem` | `seb-certs/seb-config-encryption.crt.pem` |
| `dev_database_password`              | `database_password`                       |

Create the secret containers if they do not exist:

```bash
for secret in \
  dev_canvas_domain \
  dev_lti_client_id \
  dev_lti_deployment_id \
  dev_tool_url \
  dev_lti_private_key \
  dev_session_secret \
  dev_state_encryption_key \
  dev_api_client_id \
  dev_api_client_secret \
  dev_seb_config_encryption_cert_pem \
  dev_database_password; do
  gcloud secrets describe "$secret" >/dev/null 2>&1 || \
    gcloud secrets create "$secret" --replication-policy=automatic
done
```

Add version 1 for a fresh environment:

```bash
gcloud secrets versions add dev_canvas_domain \
  --data-file="$BOOTSTRAP_DIR/canvas_domain"
gcloud secrets versions add dev_lti_client_id \
  --data-file="$BOOTSTRAP_DIR/lti_client_id"
gcloud secrets versions add dev_lti_deployment_id \
  --data-file="$BOOTSTRAP_DIR/lti_deployment_id"
gcloud secrets versions add dev_tool_url \
  --data-file="$BOOTSTRAP_DIR/tool_url"
gcloud secrets versions add dev_lti_private_key \
  --data-file="$BOOTSTRAP_DIR/lti_private_key"
gcloud secrets versions add dev_session_secret \
  --data-file="$BOOTSTRAP_DIR/session_secret"
gcloud secrets versions add dev_state_encryption_key \
  --data-file="$BOOTSTRAP_DIR/state_encryption_key"
gcloud secrets versions add dev_api_client_id \
  --data-file="$BOOTSTRAP_DIR/api_client_id"
gcloud secrets versions add dev_api_client_secret \
  --data-file="$BOOTSTRAP_DIR/api_client_secret"
gcloud secrets versions add dev_seb_config_encryption_cert_pem \
  --data-file="$BOOTSTRAP_DIR/seb-certs/seb-config-encryption.crt.pem"
gcloud secrets versions add dev_database_password \
  --data-file="$BOOTSTRAP_DIR/database_password"
```

Grant only the runtime identity access to each secret:

```bash
for secret in \
  dev_canvas_domain \
  dev_lti_client_id \
  dev_lti_deployment_id \
  dev_tool_url \
  dev_lti_private_key \
  dev_session_secret \
  dev_state_encryption_key \
  dev_api_client_id \
  dev_api_client_secret \
  dev_seb_config_encryption_cert_pem \
  dev_database_password; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

Cloud Run secret environment variables are pinned to numbered versions. Never change the build to use `latest`.

### 7. Grant The Cloud Build Deployer Permissions

Cloud Build's default service account differs between projects. Discover the actual identity rather than assuming its address:

```bash
export BUILD_SA="$(gcloud builds get-default-service-account \
  --format='value(serviceAccountEmail)')"
printf 'Cloud Build service account: %s\n' "$BUILD_SA"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/run.admin"

gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
  --location="$REGION" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/artifactregistry.writer"

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/iam.serviceAccountUser"
```

The person submitting builds also needs permission to use the selected Cloud Build service account. Organizations with custom policies should use a dedicated build service account and grant the same minimum deployer permissions.

### 8. First Application Deployment

The first pass replaces the placeholder service with the real container, creates and executes `canvas-seb-dev-migrate`, creates `canvas-seb-dev-cleanup`, and then deploys `canvas-seb-dev`. Override every dev secret version: the checked-in defaults describe the maintained environment and are not fresh-install defaults.

```bash
gcloud builds submit \
  --config=cloudbuild-dev.yaml \
  --substitutions=_CANVAS_DOMAIN_SECRET_VERSION=1,_LTI_CLIENT_ID_SECRET_VERSION=1,_LTI_DEPLOYMENT_ID_SECRET_VERSION=1,_LTI_DEPLOYMENT_ID_CHECKING_ENABLED=true,_SEB_CONFIG_ENCRYPTION_ENABLED=true,_TOOL_URL_SECRET_VERSION=1,_LTI_PRIVATE_KEY_SECRET_VERSION=1,_SESSION_SECRET_VERSION=1,_STATE_ENCRYPTION_KEY_SECRET_VERSION=1,_CANVAS_API_CLIENT_ID_SECRET_VERSION=1,_CANVAS_API_CLIENT_SECRET_VERSION=1,_SEB_CONFIG_ENCRYPTION_CERT_SECRET_VERSION=1,_DATABASE_PASSWORD_SECRET_VERSION=1
```

The Dockerfile performs install, typecheck, lint, format verification, coverage tests, build, production prune, and runtime assembly. BuildKit inline cache metadata and the Dockerfile's independent verification/production-dependency stages allow reusable or independent work to avoid unnecessary serialization. Cloud Build also runs the real PostgreSQL migration and concurrency suite. It pushes an immutable image digest, waits for the migration job, deploys the cleanup job, and deploys the service only after migration succeeds.

Verify that the real application now owns the stable URL:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/ready"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsS "${TOOL_URL}/lti/config"
```

### 9. Finish Canvas LTI Setup And Deploy Again

Use `${TOOL_URL}/lti/config` to create the Canvas LTI 1.3 Developer Key, enable it, and record its client ID. Install the app at the intended Canvas account or course scope and record the deployment ID. Follow [Canvas setup](canvas-setup.md) completely, including OAuth scopes and the detector theme loader.

Replace the bootstrap files and add new immutable secret versions:

```bash
printf '%s' 'actual-canvas-lti-client-id' >"$BOOTSTRAP_DIR/lti_client_id"
printf '%s' 'actual-canvas-lti-deployment-id' >"$BOOTSTRAP_DIR/lti_deployment_id"

gcloud secrets versions add dev_lti_client_id \
  --data-file="$BOOTSTRAP_DIR/lti_client_id"
gcloud secrets versions add dev_lti_deployment_id \
  --data-file="$BOOTSTRAP_DIR/lti_deployment_id"
```

If these are versions 2, deploy with only those two pins changed:

```bash
gcloud builds submit \
  --config=cloudbuild-dev.yaml \
  --substitutions=_CANVAS_DOMAIN_SECRET_VERSION=1,_LTI_CLIENT_ID_SECRET_VERSION=2,_LTI_DEPLOYMENT_ID_SECRET_VERSION=2,_SEB_CONFIG_ENCRYPTION_ENABLED=true,_TOOL_URL_SECRET_VERSION=1,_LTI_PRIVATE_KEY_SECRET_VERSION=1,_SESSION_SECRET_VERSION=1,_STATE_ENCRYPTION_KEY_SECRET_VERSION=1,_CANVAS_API_CLIENT_ID_SECRET_VERSION=1,_CANVAS_API_CLIENT_SECRET_VERSION=1,_SEB_CONFIG_ENCRYPTION_CERT_SECRET_VERSION=1,_DATABASE_PASSWORD_SECRET_VERSION=1
```

Always confirm actual version numbers with `gcloud secrets versions list SECRET_NAME`; do not assume `2` if the secret already had versions.

### 10. Schedule Cleanup

The build creates the cleanup job but intentionally does not create its schedule. Create a scheduler-only identity, grant it Cloud Run Invoker on that job, and invoke it daily through the Cloud Run v2 Jobs API:

```bash
export SCHEDULER_SA_NAME="${SERVICE}-scheduler"
export SCHEDULER_SA="${SCHEDULER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
export CLEANUP_JOB="${SERVICE}-cleanup"

gcloud iam service-accounts describe "$SCHEDULER_SA" >/dev/null 2>&1 || \
gcloud iam service-accounts create "$SCHEDULER_SA_NAME" \
  --display-name="Safe Online Exam cleanup scheduler"

gcloud run jobs add-iam-policy-binding "$CLEANUP_JOB" \
  --region="$REGION" \
  --member="serviceAccount:${SCHEDULER_SA}" \
  --role="roles/run.invoker"

gcloud scheduler jobs describe "${SERVICE}-cleanup-daily" \
  --location="$REGION" >/dev/null 2>&1 || \
gcloud scheduler jobs create http "${SERVICE}-cleanup-daily" \
  --location="$REGION" \
  --schedule="17 3 * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${CLEANUP_JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="$SCHEDULER_SA"
```

Run it once and confirm a successful execution:

```bash
gcloud run jobs execute "$CLEANUP_JOB" \
  --region="$REGION" \
  --wait
gcloud run jobs executions list \
  --job="$CLEANUP_JOB" \
  --region="$REGION" \
  --limit=5
```

### Production And Parameterized Deployments

`cloudbuild-prod.yaml` preserves `canvas-seb-prod`, uses `APP_ENV=prod`, disables detector diagnostics, keeps one minimum instance, and allows up to ten instances. It expects `prod_canvas_domain`, `prod_lti_client_id`, `prod_lti_deployment_id`, `prod_tool_url`, `prod_lti_private_key`, `prod_session_secret`, `prod_state_encryption_key`, `prod_api_client_id`, `prod_api_client_secret`, `prod_seb_config_encryption_cert_pem`, and `prod_database_password`. Its non-database secrets share `_SECRET_VERSION`; create the same numbered version for every non-database secret before changing that substitution. The database-password version is independently pinned. `_SEB_CONFIG_ENCRYPTION_ENABLED` defaults to `true`; set it to `false` only for an instance that cannot distribute client private identities.

```bash
gcloud builds submit \
  --config=cloudbuild-prod.yaml \
  --substitutions=_SECRET_VERSION=1,_DATABASE_PASSWORD_SECRET_VERSION=1,_LTI_DEPLOYMENT_ID_CHECKING_ENABLED=true,_SEB_CONFIG_ENCRYPTION_ENABLED=true
```

`cloudbuild-school.yaml` is the parameterized template for another installation. With `_SECRET_PREFIX=canvas_seb`, it expects the same suffixes shown above under `canvas_seb_*` secret names:

For a self-hosted Canvas platform, override its authorization and JWKS endpoints. The Canvas cloud defaults are intentionally retained in the template, but their authorization endpoint redirects a self-hosted launch to `sso.canvaslms.com` and will fail inside the Canvas iframe. Do not infer `_LTI_ISSUER` from the Canvas hostname: retain its default unless the actual Canvas launch's `iss` field differs.

```text
_LTI_KEY_SET_URL=https://canvas.example.edu/api/lti/security/jwks
_LTI_AUTH_URL=https://canvas.example.edu/api/lti/authorize_redirect
```

```bash
gcloud builds submit \
  --config=cloudbuild-school.yaml \
  --substitutions=_LOCATION=us-central1,_REPOSITORY=canvas-seb-repo,_SERVICE=canvas-seb,_IMAGE=canvas-seb,_APP_ENV=prod,_CLOUD_SQL_INSTANCE=canvas-seb,_DATABASE_NAME=canvas_seb,_DATABASE_USER=canvas_seb,_DATABASE_POOL_MAX=5,_LTI_KEY_SET_URL=https://canvas.example.edu/api/lti/security/jwks,_LTI_AUTH_URL=https://canvas.example.edu/api/lti/authorize_redirect,_SECRET_PREFIX=canvas_seb,_SECRET_VERSION=1,_DATABASE_PASSWORD_SECRET_VERSION=1,_LTI_DEPLOYMENT_ID_CHECKING_ENABLED=true,_SEB_CONFIG_ENCRYPTION_ENABLED=true,_SERVICE_ACCOUNT=seb-canvas,_MIN_INSTANCES=0,_MAX_INSTANCES=10
```

Inspect every substitution and referenced secret before the first build.

### Cloud SQL Backups And Restore Drills

Keep automated backups and point-in-time recovery enabled. Create an on-demand backup before a high-risk release and verify it completed:

```bash
gcloud sql backups create \
  --instance="$SQL_INSTANCE" \
  --description="pre-release $(date -u +%Y-%m-%dT%H:%M:%SZ)"

gcloud sql backups list \
  --instance="$SQL_INSTANCE" \
  --limit=10
```

Cloud SQL backups are encrypted by the service. A restore drill must target a separate instance; restoring into the live instance overwrites it. The following creates a separate drill instance from the newest listed backup:

```bash
export BACKUP_ID="$(gcloud sql backups list \
  --instance="$SQL_INSTANCE" \
  --sort-by='~endTime' \
  --limit=1 \
  --format='value(id)')"
export RESTORE_INSTANCE="${SQL_INSTANCE}-restore-drill"

gcloud sql backups restore "$BACKUP_ID" \
  --backup-instance="$SQL_INSTANCE" \
  --restore-instance="$RESTORE_INSTANCE" \
  --region="$REGION" \
  --edition=ENTERPRISE \
  --cpu=1 \
  --memory=3840MiB \
  --no-deletion-protection
```

Connect only an isolated migration/readiness test to the drill instance. Record recovery time and the newest restored row timestamp, then delete the drill instance after the result is approved. Never point the active Cloud Run service at a restore drill.

### Release Smoke Checks, Logs, And Monitoring

Run after every release:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/ready"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsS "${TOOL_URL}/lti/config"
curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
curl -fsS "${TOOL_URL}/js/canvas-seb-theme-loader.js" | head

gcloud run services describe "$SERVICE" \
  --region="$REGION"
gcloud run revisions list \
  --service="$SERVICE" \
  --region="$REGION" \
  --limit=10
gcloud run jobs executions list \
  --job="${SERVICE}-migrate" \
  --region="$REGION" \
  --limit=5
gcloud run services logs read "$SERVICE" \
  --region="$REGION" \
  --limit=200
```

Alert on application 5xx responses, readiness failures, Cloud Run job failures, PostgreSQL connection saturation, Cloud SQL storage growth, failed backups, old cleanup executions, and certificate expiry. Complete the Classic Quiz, New Quiz, and real SEB acceptance sequence in [Testing](testing.md).

### Upgrades, Schema And Application Rollback

Normal upgrades are the same Cloud Build submission. The BuildKit build imports the prior inline-cache image, reuses unchanged layers, verifies the new image, runs PostgreSQL integration tests, deploys and waits for migrations, and then creates a new Cloud Run revision at the existing URL.

Before rollback, determine whether the previous application revision is compatible with the current schema. List revisions, then move traffic only when compatibility is confirmed:

```bash
gcloud run revisions list \
  --service="$SERVICE" \
  --region="$REGION"

gcloud run services update-traffic "$SERVICE" \
  --region="$REGION" \
  --to-revisions="PREVIOUS_REVISION=100"
```

Traffic rollback does not roll back PostgreSQL. Schema recovery means a reviewed forward migration or a restore into a controlled target; never run automatic down-migrations during a failed deploy. Use expand/migrate/deploy/contract changes so adjacent application revisions remain compatible whenever possible.

### Promote A Published GitHub Release To Cloud Run

Publishing a GitHub Release does **not** deploy the maintained production service. First verify the release notes' image digest and take an on-demand database backup. Then use the dedicated promotion configuration, which deploys that exact public GHCR digest to the migration job, waits for it, and only then updates the cleanup job and service:

```bash
export RELEASE_DIGEST="sha256:REPLACE_WITH_THE_GITHUB_RELEASE_DIGEST"

gcloud builds submit \
  --config=cloudbuild-release-promote.yaml \
  --substitutions=_IMAGE_DIGEST="$RELEASE_DIGEST",_LOCATION=us-central1,_SERVICE=canvas-seb-prod,_APP_ENV=prod,_CLOUD_SQL_INSTANCE=canvas-seb-prod,_DATABASE_NAME=canvas_seb,_DATABASE_USER=canvas_seb,_DATABASE_POOL_MAX=5,_SECRET_PREFIX=prod,_SECRET_VERSION=1,_DATABASE_PASSWORD_SECRET_VERSION=1,_LTI_DEPLOYMENT_ID_CHECKING_ENABLED=true,_SERVICE_ACCOUNT=seb-canvas-prod
```

The public package must remain reachable to Cloud Run. The checked-in promotion helper accepts only the fixed public Safe Online Exam GHCR repository or an Artifact Registry repository, and it rejects non-digest references. Preserve the existing source-based `cloudbuild-dev.yaml`, `cloudbuild-prod.yaml`, and `cloudbuild-school.yaml` workflows for development and deployments that intentionally build the checked-out source.

After promotion, inspect the migration execution and confirm the Cloud Run job and service image references, then run the release smoke checks below. Promote to development first when validating a new release process.

### Development Database Reset

The repository includes a guarded development-only reset command for cases that require a completely fresh installation state:

```bash
npm run db:reset:gcloud:dev -- --project "$PROJECT_ID"
```

It targets the maintained dev Cloud SQL database, requires interactive confirmation, drops and recreates the entire database, and reapplies migrations. It permanently removes dev assessment settings, course settings, administrator course connections, tool presets and rollout state, OAuth tokens, sessions, transient state, and locks. Never use it against production, never place it in CI or a scheduler, and take an on-demand backup first when the current dev state might be needed.

## Mode 2: Docker Compose / Budget VM Alternative

This mode is suitable for any provider that supplies a persistent Linux host or equivalent Docker environment. The checked-in Compose topology includes the application, PostgreSQL, migration job, cleanup job, and named data volume. You operate DNS, TLS, host security, backups, monitoring, and upgrades.

### 1. Prepare The Host

Use a supported Linux distribution with current security updates, Docker Engine, the Docker Compose v2 plugin, and `age` or another approved backup-encryption tool. Allocate enough memory and disk for the application containers and PostgreSQL. Configure:

- a stable DNS name pointing to the host;
- inbound TCP 80 and 443 for certificate issuance and HTTPS;
- SSH only from trusted administrative networks;
- no public PostgreSQL port; and
- encrypted disks, automatic security updates, time synchronization, and off-host monitoring.

Download a versioned Compose bundle from the intended GitHub Release and verify Docker. Do not use `latest` for a production installation:

```bash
docker version
docker compose version
export VERSION="X.Y.Z"
curl -fL -O "https://github.com/JSB2010/safe-online-exam/releases/download/v${VERSION}/safe-online-exam-${VERSION}-compose.tar.gz"
tar -xzf "safe-online-exam-${VERSION}-compose.tar.gz"
cd "safe-online-exam-${VERSION}"
```

The downloaded `.env.compose.secrets.example` already contains the exact release digest. Confirm it matches the release notes before continuing.

### 2. Select The Released Image

The standard self-hosted path pulls the digest that ships in the bundle:

```bash
export APP_IMAGE="$(sed -n 's/^APP_IMAGE=//p' .env.compose.secrets.example)"
docker pull "$APP_IMAGE"
```

The same image runs the application, migrations, cleanup, and bootstrap LTI-key generator. Do not use an unpinned moving tag for production.

### 3. Generate Keys And Prepare Secrets

Use the mounted-file variant so application secrets are not stored as direct Compose environment values. The release bundle's helper creates a protected secrets directory and puts the matching SEB private identity under `.local/`, which is intentionally outside the runtime:

```bash
umask 077
cp .env.compose.secrets.example .env.secrets
chmod 600 .env.secrets
APP_IMAGE="$APP_IMAGE" ./bootstrap-secrets.sh
printf '%s' 'your-canvas-api-client-secret' >secrets/canvas_api_client_secret
```

The secrets directory is mode `0700`; the files are container-readable inside that protected directory. Move `.local/seb-client-identity/` (the `.p12`, private key, and passphrase) out of the host application directory and into the approved client-deployment vault. The server receives only `secrets/seb-config-encryption.crt.pem`.

Edit `.env.secrets` and set at least:

- `APP_IMAGE` to the exact tag or digest selected above;
- `TOOL_URL` to the final HTTPS origin;
- `CANVAS_DOMAIN` and the exact OAuth callback;
- `LTI_CLIENT_ID` and `LTI_DEPLOYMENT_ID`, or `bootstrap-pending` for both during the first-pass dynamic-registration bootstrap;
- `CANVAS_API_CLIENT_ID`;
- `DATABASE_NAME=canvas_seb` and `DATABASE_USER=canvas_seb`; and
- `APP_ENV=prod`, `NODE_ENV=production`, and the hardened defaults already present.

For a first installation, point DNS at the host, choose the final HTTPS `TOOL_URL`, and create the Canvas API Developer Key for its callback. Use `bootstrap-pending` for both LTI IDs until the first public application pass is available. [Canvas setup](canvas-setup.md) lists the exact Canvas fields.

### 4. Validate And Start

Inspect the resolved Compose configuration without printing it into tickets or logs:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  config --quiet
```

Start PostgreSQL, run the one-shot migration service, and wait for application readiness:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  up --detach --wait

docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  ps

curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
```

The topology has four roles:

- `postgres`: PostgreSQL 17 with the persistent `postgres_data` volume and no published port.
- `migrate`: the one-shot checked migration set; `app` waits for it to succeed.
- `app`: the nonroot production image, bound to `127.0.0.1` by default.
- `cleanup`: an opt-in maintenance service for expired runtime state.

### 5. Add HTTPS With A TLS Reverse Proxy

Keep the application on loopback and terminate TLS with Caddy, nginx, Traefik, or the provider's managed ingress. For the optional Caddy profile included in the release bundle, set `PUBLIC_HOST` in `.env.secrets`, open inbound TCP 80/443 and UDP 443, then start the stack with `compose.caddy.yaml`:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  -f compose.caddy.yaml \
  --profile caddy up --detach --wait
```

The default stack remains loopback-only so it can run behind an existing Caddy, nginx, Traefik, load balancer, or container-platform ingress. For Caddy installed on the host instead, use:

```caddyfile
seb.example.edu {
  reverse_proxy 127.0.0.1:8080
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
}
```

Set `TOOL_URL=https://seb.example.edu` and `CANVAS_REDIRECT_URI=https://seb.example.edu/api/oauth2callback`. Reload the proxy, restart the app after any environment change, and verify the public origin:

```bash
curl -fsS https://seb.example.edu/health
curl -fsS https://seb.example.edu/ready
curl -fsS https://seb.example.edu/.well-known/jwks.json
curl -fsS https://seb.example.edu/lti/config
curl -fsS https://seb.example.edu/js/canvas-seb-detector.js | head
curl -fsS https://seb.example.edu/js/canvas-seb-theme-loader.js | head
```

Do not expose port 8080 directly, publish port 5432, or use a public HTTP `TOOL_URL`.

For the first installation, now use the public `${TOOL_URL}/lti/config` document to create and install the LTI Developer Key. Replace the two `bootstrap-pending` values in `.env.secrets` with the actual client and deployment IDs, then recreate the application through the full dependency gate:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  up --detach --wait
```

Complete the detector theme-loader and acceptance steps in [Canvas setup](canvas-setup.md).

### 6. Schedule Cleanup

Run cleanup at least daily. A root-owned systemd timer is preferred; cron is acceptable on a simple host. Example root crontab entry, using absolute paths:

```cron
17 3 * * * cd /opt/safe-online-exam && /usr/bin/docker compose --env-file .env.secrets -f compose.yaml -f compose.secrets.yaml --profile maintenance run --rm cleanup >>/var/log/safe-online-exam-cleanup.log 2>&1
```

Test the exact command interactively first:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  --profile maintenance run --rm cleanup
```

Protect and rotate the cleanup log, and alert when the scheduled command fails or stops running.

### 7. Encrypted Backups And Restore Drills

The Compose database has no host port, so run `pg_dump` inside the PostgreSQL container. PostgreSQL custom dump format is compressed but **not encrypted**. Pipe it immediately into the organization's approved encryption tool and copy the result off-host.

Example using `age` with a recovery recipient:

```bash
umask 077
mkdir -p backups
export AGE_RECIPIENT="age1REPLACE_WITH_RECOVERY_RECIPIENT"
export BACKUP_FILE="backups/canvas-seb-$(date -u +%Y%m%dT%H%M%SZ).dump.age"

docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  exec -T postgres \
  pg_dump --username=canvas_seb --dbname=canvas_seb \
    --format=custom --no-owner --no-acl \
  | age --recipient "$AGE_RECIPIENT" >"$BACKUP_FILE"
```

Verify the encrypted file exists and transfer it to access-controlled off-host storage. Do not treat a raw volume copy taken while PostgreSQL is running as a verified database backup.

Restore only into a new drill database first:

```bash
docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  exec -T postgres \
  createdb --username=canvas_seb canvas_seb_restore_drill

age --decrypt --identity /secure/path/to/age-identity.txt "$BACKUP_FILE" \
  | docker compose \
      --env-file .env.secrets \
      -f compose.yaml \
      -f compose.secrets.yaml \
      exec -T postgres \
      pg_restore --username=canvas_seb \
        --dbname=canvas_seb_restore_drill \
        --exit-on-error --no-owner --no-acl

docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  run --rm \
  -e DATABASE_NAME=canvas_seb_restore_drill \
  migrate
```

Inspect the eight application/runtime tables plus `schema_migrations`, and exercise a non-production LTI, administrator-dashboard, and assessment smoke flow against an isolated application instance. Record recovery time and the newest restored row timestamp. Drop the drill database only after the result is approved. A backup that has not passed a restore drill is not verified.

### 8. Upgrade

Download the next release bundle, confirm its exact digest, copy the protected `.env.secrets` and `secrets/` directory into it, update only the selected `APP_IMAGE` and `APP_ASSET_VERSION`, take a backup, and start the full topology. Compose recreates the migration service for the new image and keeps the application behind its successful completion condition:

```bash
docker pull ghcr.io/jsb2010/safe-online-exam@sha256:REPLACE_WITH_NEW_RELEASE_DIGEST
# Edit APP_IMAGE in .env.secrets to that exact digest.

docker compose \
  --env-file .env.secrets \
  -f compose.yaml \
  -f compose.secrets.yaml \
  up --detach --wait
```

Confirm `/ready`, inspect `docker compose ps`, and complete the release smoke checks. Migration checksum validation fails if an applied migration was edited; add a new forward migration instead.

### 9. Rollback And Host Recovery

Before changing `APP_IMAGE` back, confirm that the older application supports the current schema. Then restore the prior immutable image reference and run the same `up --detach --wait` command. This rolls back the application only; it does not undo database changes.

For host loss, restore encrypted backups onto a clean host, recreate protected environment/secret files from the secret vault, apply migrations with the intended image, and verify `/ready` before changing DNS or traffic. Monitor disk space, certificate expiry, container health, backup age, cleanup age, PostgreSQL connections, and host security updates.

## PostgreSQL Pool Sizing

`DATABASE_POOL_MAX` is per application process. Reserve connections for migrations, cleanup, administration, monitoring, and restore work:

```text
(maximum app instances x DATABASE_POOL_MAX) + job/admin reserve < database max_connections
```

The checked-in Cloud Run configs use a pool maximum of 5. Production's ten app instances therefore use at most 50 application connections before the job and administrative reserve. Recalculate before changing either setting.

## Incident Response

For a bad release, stop promotion, preserve logs and database state, then decide whether the failure is application-only or schema/data-affecting. Route traffic to a previous revision or image only when its schema contract is compatible. Otherwise ship a reviewed forward correction or restore into a controlled target.

For a secret or certificate incident, pause affected assessments, rotate only the affected material, deploy pinned new versions, distribute any replacement managed-client identity, invalidate affected settings through the normal workflow, and require fresh `.seb` downloads. Do not enable production debug mode, widen URL filters, or place client private identities in the server runtime. If certificate encryption is intentionally disabled for an unmanaged-device instance, document that exception and require start passwords where configuration confidentiality is needed.

## Official Google Cloud References

- [Deploying Cloud Run with Cloud Build](https://cloud.google.com/build/docs/deploying-builds/deploy-cloud-run)
- [Cloud Run secrets](https://cloud.google.com/run/docs/configuring/services/secrets)
- [Cloud SQL for PostgreSQL instances](https://cloud.google.com/sql/docs/postgres/create-instance)
- [Cloud SQL backups and restore](https://cloud.google.com/sql/docs/postgres/backup-recovery/restore)
- [Scheduling Cloud Run jobs](https://cloud.google.com/run/docs/execute/jobs-on-schedule)
