# AGENTS.md

Canonical guidance for coding agents working in this repository.

## First Principles

This is a TypeScript Safe Online Exam Canvas LTI integration. Preserve its Canvas LTI URLs, Cloud Run service names, PostgreSQL schema/data behavior, SEB configuration behavior, and public compatibility endpoints.

Preserve behavior before refactoring. Canvas LTI URLs, Cloud Run service names, migration ordering, PostgreSQL concurrency semantics, SEB configuration behavior, and public compatibility endpoints are part of the product contract.

## Current Stack

- Runtime: Node.js 24 container; Docker Compose and Google Cloud Run Gen2 are maintained deployment targets.
- Package manager: npm, pinned with `packageManager` in `package.json`.
- Backend: NestJS on Express under `src/server`.
- Frontend: React and Vite under `src/client`.
- Shared models: `src/shared`.
- Data: PostgreSQL 17+ through `src/server/data`; in-memory repositories are local/test only.
- Tests: Vitest for unit/service and real-PostgreSQL tests, plus Playwright browser smoke tests.
- Formatting and linting: Prettier and ESLint.

## Commands

Install:

```bash
npm run verify:dependency-policy
npm ci --ignore-scripts
npm run install:trusted
```

Local verification:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm run verify:postgres
npm run test:e2e
```

Combined non-browser gate:

```bash
npm run verify
```

Release metadata gate:

```bash
npm run release:check
```

Local production-build smoke run:

```bash
HOST=127.0.0.1 \
USE_IN_MEMORY_STORE=true \
TOOL_URL=http://localhost:8080 \
LTI_CLIENT_ID=test-client \
CANVAS_API_CLIENT_ID=test \
CANVAS_API_CLIENT_SECRET=test \
npm start
```

Deploy through Cloud Build:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml \
  --substitutions=_OAUTH_TOKEN_ENCRYPTION_MODE=compat
gcloud builds submit --config=cloudbuild-prod.yaml \
  --substitutions=_IMAGE_DIGEST=sha256:RELEASE_DIGEST,_RELEASE_TAG=vX.Y.Z,_SOURCE_DIGEST=40_CHARACTER_GIT_SHA,_GITHUB_ATTESTATION_TOKEN_SECRET_VERSION=SECRET_VERSION,_OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION=KEYRING_VERSION,_OAUTH_TOKEN_ENCRYPTION_MODE=compat
```

Use `compat` for the first deployment to an existing installation. Use
`enforce` only for a fresh installation or the subsequent staged deployment
after the compatibility revision is verified.

Public releases are tag-driven. After synchronized version metadata is merged
to `main`, push one annotated `vX.Y.Z` tag. The GitHub workflow owns the draft,
verification, GHCR publication, attestations, bundle, and immutable release
publication. Do not manually publish the GitHub Release.

## Cloud Run Targets

Keep these targets unless the user explicitly requests a migration:

- Dev Cloud Run service: `canvas-seb-dev`
- Prod Cloud Run service: `canvas-seb-prod`
- Region: `us-central1`
- Default dev Cloud SQL instance: `canvas-seb-dev`
- Default prod Cloud SQL instance: `canvas-seb-prod`
- Default PostgreSQL database: `canvas_seb`

Canvas points at the Cloud Run service URLs. Changing service URLs is a Canvas integration change, not an internal refactor.

## Build and CI

Cloud Build should behave as the deployment CI gate. Development and named-school source builds use the Dockerfile for install, typecheck, lint, format check, coverage tests, build, production prune, and runtime assembly, plus a separate real-PostgreSQL migration/concurrency step. Production Cloud Build accepts only a published immutable release digest so dependency code never executes under the production deploy identity. Deploy the migration job and wait for it before deploying the service.

The development and named-school source-build configs pull the previous
Artifact Registry image and pass `--cache-from` to Docker. This keeps their
deterministic Docker builds while allowing dependency and build layers to be
reused when possible. Production promotion does not rebuild source.

Playwright e2e tests are available through `npm run test:e2e`. They are not part of the default deploy Cloud Build because browser installation materially increases deploy time. Use them locally and in a separate PR/nightly CI path if this repository later gets one.

## Package Manager Policy

Use npm for this repo unless there is a concrete workspace or install-performance problem.

Reasons:

