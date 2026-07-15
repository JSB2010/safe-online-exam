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

Cloud Build pulls the previous image and passes it as `--cache-from` before building. The Dockerfile then prunes dev dependencies and emits a distroless Node 24 runtime image that starts `dist/server/server/main.js` through the image's Node entrypoint. Every build also pushes a build-unique `$BUILD_ID` tag. `scripts/push-image-capture-digest.sh` captures the registry digest returned by that exact push into a mode-0600 build artifact; `scripts/deploy-cloud-run-digest.sh` accepts only that digest artifact and passes the immutable `repository@sha256:...` reference to Cloud Run. It never resolves the mutable tag after the push.

The server build copies `src/server/assets` and creates `canvas-seb-detector.min.js`. When `APP_DEBUG_ENABLED` is true, the public detector URL serves the readable script with `no-store` headers. When `APP_DEBUG_ENABLED` is false, the same public URL serves the minified script with revalidation-required `no-cache` headers so detector security updates are not held behind a stale browser or Canvas cache.

## Cloud Run Invoker IAM

Canvas launches the LTI app through public Cloud Run URLs, so each service needs an `allUsers` binding for `roles/run.invoker`.

The dev, production, and school Cloud Build configs pass `--allow-unauthenticated`. After each deployment, verify that the public invoker binding still exists and that an unauthenticated health request succeeds. If a service is recreated or its binding is removed, restore it with the environment's service name:

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
- `dev_lti_deployment_id`
- `dev_tool_url`
- `dev_lti_private_key`
- `dev_session_secret` mounted as `SESSION_SECRET`
- `dev_state_encryption_key`
- `dev_api_client_id`
- `dev_api_client_secret`
- `dev_seb_config_encryption_cert_pem`

Maintained prod expects:

- `prod_canvas_domain`
- `prod_lti_client_id`
- `prod_lti_deployment_id`
- `prod_tool_url`
- `prod_lti_private_key`
- `prod_session_secret` mounted as `SESSION_SECRET`
- `prod_state_encryption_key`
- `prod_api_client_id`
- `prod_api_client_secret`
- `prod_seb_config_encryption_cert_pem`

`cloudbuild-school.yaml` expects a configurable prefix. With `_SECRET_PREFIX=school_canvas_seb`, create:

- `school_canvas_seb_canvas_domain`
- `school_canvas_seb_lti_client_id`
- `school_canvas_seb_lti_deployment_id`
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
- `LTI_DEPLOYMENT_ID`
- `TOOL_URL`
- `LTI_PRIVATE_KEY`
- `SESSION_SECRET`
- `STATE_ENCRYPTION_KEY`
- `CANVAS_API_CLIENT_ID`
- `CANVAS_API_CLIENT_SECRET`
- `SEB_CONFIG_ENCRYPTION_CERT_PEM`

`TOOL_URL` and `CANVAS_DOMAIN` must be bare HTTPS origins. Generate `SESSION_SECRET` and `STATE_ENCRYPTION_KEY` independently with at least 32 characters of cryptographically random material (the school deployment guide uses `openssl rand -base64 48`); Cloud Run startup rejects shorter values.

The remaining optional runtime variables can be set with `--set-env-vars` or added to `--set-secrets` if they are sensitive:

- `LTI_ISSUER`: defaults to `https://canvas.instructure.com`. Self-hosted issuers may include a path, but hardened startup requires HTTPS and rejects URL credentials, queries, and fragments.
- `LTI_KEY_SET_URL` and `LTI_AUTH_URL`: default to Canvas cloud's `sso.canvaslms.com` endpoints. Self-hosted endpoints may use a different host/path and an installation-specific query, but hardened startup requires HTTPS and rejects URL credentials and fragments.
- `CANVAS_REDIRECT_URI`: defaults to `${TOOL_URL}/api/oauth2callback` and must equal that exact URL on Cloud Run.
- `CANVAS_API_BASE_URL`: defaults to `${CANVAS_DOMAIN}/api/v1`. On Cloud Run it must remain that exact HTTPS origin and path so instructor bearer tokens cannot be sent to another host.
- `APP_DEBUG_ENABLED`: defaults false and must remain false on Cloud Run.
- `APP_DETECTOR_DIAGNOSTICS_ENABLED`: defaults false. When true on a non-production profile (for example the dev service), the Canvas detector posts sanitized trace details (page URLs, iframe origins, button summaries, redirect gate decisions) to `/api/debug/canvas-detector-trace`, and the endpoint records them to Cloud Logging under `CanvasSebDetectorTrace`. Startup validation rejects it when `APP_ENV` resolves to `prod`, so production and school deployments cannot enable it.
- `SEB_REQUIRED_DOMAINS`: school-reviewed concrete resource hostnames needed by every generated `.seb` config. Wildcards and identity-provider hosts are rejected.
- `SEB_QUIT_PASSWORD`: managed default quit password applied when a course or quiz does not supply one. Every enabled assessment must have an effective quit password from one of these sources. Hardened runtimes require 8–128 characters with at least five different letters or numbers. Letters-only and numbers-only values are allowed, while common, sequential, repetitive, low-diversity, and control-character values are rejected. Never reuse it as an exam start password. The managed value cannot be revealed through the instructor UI.
- `SEB_CONFIG_ENCRYPTION_ENABLED`: defaults `true` and must remain true on Cloud Run.

