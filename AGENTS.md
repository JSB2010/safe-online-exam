# AGENTS.md

Canonical guidance for coding agents working in this repository.

## First Principles

This is a TypeScript rewrite of the Canvas Safe Exam Browser LTI integration. The Java/Spring/Maven implementation has been removed and should not be restored.

Preserve behavior before refactoring. Canvas LTI URLs, Cloud Run service names, Firestore database IDs, SEB configuration behavior, and public compatibility endpoints are part of the product contract.

## Current Stack

- Runtime: Node.js 24 on Google Cloud Run Gen2.
- Package manager: npm, pinned with `packageManager` in `package.json`.
- Backend: NestJS on Express under `src/server`.
- Frontend: React and Vite under `src/client`.
- Shared models: `src/shared`.
- Data: Google Cloud Firestore through `src/server/data/repositories.ts`.
- Tests: Vitest for unit/service tests and Playwright for browser smoke tests.
- Formatting and linting: Prettier and ESLint.

## Commands

Install:

```bash
npm ci
```

Local verification:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm run test:e2e
```

Combined non-browser gate:

```bash
npm run verify
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
gcloud builds submit --config=cloudbuild-dev.yaml
gcloud builds submit --config=cloudbuild-prod.yaml
```

## Cloud Run Targets

Keep these targets unless the user explicitly requests a migration:

- Dev Cloud Run service: `canvas-seb-dev`
- Prod Cloud Run service: `canvas-seb-prod`
- Region: `us-central1`
- Dev Firestore DB: `seb-canvaslti-dev`
- Prod Firestore DB: `seb-canvaslti-prod`

Canvas points at the Cloud Run service URLs. Changing service URLs is a Canvas integration change, not an internal refactor.

## Build and CI

Cloud Build should behave as the deployment CI gate. The Dockerfile owns the install, typecheck, lint, format check, coverage tests, build, production prune, and runtime assembly. Cloud Build should not duplicate those npm steps outside Docker.

The Cloud Build configs pull the previous Artifact Registry image and pass `--cache-from` to Docker. This keeps the deterministic Docker build while allowing dependency and build layers to be reused when possible.

Playwright e2e tests are available through `npm run test:e2e`. They are not part of the default deploy Cloud Build because browser installation materially increases deploy time. Use them locally and in a separate PR/nightly CI path if this repository later gets one.

## Package Manager Policy

Use npm for this repo unless there is a concrete workspace or install-performance problem.

Reasons:

- The project is a single deployable package, not a monorepo.
- Node images already ship npm.
- `npm ci` gives deterministic frozen installs from `package-lock.json`.
- Cloud Build and Docker stay simple.

Do not migrate to pnpm, Bun, or Turborepo only for novelty. Revisit pnpm workspaces or Turborepo if the repo splits into multiple packages, shared libraries, or multiple deployables. Revisit Bun only after validating NestJS, Firestore, jose, Playwright, and Cloud Run behavior under Bun in a separate branch.

## Environment Management

Runtime config is environment-variable based. There are no Java `.properties` files.

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
- `GCP_PROJECT_ID`
- `FIRESTORE_DATABASE_ID`
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
  - `GET /api/seb/access-code/:courseId/:quizId`
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
  client/              React UI and styles
  server/
    assets/            Canvas detector script
    config/            environment config
    controllers/       HTTP controllers
    data/              Firestore and in-memory repositories
    http/              app shell, CORS, URL, and API error helpers
    services/          Canvas, LTI, quiz, content, SEB behavior
    types/             Express/session type augmentation
  shared/              shared domain models
test/
  e2e/                 Playwright browser tests
  server/              Vitest unit/service tests
docs/
  architecture.md
  deployment.md
  testing.md
  tooling.md
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
- `docs/architecture.md`
- `docs/deployment.md`
- `docs/testing.md`
- `docs/tooling.md`
