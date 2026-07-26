# Testing And Acceptance

Testing is layered because the critical path crosses server code, Canvas, and a native SEB client. Automated tests protect application contracts; a real Canvas/SEB acceptance run protects the integration boundaries that cannot be reproduced fully in a unit test.

## Automated Checks

Install dependencies once:

```bash
npm ci
```

Run individual gates when iterating:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
```

Run the standard non-browser gate:

```bash
npm run verify
```

Run the full local gate:

```bash
npm run verify
npm run verify:postgres
npm run test:e2e
```

`npm run verify` first checks release metadata consistency, then runs type checking, linting, Prettier verification, Vitest coverage tests, and the production build. `npm run verify:postgres` starts PostgreSQL 17, applies migrations in isolated schemas, and runs repository atomicity/concurrency tests. The deploy pipeline runs both layers before promotion.

GitHub Actions runs those two layers plus the Compose smoke test for every pull request and push to `main`. Pull requests also run GitHub's dependency review and reject newly introduced vulnerabilities of moderate severity or higher. CI uses the pinned Ubuntu 24.04 runner and Node 24—the same supported major runtime as the production container—with npm and BuildKit caching. The Compose job builds once through Buildx and passes that image into the smoke script rather than rebuilding it. This CI workflow has no cloud credentials and does not publish images or deploy services. The repository ruleset requires signed commits, its application, PostgreSQL, Compose, dependency-review, and aggregate CodeQL checks before merge. The aggregate check remains available when CodeQL legitimately skips individual language matrices for lockfile-only changes. Dependabot opens independently reviewable weekly update PRs for npm packages and lockfile state, immutable action pins, Dockerfile images, and Compose images. Minor and patch updates are grouped by ecosystem or framework; runtime, Node declarations, TypeScript, and database major upgrades remain explicit migrations.

Verify the production topology separately:

```bash
bash scripts/compose-smoke.sh
```

By default that smoke builds the exact runtime image. CI and release callers can instead supply `COMPOSE_SMOKE_IMAGE` with `COMPOSE_SMOKE_SKIP_BUILD=true` to test an already-built image. The script waits for the migration/app readiness gates, probes the public health, JWKS, LTI metadata, and detector routes, writes a safe row, restarts the app, and confirms the named PostgreSQL volume retained it.

## Release Pipeline Checks

Publishing a release requires only pushing a `vX.Y.Z` tag whose version matches the synchronized release metadata and whose commit is on `main`. The workflow waits for that exact commit's already-required application, PostgreSQL, Compose, and CodeQL checks. It then creates or refreshes a draft, builds a staged `linux/amd64` and `linux/arm64` manifest, smokes that exact digest, publishes its SBOM, provenance, and artifact attestation, attaches a digest-pinned Compose bundle and checksum, promotes the final image tags, and publishes the immutable draft.

The multi-architecture Docker build runs the full typecheck, lint, format, coverage, and build gate once on BuildKit's native build platform. It installs production dependencies separately for each target platform before assembling the matching distroless runtime image. Persistent BuildKit caches reuse verified dependency layers across CI and release runs without making cache contents a trust decision; BuildKit still invalidates changed inputs and executes uncached gates. Timing-sensitive application tests never run through QEMU emulation.

The workflow verifies both architectures, their source/version OCI labels, every promoted tag, the artifact attestation, and GitHub release immutability before reporting success. Before a Cloud Run promotion, use the release digest with `cloudbuild-release-promote.yaml` against development, then confirm its migration execution, cleanup job, service image, `/health`, `/ready`, JWKS, LTI metadata, and detector assets.

## Test Coverage By Layer

| Layer                                  | Location                                                    | What it protects                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared domain policy                   | `test/server/models.test.ts` and related tests              | Content IDs, roles, URL-rule/tool normalization, course defaults, and password-state behavior.                                                                                                                          |
| Configuration and deployment artifacts | `app-config.test.ts`, `deployment-hardening-static.test.ts` | Runtime validation, public/private artifact handling, image-digest deployment, and documentation-backed deployment invariants.                                                                                          |
| LTI and OAuth                          | LTI/OAuth controller and service tests                      | Signed-claim validation, browser binding, state replay prevention, role routing, OAuth state binding, cross-site initiation rejection, non-privileged callback completion, scope-profile upgrades, and token ownership. |
| Account administration                 | `admin-dashboard.test.ts` and action-token tests            | Root-account/course binding, administrator request integrity, split resource loading, recovery actions, course connection, and durable bulk rollout.                                                                    |
| Persistence and concurrency            | repository/session/assessment and PostgreSQL tests          | Atomic claims, one-time consumption, cleanup, session storage, distributed locks, and Canvas/database consistency.                                                                                                      |
| SEB configuration and proof            | `seb-*.test.ts`                                             | Plist generation, encryption, Config Key validation, configuration grants, proof redemption, handoff records, exit grants, and password rules.                                                                          |
| Detector                               | `canvas-seb-detector-script.test.ts`, static-asset tests    | Loading, Canvas route handling, access-code flow, approved tools, completion detection, exit behavior, and stable detector/theme-loader paths.                                                                          |
| Browser app shell                      | `test/e2e/app-shell.spec.ts`                                | Built server startup, public metadata routes, React routes, desktop/mobile rendering, and browser console errors.                                                                                                       |

Do not rely on a high coverage percentage alone. The most sensitive assurance is that a test exercises the same trust boundary it claims to protect: signed LTI data for identity, server proof for access-code release, and Canvas-authored completion for exit behavior.

## Playwright Smoke Tests

`npm run test:e2e` builds the application and starts it locally with:

- `USE_IN_MEMORY_STORE=true`
- `TOOL_URL=http://localhost:8080`
- test-only LTI and Canvas API values

