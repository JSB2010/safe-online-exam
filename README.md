# Canvas Safe Exam Browser LTI

A TypeScript rewrite of the Canvas Safe Exam Browser integration. The app is a NestJS service with a React/Vite UI that runs on the existing Google Cloud Run services and uses the existing Firestore databases.

The tool supports Canvas LTI 1.3 launches, Canvas OAuth for instructor API actions, Classic Quiz and New Quiz SEB enforcement, generated `.seb` configuration downloads, SEB Config Key proof, access-code injection, module item rewriting, and SEB exit pages.

## Current Stack

- Node.js 22
- TypeScript
- NestJS 11 on Express
- React 19 and Vite
- Vitest, Testing Library, Supertest, and Playwright
- Google Cloud Firestore
- Google Cloud Run Gen2
- Canvas LTI 1.3, Canvas OAuth2, Canvas REST APIs, and New Quiz APIs

## Project Layout

```text
src/
  client/              React UI and styles
  server/
    controllers/       LTI, OAuth, quiz, SEB, debug, static JS endpoints
    services/          Canvas API, LTI, SEB config, quiz/content logic
    data/              Firestore and in-memory repositories
    http/              app shell, CORS, request URL, API error helpers
    config/            environment-backed application config
    assets/            Canvas SEB detector script
  shared/              shared TypeScript domain models
test/
  e2e/                 Playwright browser smoke tests
  server/              unit and service regression tests
docs/
  architecture.md      system behavior and route inventory
  deployment.md        Cloud Run, Firestore, and secrets
  testing.md           verification strategy and commands
  tooling.md           package manager, CI, formatting, and repo hygiene decisions
```

## Local Development

Install dependencies:

```bash
npm ci
```

Run the full local quality gate:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
```

Or run the combined non-browser gate:

```bash
npm run verify
```

Run the app locally with the in-memory repository:

```bash
HOST=127.0.0.1 \
USE_IN_MEMORY_STORE=true \
TOOL_URL=http://localhost:8080 \
LTI_CLIENT_ID=test-client \
CANVAS_API_CLIENT_ID=test \
CANVAS_API_CLIENT_SECRET=test \
npm start
```

Open `http://127.0.0.1:8080/health` for a health check. React app-shell routes, such as `/seb/exit/course-1/classicquiz_quiz-1`, are served by Nest and hydrate from `/assets/index.js`.

For iterative backend development:

```bash
npm run dev
```

For frontend-only Vite development:

```bash
npm run dev:client
```

## Environment Variables

The app reads plain environment variables. Cloud Run injects secret values as environment variables through `--set-secrets`.

For local development, use `.env.example` as the reference template. Real `.env` files are ignored and should not be committed.

Required in Cloud Run:

- `NODE_ENV=production`
- `APP_ENV=dev` or `APP_ENV=prod`
- `GCP_PROJECT_ID`
- `FIRESTORE_DATABASE_ID`
- `TOOL_URL`
- `LTI_CLIENT_ID`
- `LTI_PRIVATE_KEY`
- `ADMIN_PASSWORD` or `SESSION_SECRET`
- `CANVAS_API_CLIENT_ID`
- `CANVAS_API_CLIENT_SECRET`
- `STATE_ENCRYPTION_KEY` in production

Useful optional variables:

- `CANVAS_DOMAIN`, default `https://kentdenver.instructure.com`
- `CANVAS_API_BASE_URL`, default `${CANVAS_DOMAIN}/api/v1`
- `CANVAS_REDIRECT_URI`, default `${TOOL_URL}/api/oauth2callback`
- `LTI_DEPLOYMENT_ID`
- `APP_DEBUG_ENABLED`
- `SEB_QUIT_PASSWORD`
- `SEB_REQUIRED_DOMAINS`
- Firestore collection overrides: `FIRESTORE_QUIZZES_COLLECTION`, `FIRESTORE_SEB_SETTINGS_COLLECTION`, `FIRESTORE_CONTENT_ITEMS_COLLECTION`, `FIRESTORE_CONTENT_SEB_SETTINGS_COLLECTION`, `FIRESTORE_OAUTH_TOKENS_COLLECTION`, `FIRESTORE_MODULE_ITEM_UPDATES_COLLECTION`

Production refuses to start without `LTI_PRIVATE_KEY` and `STATE_ENCRYPTION_KEY`.

## Firestore

The deployment keeps the existing Firestore database IDs:

- Dev: `seb-canvaslti-dev`
- Prod: `seb-canvaslti-prod`

Default collections:

- `quizzes`
- `sebSettings`
- `contentItems`
- `contentSebSettings`
- `oauthTokens`
- `module_item_updates`

The rewrite does not require Java model compatibility. The repository layer writes TypeScript-shaped documents with stable IDs and timestamps.

## Canvas LTI Configuration

The Canvas developer key should continue pointing at the Cloud Run service URL.

Important URLs:

