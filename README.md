# Canvas Safe Exam Browser LTI

A TypeScript rewrite of the Canvas Safe Exam Browser integration. The app is a NestJS service with a React/Vite UI that can be deployed as a portable, single-school Cloud Run service backed by Firestore.

The tool supports Canvas LTI 1.3 launches, Canvas OAuth for instructor API actions, Classic Quiz and New Quiz SEB enforcement, generated `.seb` configuration downloads, SEB Config Key proof, access-code injection, and SEB exit pages.

## Current Stack

- Node.js 24
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
  deployment.md        Current deployment targets, Cloud Run, Firestore, and secrets
  school-deployment.md Portable new-school setup guide
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
- `CANVAS_DOMAIN`
- `LTI_CLIENT_ID`
- `LTI_PRIVATE_KEY`
- `LTI_DEPLOYMENT_ID`
- `SESSION_SECRET`
- `CANVAS_API_CLIENT_ID`
- `CANVAS_API_CLIENT_SECRET`
- `STATE_ENCRYPTION_KEY`
- `SEB_CONFIG_ENCRYPTION_CERT_PEM` or `SEB_CONFIG_ENCRYPTION_CERT_PATH`

Useful optional variables:

- `LTI_ISSUER`, default `https://canvas.instructure.com`. A self-hosted issuer may include a path, but must use HTTPS and cannot contain URL credentials, a query, or a fragment.
- `LTI_KEY_SET_URL` and `LTI_AUTH_URL`, defaulting to Canvas cloud's `sso.canvaslms.com` endpoints. Self-hosted endpoints may use another host/path and an installation-specific query, but must use HTTPS and cannot contain URL credentials or a fragment.
- `CANVAS_API_BASE_URL`, default `${CANVAS_DOMAIN}/api/v1`; Cloud Run rejects another origin or path
- `CANVAS_REDIRECT_URI`, default `${TOOL_URL}/api/oauth2callback`
- `APP_DEBUG_ENABLED`, the single local debug toggle for detector console logs, detector traces, and detector script cache behavior. It defaults to `false` and Cloud Run rejects `true`.
- `SEB_QUIT_PASSWORD`
- `SEB_REQUIRED_DOMAINS`, concrete school-reviewed hostnames only; wildcards are rejected.
- `SEB_CONFIG_ENCRYPTION_ENABLED`, default `true` and mandatory on Cloud Run.
- `SEB_CONFIG_ENCRYPTION_CERT_PEM` or `SEB_CONFIG_ENCRYPTION_CERT_PATH`, the public X.509 certificate used to encrypt generated `.seb` files. The server does not need the private key.
- `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM` or `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH`, optional server-only RSA public key fallback when the public certificate is managed elsewhere.
- Firestore collection overrides: `FIRESTORE_ASSESSMENTS_COLLECTION`, `FIRESTORE_COURSES_COLLECTION`, `FIRESTORE_OAUTH_TOKENS_COLLECTION`, `FIRESTORE_SESSIONS_COLLECTION`, `FIRESTORE_TRANSIENT_STATES_COLLECTION`, `FIRESTORE_OPERATION_LOCKS_COLLECTION`

SEB start and exit passwords must be 8–128 characters and use at least five different letters or numbers. Letters-only and numbers-only values are allowed, while common words, sequences, repeated patterns, low-diversity values, and control characters are rejected with a specific validation message. A start password can be shared with students, so it must never equal the effective course, quiz, or managed-server exit password. Blank password fields mean “keep the existing secret”; use the explicit password toggle to remove a course or quiz password. Ordinary settings responses remain secret-free. A verified instructor may explicitly reveal a saved course or assessment password through a session-bound, same-origin POST; the response is `no-store`, the UI removes it after 30 seconds, and a managed server default is never returned.

