# Deployment And Operations

This guide deploys Canvas Safe Exam Browser LTI to Google Cloud Run with Firestore. It is deliberately environment-neutral: select service names, URLs, database IDs, secret names, and service accounts that are unique to the Canvas tenant and environment being deployed.

Read [Configuration](configuration.md) before provisioning. Read [Canvas setup](canvas-setup.md) before enabling a Canvas registration. A deployment must be public to Canvas for LTI browser launches, while its runtime data and secrets remain private to its service account.

## Deployment Model

- One Cloud Run service connects to one Canvas origin and a configured LTI deployment allowlist.
- Firestore is the durable application store and the shared runtime-state store. The service does not require sticky sessions.
- Secret Manager supplies LTI/OAuth keys, session/state secrets, and the public configuration-encryption certificate.
- Artifact Registry stores immutable container images.
- Cloud Build builds, verifies, pushes, captures an exact image digest, and deploys that digest.

The repository includes maintained environment configs `cloudbuild-dev.yaml` and `cloudbuild-prod.yaml`, plus the parameterized `cloudbuild-school.yaml` template. The filenames are repository contracts; customize substitutions and secret names for a new deployment instead of sharing another environment’s values.

## Provisioning Checklist

Before the first release, create or select:

1. A Google Cloud project with Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and Firestore enabled.
2. An Artifact Registry Docker repository in the desired region.
3. A Firestore database dedicated to this deployment environment.
4. A Cloud Run runtime service account dedicated to this service/environment.
5. A Cloud Build identity that can build/push the image and update the intended Cloud Run service.
6. A public HTTPS service URL or a temporary valid HTTPS placeholder for a bootstrap deployment.
7. A configuration-encryption public certificate and a managed-client plan for its matching private identity.

Use a separate project or a separate database, service account, secret prefix, and service URL whenever environment isolation matters. Never point an isolated environment at a different environment’s Firestore database or secrets.

## Least-Privilege IAM

Give the Cloud Run runtime service account only the resources the service uses:

- Firestore access conditioned on its configured database resource, not a broad unrelated-database grant.
- Secret Manager Secret Accessor on the exact secret resources injected into this service, not project-wide secret access.
- No client private-key identity access. The runtime needs only the public certificate secret.

The runtime service account does not need Artifact Registry reader when the deployment platform performs image retrieval on its behalf. Keep build, deploy, runtime, and human-administration identities distinct where practical.

Cloud Run must allow unauthenticated invocation because Canvas users’ browsers initiate LTI navigation. This is public reachability for the service endpoints, not permission to bypass LTI/session/proof checks. After deployment, verify the `allUsers` `roles/run.invoker` binding and check `/health` without Cloud credentials.

## Create Runtime Inputs

Create secrets for the canonical configuration variables:

```text
CANVAS_DOMAIN
TOOL_URL
LTI_CLIENT_ID
LTI_DEPLOYMENT_ID
LTI_PRIVATE_KEY
SESSION_SECRET
STATE_ENCRYPTION_KEY
CANVAS_API_CLIENT_ID
CANVAS_API_CLIENT_SECRET
SEB_CONFIG_ENCRYPTION_CERT_PEM
```

Use 32+ character independent random values for `SESSION_SECRET` and `STATE_ENCRYPTION_KEY`, for example:

```bash
openssl rand -base64 48
```

Generate an LTI private JWK through the repository command, then store the JSON only in the secret manager:

```bash
npm run generate:lti-key
```

Generate the configuration-encryption identity as described in [Certificate management](certificate-management.md). Store only its public certificate value in the runtime secret set.

For a two-phase bootstrap using a generated Cloud Run URL, set `TOOL_URL` to a valid temporary HTTPS origin, deploy once, obtain the service URL, then create the real Canvas registrations, update the URL/client/deployment secrets, and deploy again. Do not test Canvas LTI or conduct assessments against the bootstrap revision.

## Build Pipeline

The `Dockerfile` is the deployment quality gate. Its stages are:

1. `deps`: install the pinned npm version and run `npm ci`.
2. `verify`: run typecheck, lint, formatting check, coverage tests, and the production build.
3. `production-deps`: prune development dependencies.
4. `runtime`: assemble a nonroot distroless Node.js 24 image with only built output, production modules, and package metadata.

Cloud Build pulls the previous `latest` image as a cache source, builds a unique `$BUILD_ID` image, pushes it, records the returned `sha256` digest, and deploys that immutable digest. It then updates the cache tag. It does not repeat npm work outside Docker.

