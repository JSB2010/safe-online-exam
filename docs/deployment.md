# Deployment

## Maintained Cloud Run Targets

The repository keeps these maintained Cloud Run targets for the current deployment line:

| Environment | Cloud Run service | Region        | Firestore database   | Build config             |
| ----------- | ----------------- | ------------- | -------------------- | ------------------------ |
| Dev         | `canvas-seb-dev`  | `us-central1` | `seb-canvaslti-dev`  | `cloudbuild-dev.yaml`    |
| Prod        | `canvas-seb-prod` | `us-central1` | `seb-canvaslti-prod` | `cloudbuild-prod.yaml`   |
| New school  | configured by you | configured    | configured by you    | `cloudbuild-school.yaml` |

Do not change an existing Cloud Run service URL without also updating the matching Canvas LTI developer key, Canvas OAuth developer key, and detector script loader.

## Build And Deploy

Maintained dev:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
```

Maintained prod:

```bash
gcloud builds submit --config=cloudbuild-prod.yaml
```

Portable new-school deployment:

```bash
gcloud builds submit \
  --config=cloudbuild-school.yaml \
  --substitutions=_SERVICE=school-canvas-seb,_IMAGE=school-canvas-seb,_FIRESTORE_DATABASE_ID=school-canvas-seb,_SECRET_PREFIX=school_canvas_seb
```

All three Cloud Build configs build the Docker image. The Dockerfile runs the deploy gate inside Docker:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
```

Cloud Build pulls the previous image and passes it as `--cache-from` before building. The Dockerfile then prunes dev dependencies and emits a distroless Node 24 runtime image that starts `dist/server/server/main.js` through the image's Node entrypoint.

The server build copies `src/server/assets` and creates `canvas-seb-detector.min.js`. When `APP_DEBUG_ENABLED` is true, the public detector URL serves the readable script with `no-store` headers. When `APP_DEBUG_ENABLED` is false, the same public URL serves the minified script with a one-hour public cache and `stale-while-revalidate`.

## Cloud Run Invoker IAM

Canvas launches the LTI app through public Cloud Run URLs, so each service needs an `allUsers` binding for `roles/run.invoker`.

`cloudbuild-prod.yaml` and `cloudbuild-school.yaml` pass `--allow-unauthenticated`. `cloudbuild-dev.yaml` intentionally does not; the maintained dev service keeps its public invoker binding outside deploys to avoid IAM churn. If dev is recreated, restore the binding once:

```bash
gcloud run services add-iam-policy-binding canvas-seb-dev \
  --region=us-central1 \
  --member=allUsers \
  --role=roles/run.invoker
```

## Required Secret Manager Secrets

Cloud Run injects school-specific values through `--set-secrets`. The app refuses to start on Cloud Run if the required values are missing.

Maintained dev expects these secret names:

- `dev_canvas_domain`
- `dev_lti_client_id`
- `dev_tool_url`
- `dev_lti_private_key`
- `dev_admin_password` mounted as `SESSION_SECRET`
- `dev_state_encryption_key`
- `dev_api_client_id`
- `dev_api_client_secret`
- `dev_seb_config_encryption_cert_pem`

Maintained prod expects:

- `prod_canvas_domain`
- `prod_lti_client_id`
- `prod_tool_url`
- `prod_lti_private_key`
- `prod_admin_password` mounted as `SESSION_SECRET`
- `prod_state_encryption_key`
- `prod_api_client_id`
- `prod_api_client_secret`
- `prod_seb_config_encryption_cert_pem`

`cloudbuild-school.yaml` expects a configurable prefix. With `_SECRET_PREFIX=school_canvas_seb`, create:

- `school_canvas_seb_canvas_domain`
- `school_canvas_seb_lti_client_id`
- `school_canvas_seb_tool_url`
- `school_canvas_seb_lti_private_key`
- `school_canvas_seb_session_secret`
- `school_canvas_seb_state_encryption_key`
- `school_canvas_seb_api_client_id`
- `school_canvas_seb_api_client_secret`
- `school_canvas_seb_seb_config_encryption_cert_pem`

These secrets mount to canonical runtime variables:

- `CANVAS_DOMAIN`
- `LTI_CLIENT_ID`
- `TOOL_URL`
- `LTI_PRIVATE_KEY`
- `SESSION_SECRET`
- `STATE_ENCRYPTION_KEY`
- `CANVAS_API_CLIENT_ID`
- `CANVAS_API_CLIENT_SECRET`
- `SEB_CONFIG_ENCRYPTION_CERT_PEM`

Optional runtime variables can be set with `--set-env-vars` or added to `--set-secrets` if they are sensitive:

- `LTI_DEPLOYMENT_ID`: one deployment ID, or comma/newline-separated IDs. When set, LTI launches from other Canvas deployment IDs are rejected.
- `CANVAS_REDIRECT_URI`: defaults to `${TOOL_URL}/api/oauth2callback`.
- `CANVAS_API_BASE_URL`: defaults to `${CANVAS_DOMAIN}/api/v1`.
- `APP_DEBUG_ENABLED`: defaults true outside prod and false in prod.
- `SEB_REQUIRED_DOMAINS`: school-wide additional domains needed by every generated `.seb` config.
- `SEB_QUIT_PASSWORD`: default quit password applied when a course/quiz does not override it.
- `SEB_CONFIG_ENCRYPTION_ENABLED`: defaults `true`; set `false` only for an explicit no-certificate rollout.