Cloud Run refuses to start unless the school-specific URL, Canvas, LTI deployment, OAuth, Firestore, certificate-encryption, and secret values are injected. Tool and Canvas URLs must be bare HTTPS origins, and both `SESSION_SECRET` and `STATE_ENCRYPTION_KEY` must contain at least 32 characters. Hardened runtimes also reject insecure LTI trust-root URLs, conflicting `APP_BASE_URL`/`BASE_URL` aliases, debug mode, wildcard required domains, and the in-memory store. Local development has neutral placeholder defaults for tests, but production and dev Cloud Run services must set their real values through environment variables and Secret Manager. `ADMIN_PASSWORD` remains a local-development compatibility alias; production and Cloud Run require the independent canonical `SESSION_SECRET`.

## Firestore

The maintained deployment configs keep the current Firestore database IDs:

- Dev: `seb-canvaslti-dev`
- Prod: `seb-canvaslti-prod`

Default collections:

- `assessments`
- `courses`
- `canvasOAuthTokens`
- `sessions`
- `transientStates`
- `operationLocks`

The rewrite does not require Java model compatibility. The repository layer writes TypeScript-shaped documents with stable IDs and timestamps. Classic Quiz and New Quiz content share the `assessments` collection; course defaults live in `courses`; Canvas OAuth tokens live in `canvasOAuthTokens`. Cloud Run multi-instance runtime state uses Firestore too: Express sessions live in `sessions`, OAuth state, LTI replay claims, and SEB proof tokens live in `transientStates`, and short assessment update leases live in `operationLocks`. LTI OIDC state is encrypted and self-contained when issued; it is also bound to a fresh secret in one fixed-name, short-lived `HttpOnly`, `Secure`, `SameSite=None`, `__Host-` transaction cookie so copied state cannot be completed in another browser and repeated login initiations cannot accumulate cookies. The callback requires that binding, atomically creates a durable replay claim, clears the transaction cookie, and then establishes the verified session.

`USE_IN_MEMORY_STORE=true` is only for local development and tests. The app refuses to start with the in-memory store in production or on Cloud Run.

Configure Firestore TTL policies on `expiresAt` for `sessions`, `transientStates`, and `operationLocks`.

## Canvas LTI Configuration

The Canvas developer key should continue pointing at the Cloud Run service URL.

The dynamic LTI config endpoint includes course navigation placement metadata and Canvas course-membership custom fields. The app also enforces role-aware rendering at launch time: instructors see quiz management, while students see a launch-only page with SEB-enabled assessments if the placement is visible to them in Canvas.

Important URLs:

- OIDC login URL: `${TOOL_URL}/lti/login`
- Target link URI: `${TOOL_URL}/lti/launch`
- Redirect URIs: `${TOOL_URL}/lti/launch` and `${TOOL_URL}/api/oauth2callback`
- Public JWKS URL: `${TOOL_URL}/.well-known/jwks.json`
- Detector script: `${TOOL_URL}/js/canvas-seb-detector.js`

Required Canvas API OAuth scopes depend on the account configuration, but the tool needs enough access to read course content, read quizzes/assignments, and update quiz access codes.

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
- `POST /api/quizzes/course/:courseId/passwords/reveal`
- `POST /api/quizzes/:courseId/:quizId/passwords/reveal`

SEB/student flows:

- `GET /seb/quiz/:courseId/:quizId`
- `GET /seb/config/:courseId/:contentId.seb`
- `GET /seb/launch/:contentId`
- `POST /seb/launch/:contentId`
- `GET /seb/check/config.seb`
- `GET /seb/check`
- `POST /api/seb/check-proof`
- `GET /seb/check/quit`
- `POST /api/seb/access-proof/:courseId/:quizId`
- `POST /api/seb/access-code/:courseId/:quizId`
- `GET /api/seb/tools/:courseId/:quizId`
- `GET /seb/exit/:courseId/:quizId`
- `GET /seb/exit/session/:courseId/:quizId/:grant`
- `GET /seb/exit/quit/:courseId/:quizId/:grant`
- `GET /seb/exit/complete/:courseId/:quizId/:token`
- `GET /seb/exit/quit/:courseId/:quizId`
- `GET /seb/exit/manual/:courseId/:quizId`