- OIDC login URL: `${TOOL_URL}/lti/login`
- Target link URI: `${TOOL_URL}/lti/launch`
- Redirect URIs: `${TOOL_URL}/lti/launch` and `${TOOL_URL}/api/oauth2callback`
- Public JWKS URL: `${TOOL_URL}/.well-known/jwks.json`
- Deep link select URL: `${TOOL_URL}/lti/deeplink/select`
- Detector script: `${TOOL_URL}/js/canvas-seb-detector.js`

Required Canvas API OAuth scopes depend on the account configuration, but the tool needs enough access to read course content, read quizzes/assignments/modules, update quiz access codes, and create or update module items.

## Core Routes

Operational routes:

- `GET /health`
- `GET /.well-known/jwks.json`
- `GET /js/canvas-seb-detector.js`
- `GET /api/seb/canvas-detector.js`

LTI and OAuth:

- `GET|POST /lti/login`
- `GET|POST /lti/launch`
- `GET /lti/config`
- `GET /lti/deeplink/select`
- `POST /lti/deeplink/process`
- `POST /lti/deeplink/update-seb`
- `GET /api/oauth2authorize`
- `GET /api/oauth2reauthorize`
- `GET /api/oauth2callback`
- `GET /api/oauth2status`

Instructor quiz APIs:

- `GET /api/quizzes`
- `POST /api/quizzes/course/:courseId/refresh`
- `PUT /api/quizzes/:quizId/seb`
- `POST /api/quizzes/:courseId/:quizId/seb/enable`
- `POST /api/quizzes/:courseId/:quizId/seb/disable`
- `POST /api/quizzes/:courseId/:quizId/seb/regenerate-code`
- `GET /api/quizzes/:courseId/:quizId/seb/status`
- `POST /api/quizzes/seb-config-structured`

SEB/student flows:

- `GET /seb/quiz/:courseId/:quizId`
- `GET /seb/config/:courseId/:contentId.seb`
- `GET /seb/launch/:contentId`
- `POST /seb/launch/:contentId`
- `GET /seb/redirect/:quizId`
- `POST /seb/validate`
- `GET /seb/check`
- `POST /api/seb/access-proof/:courseId/:quizId`
- `GET /api/seb/access-code/:courseId/:quizId`
- `GET /api/seb/tools/:courseId/:quizId`
- `GET /seb/exit/:courseId/:quizId`
- `GET /seb/exit/quit/:courseId/:quizId`
- `GET /seb/exit/manual/:courseId/:quizId`

Classic quiz IDs use the raw Canvas quiz ID internally and `classicquiz_{quizId}` when represented as LTI content. New Quiz content IDs use `newquiz:{courseId}:{assignmentId}`.

## Cloud Run Deployment

The repo includes Cloud Build configs for the existing services:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
gcloud builds submit --config=cloudbuild-prod.yaml
```

These configs:

- pull the previous image as a Docker build cache source
- build a Node 22 Docker image whose stages run install, typecheck, lint, formatting check, coverage tests, build, and production dependency pruning
- deploy `canvas-seb-dev` or `canvas-seb-prod`
- keep Firestore database IDs on `seb-canvaslti-dev` and `seb-canvaslti-prod`
- inject secrets through Secret Manager

See [docs/deployment.md](docs/deployment.md) for required secrets and deployment checks.

## Testing

`npm test` runs fast unit and service regression tests. `npm run test:coverage` enforces the current coverage floor. The suite covers shared model parsing, config loading, LTI state, JWK generation, Canvas API behavior, repositories, SEB configuration generation, SEB Config Key proof, detector behavior, content and quiz services, module item rewrites, static detector serving, and HTTP helpers.

Browser verification uses Playwright against a built local server for the React app shell and responsive UI checks. See [docs/testing.md](docs/testing.md).

Tooling decisions, including why the repo currently stays on npm rather than pnpm or Bun, are documented in [docs/tooling.md](docs/tooling.md).

## Safe Exam Browser Behavior

The generated `.seb` files are binary plist payloads with Canvas start URLs, access codes, quit URLs, Config Key metadata, allowed URLs, and SEB-controlled new-window behavior for approved exam tools. The URL filter uses SEB's canonical `URLFilterEnable`, `URLFilterEnableContentFilter`, and `URLFilterRules` keys so only the quiz URL family, the LTI app, required Canvas file/media/CDN resources, narrow SSO support domains, and explicitly enabled exam-tool URLs can load. Config downloads persist a Config Key hash. The Canvas detector script then requests a one-time proof token from `/api/seb/access-proof/:courseId/:quizId`, exchanges it at `/api/seb/access-code/:courseId/:quizId`, and fills the Canvas access-code field only after SEB proves it is using the downloaded config.

Instructor settings can enable external exam tools such as Desmos. Enabled tools are exposed to students through a draggable Canvas quiz sidebar from the detector script. The sidebar is only a launcher; the SEB URL filter allowlist remains the enforcement mechanism for which external sites can load.

This preserves the legacy security model while removing the Java/Spring/Thymeleaf implementation.
