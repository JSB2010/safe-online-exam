# Deployment

## Existing Cloud Run Targets

The rewrite keeps the existing Cloud Run service names and Firestore database IDs.

| Environment | Cloud Run service | Region        | Firestore database   |
| ----------- | ----------------- | ------------- | -------------------- |
| Dev         | `canvas-seb-dev`  | `us-central1` | `seb-canvaslti-dev`  |
| Prod        | `canvas-seb-prod` | `us-central1` | `seb-canvaslti-prod` |

Canvas LTI developer keys should continue pointing to the existing Cloud Run URLs. Do not create a new service URL unless Canvas is updated to match it.

## Build and Deploy

Dev:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
```

Prod:

```bash
gcloud builds submit --config=cloudbuild-prod.yaml
```

Both Cloud Build configs build the Docker image. The Dockerfile runs the deployment CI gate inside Docker:

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
```

Cloud Build pulls the previous image and passes it as `--cache-from` before building. The Dockerfile then prunes dev dependencies and emits a Node 22 runtime image that starts `node dist/server/server/main.js`.

The server build also copies `src/server/assets` and creates `canvas-seb-detector.min.js`. When `APP_DEBUG_ENABLED` is true, the public detector URL serves the readable script with `no-store` headers. When `APP_DEBUG_ENABLED` is false, the same public URL serves the minified script with a one-hour public cache and `stale-while-revalidate`.

## Cloud Run Invoker IAM

Canvas launches the LTI app through public Cloud Run URLs, so each Cloud Run service needs an `allUsers` binding for `roles/run.invoker`.

The dev service already has this binding. `cloudbuild-dev.yaml` intentionally does not pass `--allow-unauthenticated`; this avoids requiring the Cloud Build service account to mutate Cloud Run IAM on every deploy and prevents non-blocking `Setting IAM Policy` warnings. If the dev service is ever recreated, restore the binding once:

```bash
gcloud run services add-iam-policy-binding canvas-seb-dev \
  --region=us-central1 \
  --member=allUsers \
  --role=roles/run.invoker
```

## Required Secret Manager Secrets

Dev deployment expects:

- `dev_lti_client_id`
- `dev_tool_url`
- `dev_lti_private_key`
- `dev_admin_password`
- `dev_api_client_id`
- `dev_api_client_secret`
- `dev_seb_config_encryption_cert_pem`

Prod deployment expects:

- `prod_lti_client_id`
- `prod_tool_url`
- `prod_lti_private_key`
- `prod_admin_password`
- `prod_state_encryption_key`
- `prod_api_client_id`
- `prod_api_client_secret`
- `prod_seb_config_encryption_cert_pem`

Secret values are mounted as environment variables:

- `LTI_CLIENT_ID`
- `TOOL_URL`
- `LTI_PRIVATE_KEY`
- `ADMIN_PASSWORD`
- `STATE_ENCRYPTION_KEY` in prod
- `CANVAS_API_CLIENT_ID`
- `CANVAS_API_CLIENT_SECRET`
- `SEB_CONFIG_ENCRYPTION_CERT_PEM` or `SEB_CONFIG_ENCRYPTION_CERT_PATH` when certificate-encrypted `.seb` downloads are enabled

## IAM

The Cloud Run service account remains:

```text
seb-canvas@$PROJECT_ID.iam.gserviceaccount.com
```

It needs access to:

- Firestore for the configured database.
- Secret Manager accessor for deployment-injected secrets.
- Artifact Registry read access for deployed images.

## Canvas URLs

Use the Cloud Run `TOOL_URL` value for Canvas LTI settings:

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
10. The exit page renders and the quit link works in SEB.

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

Import the generated `.p12` into the macOS login keychain on the test machine before opening encrypted configs in SEB. The generated script prints a `security import` command. The `.p12` contains the private key and should be handled like a secret. See [seb-certificate-runbook.md](seb-certificate-runbook.md) for Jamf rollout, BYOD install, private-key storage, and rotation.

For Cloud Run, store the public certificate PEM in Secret Manager and inject it as `SEB_CONFIG_ENCRYPTION_CERT_PEM`, or mount/provide a file path through `SEB_CONFIG_ENCRYPTION_CERT_PATH`. Distribute the matching `.p12` identity through Jamf or another managed channel. Do not deploy the private key or `.p12` to Cloud Run, and do not serve the `.p12` from this app.

To disable certificate wrapping entirely:

```text
SEB_CONFIG_ENCRYPTION_ENABLED=false
```

In that mode, configs without an exam start password return plaintext plist `.seb` files and rely on strict Config Key validation for tamper detection. Configs with an exam start password are still password-encrypted in SEB `pswd` format.

## Rollback

Cloud Run keeps previous revisions. If a deploy has to be rolled back:

```bash
gcloud run revisions list --service=canvas-seb-prod --region=us-central1
gcloud run services update-traffic canvas-seb-prod --region=us-central1 --to-revisions=REVISION_NAME=100
```

Use the same commands with `canvas-seb-dev` for dev.