Playwright is intentionally not part of the deploy build because browser installation materially changes deployment time. Run `npm run test:e2e` as a local, pull-request, or scheduled verification step.

## Deploy

For the maintained service configurations, run one of:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
gcloud builds submit --config=cloudbuild-prod.yaml
```

The parameterized template accepts substitutions for location, repository, service, image, app profile, Firestore database, secret prefix, service account, and instance limits:

```bash
gcloud builds submit --config=cloudbuild-school.yaml \
  --substitutions=_LOCATION=us-central1,_REPOSITORY=REPOSITORY,_SERVICE=SERVICE,_IMAGE=IMAGE,_APP_ENV=prod,_FIRESTORE_DATABASE_ID=DATABASE,_SECRET_PREFIX=PREFIX,_SERVICE_ACCOUNT=SERVICE_ACCOUNT
```

Inspect the selected YAML before each first deployment to a new environment. The configuration must inject the canonical names from [Configuration](configuration.md), including `APP_DEBUG_ENABLED=false`, a real Firestore database, and an X.509 certificate secret.

## Firestore Lifecycle And TTL

Configure TTL policies on the `expiresAt` field for these collections:

| Collection        | Reason                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `sessions`        | Cleans up expired Express sessions.                                                                   |
| `transientStates` | Cleans up consumed/expired LTI state, OAuth state, grants, proofs, handoff records, and rate budgets. |
| `operationLocks`  | Cleans up expired mutation leases.                                                                    |

TTL deletion is asynchronous. Request paths independently enforce expiration, so an expired document is unusable before Firestore removes it. Do not add TTL to `assessments`, `courses`, or `canvasOAuthTokens` without first designing the resulting functional lifecycle.

## Release Verification

After each release, complete these checks before treating it as ready:

1. Verify the Cloud Build ran the Docker verification stage and deployed the intended `@sha256:...` image digest.
2. Verify Cloud Run is serving the new revision with the expected runtime service account, environment variables, secret versions, and Firestore database.
3. Request public health and metadata endpoints:

   ```bash
   curl -fsS "${TOOL_URL}/health"
   curl -fsS "${TOOL_URL}/.well-known/jwks.json"
   curl -fsS "${TOOL_URL}/lti/config"
   curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
   ```

4. Confirm the Canvas registration still points to this exact `TOOL_URL`; a service deploy does not update values Canvas already stored.
5. Run the instructor and student acceptance sequence in [Testing](testing.md), including both quiz engines and the setup check.
6. Confirm a client without the managed private identity cannot open the encrypted configuration, while an approved client can complete proof.
7. Inspect Cloud Run logs for startup configuration errors, Canvas OAuth failures, or detector diagnostics that were intentionally enabled for a non-production test.

## Data Changes And Maintenance Scripts

Deploy code before changing existing Firestore state. Confirm health and basic launch behavior first, then run a reviewed maintenance script against the intended project/database.

### Exam-tool catalog migration

```bash
npm run migrate:exam-tools -- --dry-run
npm run migrate:exam-tools -- --apply
```

The dry run reports planned course and assessment changes. Review it before applying. The operation seeds pre-catalog course tools, normalizes existing tool definitions, preserves assessment selections, and invalidates affected configuration state. Students must download fresh configurations afterwards.

### Raw New Quiz metadata cleanup

```bash
GCP_PROJECT_ID=PROJECT FIRESTORE_DATABASE_ID=DATABASE \
  npm run security:purge-new-quiz-metadata

GCP_PROJECT_ID=PROJECT FIRESTORE_DATABASE_ID=DATABASE \
  npm run security:purge-new-quiz-metadata -- --apply
```

The command defaults to a dry run, targets only the configured `assessments` collection, and removes `canvas.metadata` only when `--apply` is explicit. It does not print document contents.

## Rollback And Incident Response

Use the recorded image digest to roll Cloud Run back to a previously verified revision. A code rollback does not restore previous Canvas registrations, settings, OAuth state, or downloaded configurations automatically.

For a configuration or certificate incident:

1. Pause affected assessments or configuration downloads according to the organization’s exam policy.
2. Identify the active revision, `TOOL_URL`, Firestore database, public-certificate hash, and relevant Canvas registration.
3. Rotate compromised secrets or certificate identity as applicable.
4. Deploy the corrected configuration and validate it on an approved test client.
5. Invalidate affected configuration state through the normal settings workflow and require fresh downloads.

Do not respond by enabling debug mode in production, disabling configuration encryption, widening URL filters, or copying private client identities into Cloud Run.