It runs Chromium in desktop and mobile projects. It confirms public health/JWKS/LTI metadata, detector availability on both supported URLs, selected React app-shell behavior, and error-free page rendering. It does not contact Canvas or start a native SEB client.

If Chromium is not installed, add the Playwright-managed browser before retrying:

```bash
npx playwright install chromium
```

On a disposable Linux CI host that also needs system packages, use `npx playwright install --with-deps chromium`. Keep the e2e command separate from deploy builds unless the CI environment is explicitly configured for browser execution.

## Fresh Development Database Test

When a feature must be tested from a completely empty Google Cloud development database, first create an on-demand Cloud SQL backup if the current state may be needed, then run the guarded reset command:

```bash
npm run db:reset:gcloud:dev -- --project PROJECT_ID
```

Read and confirm the displayed project, instance, and database before accepting the prompt. The command is dev-only and permanently destroys all records in that database before recreating it and applying migrations. Never automate it, use it in CI, or run it against production. After reset, verify `/ready`, complete Canvas OAuth again, refresh assessments, and exercise the clean-install workflow under test.

## Local Production-Build Smoke Run

Use this after `npm run build` when diagnosing the deployed runtime shape:

```bash
HOST=127.0.0.1 \
USE_IN_MEMORY_STORE=true \
TOOL_URL=http://localhost:8080 \
LTI_CLIENT_ID=test-client \
CANVAS_API_CLIENT_ID=test \
CANVAS_API_CLIENT_SECRET=test \
npm start
```

