# Canvas Safe Exam Browser LTI

Canvas Safe Exam Browser LTI connects Canvas LMS assessments to [Safe Exam Browser (SEB)](https://safeexambrowser.org/). Instructors manage SEB requirements from a Canvas course-navigation placement; students download a configuration that returns them to Canvas in SEB and releases the Canvas access code only after Config Key proof succeeds.

The application supports Canvas LTI 1.3, Classic Quizzes, New Quizzes, Canvas OAuth, generated `.seb` files, Config Key proof, protected Canvas session handoff, and approved web-based exam tools.

## What It Does

- Lets instructors refresh Canvas assessment data and enable or disable SEB for Classic Quizzes and New Quizzes.
- Sets and rotates Canvas assessment access codes without exposing them in routine UI or API responses.
- Generates certificate-encrypted SEB configurations with optional start and exit passwords.
- Sends students through a scoped Canvas session handoff so SEB can reach Canvas without copying their normal-browser cookies.
- Uses the SEB JavaScript API and a short-lived, one-time server proof before returning an access code, approved tool list, or exit capability.
- Provides a Canvas detector script for quiz-page launch, access-code entry, approved-tool UI, and post-submission exit handling.

A deployment connects to one Canvas tenant and one environment. Use a separate service, Firestore database, secrets, and LTI deployment for each tenant or environment that must be isolated.

## Documentation

Start with the guide matching your role:

| Guide                                                    | Use it for                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                     | Runtime design, trust boundaries, data model, route contracts, and security controls.                            |
| [Canvas setup](docs/canvas-setup.md)                     | Creating the LTI registration, installing it in Canvas, authorizing API access, and loading the detector script. |
| [Configuration](docs/configuration.md)                   | Environment variables, secrets, validation rules, local setup, and configuration values.                         |
| [Deployment](docs/deployment.md)                         | Cloud Run and Firestore provisioning, Cloud Build, IAM, TTL, releases, and verification.                         |
| [Certificate management](docs/certificate-management.md) | Creating, distributing, rotating, and validating SEB configuration-encryption identities.                        |
| [Testing](docs/testing.md)                               | Automated checks, browser smoke tests, and the manual Canvas/SEB acceptance sequence.                            |

The public `/setup` and `/setup/guide` pages are a concise handoff for Canvas administrators, instructors, and students. They do not replace the deployment or Canvas-side verification steps in the guides above.

## Architecture At A Glance

```text
Canvas LTI 1.3 ──────> NestJS service ──────> Firestore
      │                     │                    │
      │                     ├─ React app shell    ├─ assessment and course settings
      │                     ├─ Canvas OAuth       ├─ OAuth tokens and sessions
      │                     └─ SEB configuration  └─ one-time state and locks
      │
      └─ Canvas theme loader ──> detector script ──> SEB proof/access-code flow
```

- Backend: NestJS 11 on Express under `src/server`.
- Frontend: React 19 and Vite under `src/client`.
- Shared domain types: `src/shared`.
- Persistence: Google Cloud Firestore; an in-memory repository is available only for local development and tests.
- Deployment target: Node.js 24 on Cloud Run Gen2.

## Repository Layout

```text
src/
  client/              React views and styles
  server/
    assets/            Canvas detector source asset
    config/            environment-backed application configuration
    controllers/       HTTP and LTI endpoints
    data/              Firestore and in-memory repositories
    http/              app shell, request integrity, response, and header helpers
    security/          LTI principal, browser binding, and admission controls
    services/          Canvas, LTI, assessment, and SEB behavior
  shared/              shared TypeScript models and policy normalization
scripts/               build, deployment, certificate, and migration utilities
test/
  e2e/                 Playwright app-shell smoke tests
  server/              Vitest unit, service, controller, and regression tests
docs/                  operational and integration documentation
```

## Local Development

Install the pinned dependency set:

```bash
npm ci
```

Run the standard non-browser verification gate:

```bash
npm run verify
```

Run the complete local gate, including Playwright:

```bash
npm run verify:e2e
```

Run a built local server with the in-memory store:

```bash
npm run build
HOST=127.0.0.1 \
USE_IN_MEMORY_STORE=true \
TOOL_URL=http://localhost:8080 \
LTI_CLIENT_ID=test-client \
CANVAS_API_CLIENT_ID=test \
CANVAS_API_CLIENT_SECRET=test \
npm start
```

Then open `http://127.0.0.1:8080/health`. The local command is a UI and route smoke environment; it does not perform a real Canvas or SEB flow.

For iteration, run `npm run dev` for the backend or `npm run dev:client` for the Vite client. The application does not load `.env` files itself; export values in your shell or use an environment loader outside the application. `.env.example` is the reference template.

## Core Commands

| Command                                               | Purpose                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run typecheck`                                   | Type-check server and client projects.                                                    |
| `npm run lint`                                        | Run ESLint.                                                                               |
| `npm run format:check`                                | Verify Prettier formatting.                                                               |
| `npm run test:coverage`                               | Run the Vitest suite with coverage thresholds.                                            |
| `npm run build`                                       | Build the React client and NestJS server; copies and minifies server assets.              |
| `npm run test:e2e`                                    | Build, start a local in-memory server, and run Playwright in desktop and mobile projects. |
| `npm run migrate:exam-tools -- --dry-run`             | Preview course exam-tool catalog migration.                                               |
| `npm run migrate:exam-tools -- --apply`               | Apply the reviewed exam-tool catalog migration.                                           |
| `npm run security:purge-new-quiz-metadata`            | Preview removal of raw New Quiz metadata from Firestore.                                  |
| `npm run security:purge-new-quiz-metadata -- --apply` | Apply that targeted metadata cleanup.                                                     |
| `npm run generate:lti-key`                            | Generate an RSA private JWK for `LTI_PRIVATE_KEY`.                                        |

## Public Contracts

These paths are integration contracts and should remain stable unless Canvas registration and client configuration are updated together:

- LTI registration: `GET /lti/config`
- LTI login and launch: `GET|POST /lti/login`, `GET|POST /lti/launch`
- Public signing keys: `GET /.well-known/jwks.json`
- Health: `GET /health`
- Detector script: `GET /js/canvas-seb-detector.js`
- Detector compatibility alias: `GET /api/seb/canvas-detector.js`
- Canvas OAuth callback: `GET /api/oauth2callback`

Classic Quiz content IDs are `classicquiz_{quizId}`. New Quiz content IDs are `newquiz:{courseId}:{assignmentId}`. See the route reference in [Architecture](docs/architecture.md) before integrating with any other endpoint.

## Security And Operations Notes

- Production and Cloud Run require an HTTPS `TOOL_URL`, a configured LTI deployment ID, independent session and state-encryption secrets, Firestore, and certificate encryption with a valid X.509 public certificate.
- Never place the SEB configuration private key or `.p12` identity in Cloud Run, a repository, logs, command arguments, or a student-controlled device workflow. See [Certificate management](docs/certificate-management.md).
- `USE_IN_MEMORY_STORE=true` is local/test only. The service refuses it on Cloud Run.
- Existing downloaded configurations are intentionally invalidated by relevant settings changes. Students must download a fresh `.seb` file after a change to the protected configuration.
- Cloud Build invokes the Dockerfile, which owns install, verification, build, production-prune, and runtime assembly. Playwright remains an explicit separate check.

## License And Contribution

Keep changes focused on Canvas and SEB compatibility, stable public routes, and the security properties documented in [Architecture](docs/architecture.md). Update the relevant guide and tests whenever a change affects routes, configuration, deployment, generated `.seb` behavior, or an operational procedure.