Classic quiz IDs use the raw Canvas quiz ID internally and `classicquiz_{quizId}` when represented as LTI content. New Quiz content IDs use `newquiz:{courseId}:{assignmentId}`.

## Cloud Run Deployment

The repo includes Cloud Build configs for the maintained services:

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
gcloud builds submit --config=cloudbuild-prod.yaml
```

These configs:

- pull the previous image as a Docker build cache source
- build with Node 24, then emit a distroless Node 24 runtime image after install, typecheck, lint, formatting check, coverage tests, build, and production dependency pruning
- push a build-unique tag, capture the digest returned by that exact push, and deploy `canvas-seb-dev` or `canvas-seb-prod` by immutable `sha256` digest without re-resolving the tag
- keep Firestore database IDs on `seb-canvaslti-dev` and `seb-canvaslti-prod`
- inject school-specific secrets through Secret Manager

Canvas must reach each maintained LTI service without Cloud Run authentication. The dev, production, and school Cloud Build configs therefore pass `--allow-unauthenticated`; post-deploy verification must confirm the `allUsers` / `roles/run.invoker` binding and a successful public health request.

For a new school, use [docs/school-deployment.md](docs/school-deployment.md) with `cloudbuild-school.yaml`. See [docs/deployment.md](docs/deployment.md) for maintained target details and [docs/canvas-school-setup.md](docs/canvas-school-setup.md) for Canvas LTI installation and theme JavaScript setup.

## Testing

`npm test` runs fast unit and service regression tests. `npm run test:coverage` enforces the current coverage floor. The suite covers shared model parsing, config loading, LTI state, JWK generation, Canvas API behavior, repositories, SEB configuration generation, SEB Config Key proof, detector behavior, content and quiz services, static detector serving, and HTTP helpers.

Browser verification uses Playwright against a built local server for the React app shell and responsive UI checks. See [docs/testing.md](docs/testing.md).

Tooling decisions, including why the repo currently stays on npm rather than pnpm or Bun, are documented in [docs/tooling.md](docs/tooling.md).

## Safe Exam Browser Behavior

The generated `.seb` files contain canonical Canvas quiz-taking start URLs, access codes, quit URLs, Config Key metadata, allowed URLs, optional exam start passwords, and SEB-controlled new-window behavior for approved exam tools. Classic Quizzes start on their `/quizzes/:quizId/take` route. New Quizzes start on the stable `/assignments/:assignmentId` entry route so Canvas can create or resume the student-specific `/taking/:attemptId` session. Downloads are wrapped in SEB macOS-compatible certificate-encrypted `pkhs` format using the configured public certificate; Cloud Run will not start without encryption and a validity-checked X.509 certificate. The matching private identity belongs on managed clients through an MDM Certificates payload configured as non-extractable and restricted from unrelated apps. Students can run the LTI setup check, which opens `/seb/check/config.seb`, verifies the encrypted setup config through `/api/seb/check-proof`, and confirms SEB runtime, storage, service connectivity, and Config Key proof before a real quiz. If an instructor sets an exam start password, the inner SEB payload uses SEB `pswd` password encryption and SEB prompts students before opening the exam config. The URL filter uses SEB's canonical `URLFilterEnable` and `URLFilterRules` keys so only exact, validated quiz/tool URL families and concrete school-reviewed support hosts can load; wildcard hostnames and caller-authored regular expressions are rejected. `URLFilterEnableContentFilter` stays disabled so Canvas-managed embedded resources can change without widening the allowed top-level navigation surface. The server does not persist a replayable Config Key when a config is downloaded; it deterministically regenerates the current inner settings and computes the expected Config Key during proof verification. The Canvas detector script requests a one-time, setting-bound proof token, exchanges it at `/api/seb/access-code/:courseId/:quizId`, and fills the Canvas access-code field only after SEB proves it is using the current server-generated configuration. Because New Quiz renders asynchronously, the detector begins that proof-gated exchange once on the exact assignment route before requiring the field to exist, then waits for one contextual text/password input anchored to Canvas's access-code prompt and Submit control. It never treats the DOM alone as authorization and refuses ambiguous groups of inputs. The exchange also returns a generation-bound exit grant and the approved exam tools for the current browser tab. Tools stay hidden on the access-code gate and are rendered from the tab-session cache as soon as the active `/take` page is visible. No timer or ambient page signal can establish completion. After explicit final-submit intent and an authoritative Canvas results page, the validated exit page starts a two-second countdown and follows its config-bound Quit Link; the student can use the visible button immediately if needed.

Certificate and password encryption are additional anti-tamper layers, not replacements for Config Key proof. If a student changes the generated config, for example to widen the URL allowlist, the Config Key changes and access-code proof is rejected. Proof tokens are bound to the current setting generation, so changing any SEB-affecting setting invalidates previously issued proof. The exam start password also rotates SEB's native Config Key salt so configs downloaded before the password change become stale. Every enabled assessment must resolve a nonempty quit password from its quiz/course settings or the managed `SEB_QUIT_PASSWORD` default; assessment config generation fails closed otherwise. Native or early quit still requires that password. After Canvas authoritatively confirms final submission, the detector may expose an explicit passwordless Quit Link, but only through a session exit grant bound to the course, content item, and current setting generation. That grant redirects to the exact HMAC-authenticated Quit URL embedded in the current `.seb` config. The SEB confirmation warning for this validated Quit URL is disabled because the app already presents its own two-second completion screen and manual button. Static, guessable, reusable, manual, and pre-completion automatic quit paths remain disabled. Ordinary instructor API and bootstrap responses never return access codes, Config Keys, start passwords, or quit passwords and expose only `has...` booleans. The two explicit password-reveal POST routes may return saved course/assessment start and exit values after full instructor, course/assessment, same-origin, and session-token authorization; those responses are `no-store`, are cleared by the UI after 30 seconds, and never expose a managed server default. SEB Server integration remains out of scope.

For local certificate testing, run:

```bash
umask 077
mkdir -p .local
openssl rand -base64 48 > .local/seb-cert-p12-password
bash scripts/generate-seb-config-cert.sh .local/seb-certs .local/seb-cert-p12-password
```

Use the generated public cert path as `SEB_CONFIG_ENCRYPTION_CERT_PATH`. The `.p12` contains the private key and must not be published or passed through environment variables, script parameters, or process command lines. Production distribution must use a managed Certificates payload (or an authorized technician workflow) that makes the key non-extractable and restricts access to SEB. The legacy secret-bearing login-keychain importer is retired. The public certificate can be downloaded from `/seb/config-encryption-certificate.pem` or `/seb/config-encryption-certificate.cer` when certificate encryption is configured. See [docs/seb-certificate-runbook.md](docs/seb-certificate-runbook.md) for managed rollout, private-key storage, and rotation.

Instructor settings can enable external exam tools. The built-in Desmos preset is pinned to Desmos's assessment testing mode rather than the standard calculator, which supports account and sharing features; schools that need a different assessment profile should configure that profile's exact testing URL. Course defaults store the optional exam start password, required effective exit-password policy, allowed URL rules, and exam tools for newly enabled quizzes. Per-quiz settings can override those defaults or reset back to them. If an exit password is lost, disable affected assessments, set a replacement course or managed server password, re-enable them, and issue fresh configs; do not replace native early-quit protection with a static passwordless URL. The post-submission Quit Link is a separate, server-validated capability that does not reveal or bypass the native quit password before completion. Enabled tools are exposed to students through a draggable Canvas quiz sidebar from the detector script only on the active quiz-taking page. The sidebar is only a launcher; the SEB URL filter allowlist remains the enforcement mechanism for which external sites can load.

This preserves the legacy security model while removing the Java/Spring/Thymeleaf implementation.
