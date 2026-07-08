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
  canvas-school-setup.md
                       Canvas LTI installation and theme JavaScript setup
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
- `APP_DEBUG_ENABLED`, the single debug/development toggle for diagnostic endpoints, detector console logs, detector Cloud Run traces, and detector script cache behavior. It defaults on outside prod and off in prod.
- `SEB_QUIT_PASSWORD`
- `SEB_REQUIRED_DOMAINS`
- `SEB_CONFIG_ENCRYPTION_ENABLED`, default `true`. Set to `false` to disable certificate wrapping; instructor-configured exam start passwords still use SEB password encryption.
- `SEB_CONFIG_ENCRYPTION_CERT_PEM` or `SEB_CONFIG_ENCRYPTION_CERT_PATH`, the public X.509 certificate used to encrypt generated `.seb` files. The server does not need the private key.
- `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM` or `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH`, optional server-only RSA public key fallback when the public certificate is managed elsewhere.
- Firestore collection overrides: `FIRESTORE_QUIZZES_COLLECTION`, `FIRESTORE_SEB_SETTINGS_COLLECTION`, `FIRESTORE_CONTENT_ITEMS_COLLECTION`, `FIRESTORE_CONTENT_SEB_SETTINGS_COLLECTION`, `FIRESTORE_COURSE_SEB_DEFAULTS_COLLECTION`, `FIRESTORE_OAUTH_TOKENS_COLLECTION`, `FIRESTORE_MODULE_ITEM_UPDATES_COLLECTION`

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
- `courseSebDefaults`
- `oauthTokens`
- `module_item_updates`

The rewrite does not require Java model compatibility. The repository layer writes TypeScript-shaped documents with stable IDs and timestamps.

## Canvas LTI Configuration

The Canvas developer key should continue pointing at the Cloud Run service URL.

The dynamic LTI config endpoint includes course navigation placement metadata and Canvas course-membership custom fields. The app also enforces role-aware rendering at launch time: instructors see quiz management, while students see a launch-only page with SEB-enabled assessments if the placement is visible to them in Canvas.

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
- `GET /api/quizzes/course/:courseId/defaults`
- `PUT /api/quizzes/course/:courseId/defaults`
- `PUT /api/quizzes/:quizId/seb`
- `POST /api/quizzes/:courseId/:quizId/seb/enable`
- `POST /api/quizzes/:courseId/:quizId/seb/disable`
- `POST /api/quizzes/:courseId/:quizId/seb/reset-defaults`
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

The dev Cloud Run service keeps its public `allUsers` / `roles/run.invoker` binding outside the deploy command. `cloudbuild-dev.yaml` does not pass `--allow-unauthenticated`, which avoids Cloud Build trying to reset service IAM on every deploy.

See [docs/deployment.md](docs/deployment.md) for required secrets and deployment checks. See
[docs/canvas-school-setup.md](docs/canvas-school-setup.md) for Canvas LTI installation and theme JavaScript setup.

## Testing

`npm test` runs fast unit and service regression tests. `npm run test:coverage` enforces the current coverage floor. The suite covers shared model parsing, config loading, LTI state, JWK generation, Canvas API behavior, repositories, SEB configuration generation, SEB Config Key proof, detector behavior, content and quiz services, module item rewrites, static detector serving, and HTTP helpers.

Browser verification uses Playwright against a built local server for the React app shell and responsive UI checks. See [docs/testing.md](docs/testing.md).

Tooling decisions, including why the repo currently stays on npm rather than pnpm or Bun, are documented in [docs/tooling.md](docs/tooling.md).

## Safe Exam Browser Behavior

The generated `.seb` files contain canonical Canvas quiz-taking start URLs, access codes, quit URLs, Config Key metadata, allowed URLs, optional exam start passwords, and SEB-controlled new-window behavior for approved exam tools. By default, downloads are wrapped in SEB macOS-compatible certificate-encrypted `pkhs` format using the configured public certificate, so the matching private-key identity must be installed in SEB clients through Jamf or manual Keychain import. If an instructor sets an exam start password, the inner SEB payload uses SEB `pswd` password encryption and SEB prompts students before opening the exam config. Set `SEB_CONFIG_ENCRYPTION_ENABLED=false` only for local troubleshooting or an explicit no-certificate rollout; start-password configs are still password-encrypted. The URL filter uses SEB's canonical `URLFilterEnable` and `URLFilterRules` keys so only the quiz URL family, the LTI app, required Canvas file/media/CDN resources, narrow SSO support domains, and explicitly enabled exam-tool URLs can load. `URLFilterEnableContentFilter` stays disabled because SEB macOS modern WKWebView and the SEB JavaScript Config Key API do not support that content-filter mode. Config downloads persist a Config Key hash computed from the plaintext settings before encryption. The Canvas detector script then requests a one-time proof token from `/api/seb/access-proof/:courseId/:quizId`, exchanges it at `/api/seb/access-code/:courseId/:quizId`, and fills the Canvas access-code field only after SEB proves it is using the exact server-generated configuration.

Certificate and password encryption are additional anti-tamper layers, not replacements for Config Key proof. If a student changes the generated config, for example to widen the URL allowlist, the Config Key changes and access-code proof is rejected. The exam start password also rotates SEB's native Config Key salt so configs downloaded before the password change become stale. SEB Server integration remains out of scope.

For local certificate testing, run:

```bash
bash scripts/generate-seb-config-cert.sh
```

Use the generated public cert path as `SEB_CONFIG_ENCRYPTION_CERT_PATH`, and import the generated `.p12` into your macOS login keychain before opening encrypted configs in SEB. The `.p12` contains the private key and must not be published. The public certificate can be downloaded from `/seb/config-encryption-certificate.pem` or `/seb/config-encryption-certificate.cer` when certificate encryption is configured. See [docs/seb-certificate-runbook.md](docs/seb-certificate-runbook.md) for Jamf rollout, BYOD install, private-key storage, and rotation.

Instructor settings can enable external exam tools such as Desmos. Course defaults store the optional exam start password, default exit password, allowed URL rules, and exam tools for newly enabled quizzes. Per-quiz settings can override those defaults or reset back to them. Enabled tools are exposed to students through a draggable Canvas quiz sidebar from the detector script. The sidebar is only a launcher; the SEB URL filter allowlist remains the enforcement mechanism for which external sites can load.

This preserves the legacy security model while removing the Java/Spring/Thymeleaf implementation.