## IAM

The maintained services use this service account name:

```text
seb-canvas@$PROJECT_ID.iam.gserviceaccount.com
```

Portable deployments can use the same name or pass `_SERVICE_ACCOUNT=your-service-account` to `cloudbuild-school.yaml`.

The service account needs:

- Firestore access for the configured database.
- Secret Manager accessor for deployment-injected secrets.
- Artifact Registry read access for deployed images.

Cloud Build also needs permission to build and push images, deploy Cloud Run, and act as the runtime service account.

## Firestore Runtime State

Default collections:

- `assessments`
- `courses`
- `canvasOAuthTokens`
- `sessions`
- `transientStates`
- `operationLocks`

Create Firestore TTL policies on the `expiresAt` field for:

- `sessions`
- `transientStates`
- `operationLocks`

The app deletes expired entries opportunistically while handling requests, but Firestore TTL keeps abandoned sessions, OIDC/OAuth states, SEB proof tokens, and expired operation leases from accumulating.

Do not set `USE_IN_MEMORY_STORE=true` on Cloud Run. The service refuses to start with the in-memory repository when `K_SERVICE` is present.

## Canvas URLs

Use the Cloud Run `TOOL_URL` value for Canvas LTI and OAuth settings:

- OIDC initiation URL: `${TOOL_URL}/lti/login`
- Target link URI: `${TOOL_URL}/lti/launch`
- JWKS URL: `${TOOL_URL}/.well-known/jwks.json`
- OAuth redirect URI: `${TOOL_URL}/api/oauth2callback`

The detector script URL is:

```text
${TOOL_URL}/js/canvas-seb-detector.js
```

## Post-Deploy Checks

Run these checks after deployment:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsSI "${TOOL_URL}/js/canvas-seb-detector.js"
curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
```

Then verify in Canvas:

1. LTI launch opens the instructor dashboard.
2. OAuth status prompts for Canvas authorization if no token exists.
3. First authorization for a course opens the setup wizard and saves default password, URL, and tool settings.
4. Refreshing a course lists Classic Quizzes and New Quizzes.
5. Enabling SEB applies course defaults and sets the Canvas access code.
6. A student launch shows only SEB-enabled assessments with SEB launch buttons.
7. Downloading a `.seb` file stores a Config Key.
8. If an exam start password is configured, SEB prompts for it before opening Canvas.
9. SEB can retrieve the access code through the proof flow.
10. A New Quiz config starts from `/courses/:courseId/assignments/:assignmentId` and Canvas creates or resumes its `/taking/:attemptId` route.
11. The first New Quiz Submit control opens Canvas's confirmation dialog without leaving the quiz; the confirmed submission reaches Canvas results before the SEB exit page opens.
12. The exit page renders and the quit link works in SEB.

## SEB Config Encryption

Certificate encryption is enabled by default. The app encrypts generated `.seb` downloads with the configured public certificate using SEB macOS-compatible `pkhs` format, while Config Keys are still computed from the plaintext settings before encryption. Instructor-configured exam start passwords add SEB `pswd` password encryption inside the certificate wrapper and rotate SEB's native `configKeySalt`.

For local testing:

```bash
bash scripts/generate-seb-config-cert.sh
```

Then set:

```text
SEB_CONFIG_ENCRYPTION_ENABLED=true
SEB_CONFIG_ENCRYPTION_CERT_PATH=.local/seb-certs/seb-config-encryption-local.crt.pem
```

Import the generated `.p12` into the macOS login keychain on the test machine before opening encrypted configs in SEB. The generated script prints a `security import` command. The `.p12` contains the private key and should be handled like a secret. After deployment, students should run the LTI setup check before any real exam; it opens an encrypted setup-only `.seb` file and gives macOS a low-stakes place to show the one-time Keychain `Always Allow` prompt. See [seb-certificate-runbook.md](seb-certificate-runbook.md) for Jamf rollout, BYOD install, private-key storage, and rotation.

For Cloud Run, store the public certificate PEM in Secret Manager and inject it as `SEB_CONFIG_ENCRYPTION_CERT_PEM`, or mount/provide a file path through `SEB_CONFIG_ENCRYPTION_CERT_PATH`. Distribute the matching `.p12` identity through Jamf or another managed channel. Do not deploy the private key or `.p12` to Cloud Run, and do not serve the `.p12` from this app.

To disable certificate wrapping entirely:

```text
SEB_CONFIG_ENCRYPTION_ENABLED=false
```

In that mode, configs without an exam start password return plaintext plist `.seb` files and rely on strict Config Key validation for tamper detection. Configs with an exam start password are still password-encrypted in SEB `pswd` format.

## Rollback

Cloud Run keeps previous revisions. If a deploy has to be rolled back:

```bash
gcloud run revisions list --service=SERVICE_NAME --region=us-central1
gcloud run services update-traffic SERVICE_NAME --region=us-central1 --to-revisions=REVISION_NAME=100
```