- The project is a single deployable package, not a monorepo.
- Node images already ship npm.
- `npm ci` gives deterministic frozen installs from `package-lock.json`.
- Cloud Build and Docker stay simple.

Do not migrate to pnpm, Bun, or Turborepo only for novelty. Revisit pnpm workspaces or Turborepo if the repo splits into multiple packages, shared libraries, or multiple deployables. Revisit Bun only after validating NestJS, PostgreSQL, jose, Playwright, and Cloud Run behavior under Bun in a separate branch.

## Environment Management

Runtime configuration is environment-variable based.

- Use `.env.example` as the documented local template.
- Do not commit real `.env` files.
- Cloud Run injects production values through `--set-env-vars` and `--set-secrets`.
- Production requires `LTI_PRIVATE_KEY` and `STATE_ENCRYPTION_KEY`.

Important variables:

- `TOOL_URL`
- `LTI_CLIENT_ID`
- `LTI_PRIVATE_KEY`
- `LTI_DEPLOYMENT_ID`
- `CANVAS_DOMAIN`
- `CANVAS_API_CLIENT_ID`
- `CANVAS_API_CLIENT_SECRET`
- `CANVAS_REDIRECT_URI`
- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_PASSWORD` or `DATABASE_PASSWORD_FILE`
- `DATABASE_SSL_MODE`
- `DATABASE_POOL_MAX`
- `ADMIN_PASSWORD` or `SESSION_SECRET`
- `STATE_ENCRYPTION_KEY`

## Core Behavior to Preserve

- LTI OIDC login and launch:
  - `GET|POST /lti/login`
  - `GET|POST /lti/launch`
- Public JWKS:
  - `GET /.well-known/jwks.json`
- Canvas OAuth:
  - `GET /api/oauth2authorize`
  - `GET /api/oauth2reauthorize`
  - `GET /api/oauth2callback`
  - `GET /api/oauth2status`
- Classic Quiz and New Quiz SEB enable/disable/regenerate/status APIs.
- Classic Quiz content IDs: `classicquiz_{quizId}`.
- New Quiz content IDs: `newquiz:{courseId}:{assignmentId}`.
- SEB config downloads:
  - `GET /seb/config/:courseId/:contentId.seb`
- Config Key proof and one-time access-code flow:
  - `POST /api/seb/access-proof/:courseId/:quizId`
  - `POST /api/seb/access-code/:courseId/:quizId`
- Detector script compatibility paths:
  - `GET /js/canvas-seb-detector.js`
  - `GET /api/seb/canvas-detector.js`
- SEB exit routes:
  - `GET /seb/exit/:courseId/:quizId`
  - `GET /seb/exit/quit/:courseId/:quizId`
  - `GET /seb/exit/manual/:courseId/:quizId`

## Repository Layout

```text
src/
  client/              React router, role-focused features, shared UI/helpers, and ordered styles
  server/
    assets/            Ordered Canvas detector source fragments
    config/            environment config
    controllers/       HTTP route controllers plus route-specific coordinators/helpers
    data/              PostgreSQL migrations/modular stores and in-memory test repositories
    http/              app shell, static-asset delivery, CORS, URL, and API error helpers
    services/          Canvas, LTI, assessment, content, and SEB behavior modules
    types/             Express/session type augmentation
  shared/              Shared domain model modules and compatibility barrel
test/
  e2e/                 Playwright browser tests
  server/              Vitest unit/service tests
docs/
  architecture.md
  canvas-setup.md
  configuration.md
  deployment.md
  certificate-management.md
  testing.md
```

## Frontend Rules

The UI is operational software that often runs inside Canvas and SEB. Keep it compact, readable, and task-oriented.

- Use Lucide icons instead of emoji.
- Avoid marketing/landing-page layouts.
- Avoid decorative blobs, oversized heroes, and copy that explains the UI instead of doing the work.
- Verify app-shell changes at desktop and mobile widths.
- Check browser console errors for UI changes.

## Documentation

Update docs when changing architecture, deployment, required secrets, public routes, or test expectations.

Primary docs:

- `README.md`
- `docs/README.md`
- `docs/architecture.md`
- `docs/canvas-setup.md`
- `docs/user-guide.md`
- `docs/configuration.md`
- `docs/deployment.md`
- `docs/certificate-management.md`
- `docs/testing.md`
- `docs/troubleshooting.md`
- `docs/releasing.md`
