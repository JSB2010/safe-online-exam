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

Prod deployment expects:

- `prod_lti_client_id`
- `prod_tool_url`
- `prod_lti_private_key`
- `prod_admin_password`
- `prod_state_encryption_key`
- `prod_api_client_id`
- `prod_api_client_secret`

Secret values are mounted as environment variables:

- `LTI_CLIENT_ID`
- `TOOL_URL`
- `LTI_PRIVATE_KEY`
- `ADMIN_PASSWORD`
- `STATE_ENCRYPTION_KEY` in prod
- `CANVAS_API_CLIENT_ID`
- `CANVAS_API_CLIENT_SECRET`

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
- Deep linking URL: `${TOOL_URL}/lti/deeplink/select`

The detector script URL is:

```text
${TOOL_URL}/js/canvas-seb-detector.js
```

## Post-Deploy Checks

Run these checks after deployment:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
```

Then verify in Canvas:

1. LTI launch opens the instructor dashboard.
2. OAuth status prompts for Canvas authorization if no token exists.
3. First authorization for a course opens the setup wizard and saves default password, URL, and tool settings.
4. Refreshing a course lists Classic Quizzes and New Quizzes.
5. Enabling SEB applies course defaults, sets the Canvas access code, and rewrites a module item when one exists.
6. A student launch shows only SEB-enabled assessments with SEB launch buttons.
7. Downloading a `.seb` file stores a Config Key.
8. SEB can retrieve the access code through the proof flow.
9. The exit page renders and the quit link works in SEB.

## Rollback

Cloud Run keeps previous revisions. If a deploy has to be rolled back:

```bash
gcloud run revisions list --service=canvas-seb-prod --region=us-central1
gcloud run services update-traffic canvas-seb-prod --region=us-central1 --to-revisions=REVISION_NAME=100
```

Use the same commands with `canvas-seb-dev` for dev.