### Student Canvas Session Handoff

Before any student can use the tool, a Canvas root-account administrator must add `url:GET|/api/v1/login/session_token` to the same API OAuth Developer Key used by `CANVAS_API_CLIENT_ID`. Use the API procedure in [Canvas School Setup Guide](canvas-school-setup.md#required-student-canvas-session-handoff) when the scope is not present in Canvas's visual Developer Key editor.

There is no runtime feature flag. After the Developer Key update is verified and the service is deployed, a student’s first course-navigation launch opens **Connect Canvas**. The server stores the scoped OAuth credential server-side, and later launches use it to obtain a new short-lived Canvas session URL. A direct SEB-required assessment launch before connection resumes at that assessment's normal download screen after consent; the server derives that destination from the validated LTI session and never trusts a browser-provided return URL. Existing credentials from before this requirement are replaced by opening the tool again. If Canvas later revokes the credential or scope, a failed setup check and the connection screen provide an explicit reconnect action.

The setup check is recommended and skippable. Its result is not stored as a durable device-trust claim and it does not authorize a configuration download by itself.

The server stores the user-scoped OAuth credential and requests a fresh Canvas session URL only while it creates an SEB configuration. It never imports the student's Chrome cookie. For New Quizzes, Canvas may redirect from the stable assignment route to a student-specific attempt route; the deployed handoff verifier recognizes that route family while still validating the SEB Config Key for the exact destination URL.

## IAM

The maintained environments use separate runtime identities:

```text
seb-canvas-dev@$PROJECT_ID.iam.gserviceaccount.com
seb-canvas-prod@$PROJECT_ID.iam.gserviceaccount.com
```

Do not reuse either identity across environments. Portable deployments must pass an environment-specific `_SERVICE_ACCOUNT` to `cloudbuild-school.yaml`; separate Google Cloud projects for production and non-production are preferred.

Each runtime identity should receive only:

- Firestore access conditioned on its configured database resource.
- Secret Manager accessor on the exact secret resources mounted into that service.

The Cloud Run runtime identity does not pull the container image and therefore does not need Artifact Registry Reader. Cloud Build needs permission to build and push images, deploy Cloud Run, and act only as the intended runtime identity. Keep `roles/iam.serviceAccountUser` scoped to that service-account resource rather than granting it at project level.

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

The app deletes expired entries opportunistically while handling requests, but Firestore TTL keeps abandoned sessions, OAuth states, LTI replay claims, SEB proof tokens, and expired operation leases from accumulating. LTI state issuance itself is encrypted and self-contained; Firestore stores the atomic one-time claim made by the callback, rather than a prerequisite state record.

Do not set `USE_IN_MEMORY_STORE=true` in production or on Cloud Run. Hardened startup refuses the in-memory repository for either runtime, even if a legacy environment alias is present. Hardened runtimes also require `SESSION_SECRET` itself; `ADMIN_PASSWORD` is retained only for local-development compatibility.

### Legacy New Quiz Metadata Cleanup

Earlier releases stored the complete Canvas New Quiz API response in `assessments.canvas.metadata`. That response can contain the Canvas student access code. Deploy the release that no longer writes or returns raw metadata before running this cleanup, and make sure no older Cloud Run revision is still receiving traffic.

The maintenance command requires an explicit project and database and is read-only by default. It selects only `NEW_QUIZ` assessment records and the legacy nested field, never prints document IDs or contents, and reports aggregate counts:

```bash
GCP_PROJECT_ID=YOUR_PROJECT \
FIRESTORE_DATABASE_ID=YOUR_DATABASE \
npm run security:purge-new-quiz-metadata
```

If the dry-run target and matched count are correct, apply the single-field deletion explicitly:

```bash
GCP_PROJECT_ID=YOUR_PROJECT \
FIRESTORE_DATABASE_ID=YOUR_DATABASE \
npm run security:purge-new-quiz-metadata -- --apply
```

Set `FIRESTORE_ASSESSMENTS_COLLECTION` as well when the deployment overrides the default `assessments` collection. The apply mode uses Firestore's field-delete sentinel only for `canvas.metadata`; it does not delete assessment documents or modify their SEB settings.

This cleanup is not application-layer encryption. Firestore platform encryption and resource-scoped IAM remain the current protection for Canvas OAuth tokens, sessions, access codes, and start/quit passwords. Versioned Cloud KMS envelope encryption, ciphertext migration, and key-rotation procedures are separate future hardening work and should use a dedicated key rather than reusing `STATE_ENCRYPTION_KEY` or `SESSION_SECRET`.

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
4. Refreshing a course lists Classic Quizzes and New Quizzes and writes their authoritative Canvas verification state. After first deploying the verification gate, refresh every active course before admitting students; legacy unverified records intentionally cannot mint config grants. Repeat the refresh within 24 hours of learner admission and after any Canvas publication, availability, deletion, or assignment change.
5. Enabling SEB applies course defaults and sets the Canvas access code.
6. A student launch shows only SEB-enabled assessments that the last complete Canvas discovery found published and inside their global availability window.
7. Downloading a `.seb` file does not store a replayable Config Key; proof verification deterministically computes the expected key from the current inner settings.
8. If an exam start password is configured, SEB prompts for it before opening Canvas.
9. SEB can retrieve the access code through the proof flow.
10. A New Quiz config starts from `/courses/:courseId/assignments/:assignmentId` and Canvas creates or resumes its `/taking/:attemptId` route.
11. The first New Quiz Submit control opens Canvas's confirmation dialog without leaving the quiz; only explicit confirmation plus Canvas's authoritative results UI can open the SEB exit page.
12. Ambient page text, URL changes, and ordinary form submissions do not exit the assessment, and the exit page requires the user to choose the quit action explicitly.

## SEB Config Encryption

Certificate encryption is mandatory on Cloud Run. The app encrypts generated `.seb` downloads with the configured public certificate using SEB macOS-compatible `pkhs` format, while Config Keys are still computed from the inner settings before encryption. Instructor-configured exam start passwords add SEB `pswd` password encryption inside the certificate wrapper and rotate SEB's native `configKeySalt`.

For local testing:

```bash
umask 077
mkdir -p .local
openssl rand -base64 48 > .local/seb-cert-p12-password
bash scripts/generate-seb-config-cert.sh .local/seb-certs .local/seb-cert-p12-password
```

Then set:

```text
SEB_CONFIG_ENCRYPTION_ENABLED=true
SEB_CONFIG_ENCRYPTION_CERT_PATH=.local/seb-certs/seb-config-encryption-local.crt.pem
```

The password file and generated `.p12` are private. Do not place their contents in environment variables or command arguments. Install the identity on a test device through the same MDM Certificates payload used for production, configured as non-extractable and restricted from unrelated apps, or use an authorized technician workflow. After deployment, students should run the LTI setup check before any real exam. See [seb-certificate-runbook.md](seb-certificate-runbook.md) for managed rollout, private-key storage, and rotation.

For Cloud Run, store the public certificate PEM in Secret Manager and inject it as `SEB_CONFIG_ENCRYPTION_CERT_PEM`, or mount/provide a file path through `SEB_CONFIG_ENCRYPTION_CERT_PATH`. Distribute the matching identity through an MDM Certificates payload with `KeyIsExtractable=false` and `AllowAllAppsAccess=false`. Do not deploy the private key or `.p12` to Cloud Run, serve it from this app, or use the retired `scripts/install-seb-config-cert-login-keychain.sh` secret importer. There is no supported plaintext or public-key-only fallback for a deployed service; startup fails closed if encryption is disabled or a validity-checked X.509 certificate is unavailable.

## Exit Password Safety and Recovery

An assessment cannot be enabled and an assessment `.seb` file cannot be generated unless a nonempty quiz/course exit password or `SEB_QUIT_PASSWORD` is effective. Assessment configs keep automatic quit URLs disabled; the setup-check config is the only passwordless quit exception.

Before deploying this policy over existing data, replace any course, quiz, or managed start/exit password shorter than 8 characters, based on common test terms or sequences, or reused for both start and exit. Existing weak values are not silently rewritten: affected assessment config generation fails closed until an instructor enters distinct compliant replacements, which also invalidates the old Config Key and requires a fresh config download. Saved course and assessment values can be revealed only through the explicit instructor-only, no-store reveal action; managed server defaults remain non-retrievable.

If an exit password is lost, do not add a passwordless or remotely triggered quit route. Disable SEB for the affected assessments first, set a replacement course or managed server password, re-enable the assessments, and have students reopen them from Canvas so they receive fresh configs. The service rejects clearing a course password while an enabled assessment would be left without a protected native quit path.

## Rollback

Cloud Run keeps previous revisions. If a deploy has to be rolled back:

```bash
gcloud run revisions list --service=SERVICE_NAME --region=us-central1
gcloud run services update-traffic SERVICE_NAME --region=us-central1 --to-revisions=REVISION_NAME=100
```

## Deployment Records

Environment-specific deployment evidence is recorded separately from this standing runbook:

- [Dev security-hardening deployment — 2026-07-13](deployments/2026-07-13-dev-security-hardening.md)
- [Dev Canvas OAuth identity fix — 2026-07-13](deployments/2026-07-13-dev-canvas-oauth-identity-fix.md)
- [Dev SEB launch, password, and SSO fix — 2026-07-13](deployments/2026-07-13-dev-seb-launch-password-sso-fix.md)
