# Safe Online Exam

Safe Online Exam connects Canvas assessments to [Safe Exam Browser (SEB)](https://safeexambrowser.org/). Instructors configure Classic Quizzes and New Quizzes from a Canvas course-navigation placement, while root-account Canvas administrators receive a separate school-wide account-navigation dashboard. Students receive a certificate-encrypted `.seb` configuration, and the Canvas access code is released only after Config Key proof succeeds.

The application supports Canvas LTI 1.3, Canvas OAuth, protected Canvas session handoff, approved web exam tools, one-time access proof, and the Canvas detector script. It runs on Node.js 24 with PostgreSQL 17 and can be deployed with Docker Compose, on a conventional container platform, or on Google Cloud Run with Cloud SQL.

## What It Does

- Discovers and manages Classic Quizzes and New Quizzes.
- Gives verified root-account administrators a Canvas-embedded view of connected courses, assessment state, password recovery, active-course discovery, and reusable school tool presets with bulk rollout.
- Sets and rotates Canvas access codes without returning them in routine UI or API responses.
- Lets instructors select course tools or define a tool that exists only for one quiz.
- Generates certificate-encrypted SEB configurations with optional start and exit passwords.
- Transfers a scoped Canvas session into SEB without copying the normal browser's cookies.
- Uses the SEB JavaScript API and a short-lived one-time proof before releasing access, approved tools, or exit capability.
- Persists settings, OAuth tokens, sessions, transient claims, and distributed locks in PostgreSQL.
- Stores one Canvas OAuth grant per user; administrator authorization upgrades that same grant with the additional account scopes.

One deployment connects to one Canvas tenant and environment. Isolate environments with separate service URLs, PostgreSQL databases or clusters, secrets, LTI deployments, and OAuth credentials.

## Documentation

| Guide                                                    | Use it for                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                     | Runtime design, PostgreSQL concurrency, trust boundaries, data model, and route contracts.                    |
| [Canvas setup](docs/canvas-setup.md)                     | Creating the LTI registration, installing it, authorizing API access, and loading the detector script.        |
| [Configuration](docs/configuration.md)                   | Database, environment, secret-file, Canvas, LTI, and SEB settings.                                            |
| [Deployment](docs/deployment.md)                         | Recommended Google Cloud setup and generic Docker/VPS setup, including SQL, secrets, backups, and operations. |
| [Certificate management](docs/certificate-management.md) | Creating, distributing, rotating, and validating SEB configuration-encryption identities.                     |
| [Testing](docs/testing.md)                               | Unit, real-PostgreSQL, Compose, Playwright, and manual Canvas/SEB acceptance checks.                          |

## Architecture At A Glance

```text
Canvas LTI 1.3 ──────> NestJS service ──────> PostgreSQL 17+
      │                     │                    │
      │                     ├─ React app shell    ├─ settings and OAuth tokens
      │                     ├─ Canvas OAuth       ├─ sessions and one-time state
      │                     └─ SEB configuration  └─ admission budgets and locks
      │
      └─ Canvas theme loader ──> detector script ──> SEB proof/access-code flow
```

- Backend: NestJS 11 on Express under `src/server`.
- Frontend: React 19 and Vite under `src/client`.
- Shared types: `src/shared`.
- Persistence: PostgreSQL in deployed environments; in-memory repositories only for local tests and UI smoke work.
- Packaging: a nonroot distroless Node.js 24 container.

## Deployment Options

Google Cloud Run with Cloud SQL is the recommended managed deployment. The checked-in Cloud Build pipeline verifies the image, runs real PostgreSQL tests, publishes an immutable Artifact Registry digest, waits for the migration job, deploys the cleanup job, and updates the existing Cloud Run service without changing its URL.

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
gcloud builds submit --config=cloudbuild-prod.yaml
```

First-time Google Cloud provisioning requires Cloud SQL, Artifact Registry, runtime/build IAM, Secret Manager versions, a stable service URL, and a two-pass Canvas LTI bootstrap. Follow the exact commands in [Deployment](docs/deployment.md); a bare build submission is only sufficient after those resources exist.

The same container is portable to a conventional VPS or any platform that provides PostgreSQL 17+, HTTPS ingress, secret injection, a migration job, and scheduled cleanup.

## Quick Start With Docker Compose

Build a versioned image and create a private environment file:

```bash
docker build -t safe-online-exam:local .
cp .env.compose.example .env
chmod 600 .env
mkdir -p secrets
```

Set real Canvas/LTI values and strong secrets in `.env`, place the public SEB encryption certificate at `secrets/seb-config-encryption.crt.pem`, then start the stack:

```bash
APP_IMAGE=safe-online-exam:local docker compose up -d --wait
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
```

Compose runs schema migrations before the app and stores PostgreSQL data in the `postgres_data` volume. It binds only to loopback by default. Put a TLS reverse proxy in front before exposing the service to Canvas; production `TOOL_URL` must be HTTPS.

For a hardened host where application secrets must be mounted as files, use [.env.compose.secrets.example](.env.compose.secrets.example) and the override:

```bash
docker compose --env-file .env.secrets -f compose.yaml -f compose.secrets.yaml up -d --wait
```

## Local Development

```bash
npm ci
npm run verify
npm run verify:postgres
npm run test:e2e
```

For a route/UI smoke server that does not connect to Canvas or PostgreSQL:

```bash
npm run build
HOST=127.0.0.1 USE_IN_MEMORY_STORE=true TOOL_URL=http://localhost:8080 \
  LTI_CLIENT_ID=test-client CANVAS_API_CLIENT_ID=test \
  CANVAS_API_CLIENT_SECRET=test npm start
```

The application does not load `.env` automatically. Export values, use a process manager, or use the Compose `env_file`. See [.env.example](.env.example) and [.env.compose.example](.env.compose.example).

## Core Commands

| Command                                               | Purpose                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run verify`                                      | Typecheck, lint, format check, coverage tests, and production build.    |
| `npm run verify:postgres`                             | Run migrations and repository concurrency tests against PostgreSQL 17.  |
| `npm run test:e2e`                                    | Run Playwright desktop/mobile app-shell tests.                          |
| `npm run db:migrate`                                  | Apply checked, forward-only PostgreSQL schema migrations.               |
| `npm run db:cleanup`                                  | Drain expired sessions, transient state, and locks in bounded batches.  |
| `npm run db:reset:gcloud:dev -- --project PROJECT_ID` | Interactively destroy and recreate only the maintained dev database.    |
| `npm run migrate:exam-tools -- --dry-run`             | Preview the course exam-tool catalog migration.                         |
| `npm run generate:lti-key`                            | Generate an RSA private JWK for `LTI_PRIVATE_KEY`.                      |
| `bash scripts/compose-smoke.sh`                       | Build and verify the full Compose migration/readiness/persistence path. |

## Public Contracts

These routes must stay stable unless Canvas and managed clients are updated together:

- `GET /lti/config`
- `GET|POST /lti/login`
- `GET|POST /lti/launch`
- `GET /.well-known/jwks.json`
- `GET /health` and `GET /ready`
- `GET /js/canvas-seb-detector.js`
- `GET /js/canvas-seb-theme-loader.js`
- `GET /api/seb/canvas-detector.js`
- `GET /api/oauth2callback`
- `GET /seb/config/:courseId/:contentId.seb`

Classic Quiz content IDs are `classicquiz_{quizId}`. New Quiz content IDs are `newquiz:{courseId}:{assignmentId}`.

## Security Notes

- Production requires HTTPS, a real LTI deployment ID, PostgreSQL, independent session/state secrets, and a valid end-entity X.509 encryption certificate.
- Use `*_FILE` inputs or a secret manager for secret values. Never commit `.env`, private keys, `.p12`, or database dumps.
- The matching SEB configuration private identity belongs only on managed clients, never in the server image or runtime.
- The app refuses `USE_IN_MEMORY_STORE=true`, debug mode, unsafe URLs, and disabled configuration encryption in hardened runtimes.
- Relevant settings changes invalidate downloaded configurations; require a fresh `.seb` file.

## License And Commercial Use

Safe Online Exam is source-available under the [PolyForm Noncommercial
License 1.0.0](LICENSE), not an OSI-approved open-source license. Eligible
educational institutions may self-host and modify the software for their own
use without purchasing a commercial license.

Commercial managed hosting, installation, implementation, support, resale,
and competing hosted services are reserved for separately licensed use. See
[Commercial licensing](COMMERCIAL-LICENSE.md), [third-party notices](THIRD-PARTY-NOTICES.md),
[contributing](CONTRIBUTING.md), and [trademark guidance](TRADEMARKS.md).