Then verify:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/.well-known/jwks.json
curl -fsS http://127.0.0.1:8080/lti/config
curl -fsS http://127.0.0.1:8080/js/canvas-seb-detector.js | head
```

This mode cannot validate Canvas OAuth, PostgreSQL, certificate decryption, or SEB runtime behavior.

## Canvas And SEB Acceptance Sequence

Run this sequence after a deployment that affects authentication, Canvas interaction, settings, configuration generation, the detector, certificate material, or exit behavior. Use separate administrator, instructor, and student accounts.

### Administrator

1. Confirm `/health`, `/lti/config`, JWKS, and detector endpoints on the deployed URL.
2. Confirm Canvas stores the current LTI client ID, deployment ID, login URL, target link URI, and JWKS URL from `/lti/config`.
3. Confirm the API OAuth key has the complete application and administrator scope set, including the exact session-token scope, described in [Canvas setup](canvas-setup.md).
4. Open **Safe Online Exam Admin** from root-account navigation and complete its separate OAuth authorization.
5. Confirm only Canvas-authorized root-account courses appear. Create and assign a school tool preset; refresh one test course; reveal a password and verify it disappears automatically; rotate the course exit password; reset one assessment exit password; rotate its code; toggle SEB; and verify the secret-free activity records.
6. Repeat the launch as an instructor, sub-account administrator, and student and confirm the root-account dashboard is denied.
7. Confirm the active Canvas theme loads the detector asset on a Classic Quiz `/take` page and a New Quiz assignment route.
8. Confirm the client certificate profile is installed on an approved test device and the active public-key hash matches the service.

### Instructor

1. Launch the tool from a Canvas course and complete or re-run Canvas OAuth.
2. Refresh the course. Confirm it finds the intended published Classic Quiz and New Quiz data.
3. Configure a valid effective exit password, optional start password, selected course tools, one quiz-only tool, and narrow URL rules. Confirm the quiz-only tool does not appear in another assessment or in course defaults.
4. Save one instructor-owned course tool, use **Duplicate to courses**, and select a second active course where the same user is a teacher. Confirm the target receives the full launch/resource policy without replacing its existing tools; retry once and confirm it reports that the equivalent tool is already present. Confirm a non-teacher or the source course cannot be submitted as a target, and that a school-managed preset has no duplicate action.
5. Enable one Classic Quiz and one New Quiz. Confirm Canvas requires an access code and the management response does not reveal it.
6. Change one protected setting, confirm the previous configuration becomes unsuitable for proof, and download a fresh configuration.
7. Disable each assessment and confirm Canvas access-code protection is removed only through the intended action.

### Student In A Normal Browser

1. Launch the course-navigation placement and complete the one-time Canvas connection.
2. Run the optional setup check. Test a missing/revoked scope path and confirm the recovery path requests a new Canvas connection.
3. Open each enabled assessment. Confirm the ordinary browser presents the protected launch/download flow rather than an access-code value.
4. Confirm the detector’s launch UI is available on the Canvas assessment route and approved tools are not exposed before a valid SEB proof.

### Student In SEB

1. Start from an SEB client with no usable Canvas browser session, open a fresh configuration, and verify it reaches Canvas through the generated session URL.
2. Confirm the encrypted configuration opens only on a client with the managed private identity. Run the setup-check configuration first when validating a new client/profile.
3. For Classic Quiz and New Quiz, verify Config Key proof succeeds, the correct access-code prompt is filled once, and the assessment becomes available.
4. Confirm disabled tools are unavailable; confirm each selected tool opens only its intended launch/resources and returning to Canvas preserves the assessment flow.
5. Cancel a final Canvas confirmation. Verify no submission exit begins.
6. Submit successfully. Verify Classic Quiz exit waits for Canvas’s completed-submission result and New Quiz exit waits for its authoritative result UI.
7. Verify the validated quit action works after completion and native early quit still follows the configured password policy.

## Regression Checklist

Before merge or release, ensure all applicable items are true:

- `npm run verify`, `npm run verify:postgres`, and the relevant Compose/Playwright checks pass.
- Public LTI, JWKS, health, detector, and Canvas OAuth callback URLs are unchanged or Canvas configuration has been updated intentionally.
- A settings change has tests showing stale configuration/proof behavior is rejected.
- Instructor and learner roles cannot reach each other’s privileged endpoints or UI paths.
- Classic Quiz and New Quiz are both exercised when changing common assessment, configuration, or detector code.
- The current certificate, configuration encryption, Config Key proof, student session handoff, start password, exit password, and URL-tool policy work together on supported client devices.
- The browser console is clean on desktop and mobile app-shell routes.
- The release uses the intended immutable image digest, runtime service account, PostgreSQL database, numbered secret versions, and public service URL.

## Test Data And Safety

Use isolated Canvas courses and non-sensitive test accounts. Do not paste actual access codes, OAuth tokens, session URLs, private keys, `.p12` files, or password values into test fixtures, snapshots, shell history, or issue reports. Clear temporary client configuration files and test assessment data according to the environment’s retention policy.
