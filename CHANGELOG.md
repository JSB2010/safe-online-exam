# Changelog

This file records the user-visible changes in each stable Safe Online Exam
release.

## [Unreleased]

## [1.0.7] - 2026-08-17

Safe Online Exam 1.0.7 is a backward-compatible Canvas detector compatibility
hotfix. It adds no database migration, OAuth scope, LTI registration URL, or
public compatibility endpoint.

### Sharded Canvas installations

- Recognize a Canvas External Tools API Developer Key ID when Canvas returns
  the shard-local form of the globally qualified LTI client ID.
- Preserve exact client-ID matching and continue rejecting malformed, zero,
  or unrelated IDs while retaining the existing LTI version and deployment-ID
  checks.

## [1.0.6] - 2026-08-12

Safe Online Exam 1.0.6 is a backward-compatible Canvas detector hotfix. It
adds no database migration, OAuth scope, LTI registration URL, or public
compatibility endpoint.

### Hidden course navigation

- Keep protected Classic Quiz and New Quiz launches working when a school
  hides the Safe Online Exam course-navigation item from students.
- Resolve the installed LTI 1.3 tool through Canvas's same-origin External
  Tools API, matching the service's configured client and deployment IDs
  before constructing the signed assessment launch, following bounded Canvas
  pagination and honoring self-service deployment-ID checking mode.
- Use the rendered course-navigation link as a compatibility fallback when the
  Canvas lookup is unavailable.
- Show actionable reload and administrator guidance if Canvas cannot resolve
  the expected installation instead of sending the student to the course home
  without launching Safe Online Exam.

## [1.0.5] - 2026-08-06

Safe Online Exam 1.0.5 is a backward-compatible Canvas authorization and
administrator course-list release. It adds PostgreSQL migration 6 for
root-account operational-term preferences and one administrator-only Canvas
OAuth scope. It does not change Canvas LTI registration URLs, the OAuth
callback URL, or public SEB compatibility endpoints.

### Canvas authorization

- Request and document the individual Classic Quiz read scope used by the
  administrator reset preflight so Canvas can snapshot every current access
  code before any reset mutation begins.
- Keep the new capability administrator-only; ordinary instructor and student
  OAuth scope contracts remain unchanged.

### Administrator course terms

- Persist one shared operational enrollment term per Canvas root account and
  use it across browsers, administrators, reloads, the configured-course list,
  summary counts, and the course connection picker.
- Hide concluded courses and courses outside the operational term by default,
  while retaining every historical connection in a **Show past and other
  courses** view.
- Reconcile stored Canvas course status in bounded batches and refresh it
  immediately when a course is connected or manually refreshed.

## [1.0.4] - 2026-08-05

Safe Online Exam 1.0.4 is a backward-compatible instructor-validation,
administrator-recovery, and upgrade-reliability release. It adds no database
migration and does not change existing Canvas LTI registration URLs, OAuth
callback URLs, required Canvas scopes, or public SEB compatibility endpoints.

### Instructor setup and settings validation

- Show a live password-requirement checklist while instructors enter course or
  assessment start and exit passwords, with clear completed states and gentle
  transitions.
- Use the same shared password-policy implementation in the browser and server
  so instructors see the exact rules that the saved value must satisfy.
- Validate each guided-setup step before advancing, including incomplete exam
  tools, and validate course and assessment settings before sending a save.
- Replace generic instructor request failures with actionable password, URL,
  exam-tool, stale-setting, authorization, rate-limit, and connection guidance
  while retaining bounded safe details from validation responses.
- Keep the guided setup progress readable at mobile Canvas widths.

### Administrator course reset

- Add an administrator-only, exact-course-ID-confirmed reset for rebuilding a
  connected course's Safe Online Exam setup without replacing or deleting any
  Canvas OAuth grant.
- Discover both Classic Quizzes and New Quizzes strictly, snapshot every current
  Canvas access-code state before the first mutation, remove every current code,
  and delete the local course, assessment, outstanding course-grant, and
  school-tool assignment state only after every Canvas mutation succeeds.
- Serialize resets, refreshes, connection counts, preset assignment writes, and
  assessment mutations with course and assessment leases; restore the exact
  pre-reset Canvas state for completed or ambiguously reported changes and the
  prior local assessment state when a reset step fails; report indeterminate
  rollback failures precisely; retain the
  administrator course connection, and show guided setup on the next instructor
  launch.

### Deployment and dependencies

- Keep the `gcloud` traffic-update summary out of the captured deployment
  revision so upgrade output and protected rollback metadata contain one clean
  revision name.
- Update `undici` to 7.29.0 through the npm security dependency group.

## [1.0.3] - 2026-08-03

Safe Online Exam 1.0.3 is a backward-compatible Canvas detector and Cloud Run
upgrade-reliability release. It adds no database migration and does not change
existing Canvas LTI registration URLs, OAuth callback URLs, required Canvas
scopes, or established SEB compatibility endpoints. It adds one secret-free
public requirement-status endpoint used by the Canvas detector.

### Canvas detector accuracy

- Verify the exact stored course and assessment setting before showing the
  Safe Online Exam launch prompt, instead of treating every Canvas access-code
  field as proof that the assessment is managed by Safe Online Exam.
- Add `GET /api/seb/requirement/:courseId/:quizId` as a bounded, rate-limited
  lookup that reports a requirement only when the assessment relationship and
  enabled SEB configuration are complete and usable.
- Fail safely when requirement verification is absent, malformed, mismatched,
  disabled, rate limited, or unavailable, allowing ordinary password-protected
  Canvas quizzes to continue without a false Safe Online Exam redirect.
- Coalesce repeated detector and server checks with short bounded caches while
  rechecking the current Canvas assessment context before prompting.

### Cloud Run upgrade and rollback reliability

- Wait for the on-demand Cloud SQL backup operation to finish and require a
  `SUCCESSFUL` backup before migrations or application traffic changes.
- Support installations whose generated Cloud Run URL is disabled: validate
  the configured custom origin, temporarily enable the generated URL for the
  tagged no-traffic candidate, verify readiness and JWKS, cut over explicitly,
  then restore the disabled-URL policy.
- Restore the generated-URL policy through guarded failure cleanup so an
  interrupted or rejected candidate does not leave the installation in the
  wrong exposure state.
- Make readiness and JWKS probe failures propagate reliably, and verify the
  configured custom origin after both upgrade and rollback.
- Keep portable bundle examples tenant-neutral and exclude ignored local
  operator state from lint discovery.

### Dependency and release maintenance

- Update `jose` to 6.2.5 and `lucide-react` to 1.27.0.
- Update Playwright to 1.62.0, ESLint to 10.8.0,
  `typescript-eslint` to 8.65.0, `@vitejs/plugin-react` to 6.0.5, and related
  React and PostgreSQL type packages.
- Refresh the transitive `minimatch`, `brace-expansion`, and PostCSS build
  dependencies to their advisory-fixed releases.
- Update the pinned GHCR login and GitHub artifact-attestation actions while
  retaining immutable SHA pinning.

## [1.0.2] - 2026-08-01

Safe Online Exam 1.0.2 is a backward-compatible instructor-usability and
deployment-hardening release. It adds no database migration and does not change
Canvas LTI registration URLs, OAuth callback URLs, required Canvas scopes, or
public SEB compatibility endpoints.

### Instructor setup and assessment settings

- Start first-time course setup with a concise welcome, then guide instructors
  through the course exit-password policy, optional exam tools, and their first
  protected assessment.
- Keep generic URL rules in **Advanced website access** for course and
  assessment settings, steering routine resource setup toward reviewed exam
  tools and leaving URL rules available when they are genuinely required.
- Clarify the quiz-specific exit-password override and that instructors can
  return to course or assessment settings after onboarding.

### Cloud Run deployment reliability

- Generate file-backed bootstrap secrets without terminal line endings and
  reject password files containing carriage returns or newlines before Cloud
  SQL or Secret Manager can receive mismatched values.
- Wait explicitly for Cloud SQL Admin API propagation and for a requested
  Cloud SQL instance to become `RUNNABLE`, with bounded, readable retries.
- Make candidate URL verification safe under macOS Bash strict mode by issuing
  public and private curl requests through explicit branches.
- Reject temporary bootstrap, client-identity, and deployment-state locations
  so installer state and the SEB P12 cannot be lost to an operating-system
  cleanup policy.
- Detect expired `gcloud` credentials during the preflight check rather than
  failing later in provisioning.

### Custom-domain and Canvas readiness

- Add an opt-in Cloud Run domain-mapping helper that reports the DNS records
  and readiness state without mutating external DNS.
- Generate an exact Canvas Theme Desktop loader for the configured custom
  origin, avoiding stale detector-script URLs in protected quizzes.
- Permit disabling Cloud Run's generated default URL only after LTI
  finalization has verified the configured custom origin; the operation is
  idempotent and re-verifies the custom origin afterwards.

### Documentation and verification

- Document the first production setup's recoverable failures, operational
  handoffs, and one-year Cloud SQL commitment limitation.
- Cover the hardened bundle paths with release-bundle tests, including the
  Cloud SQL propagation wait, newline-free secret generation, macOS public
  verification, default-URL idempotence, Canvas loader rendering, and durable
  state enforcement.

## [1.0.1] - 2026-07-27

Safe Online Exam 1.0.1 is a backward-compatible security, deployment, and
release-engineering update. It closes a privileged OAuth callback-resume path,
returns users to an existing signed LTI session through a constrained popup
handshake, and completes the supported Cloud Run and Docker Compose operator
bundles.

This release adds no database migration and does not change the Canvas LTI
registration URLs, OAuth callback URL, required Canvas scopes, or public SEB
compatibility endpoints.

### Canvas authorization and security

- Require instructor, student, and administrator Canvas authorization to start
  from the application's own origin, rejecting explicitly cross-site
  navigation attempts.
- Stop OAuth callbacks from resuming or rendering privileged instructor and
  administrator views. Successful callbacks now end on a non-privileged
  completion screen, and management access still requires the original signed
  LTI launch.
- Open Canvas authorization in a popup while preserving the signed LTI page,
  then return that page to its role-appropriate workspace only after an
  exact-origin, exact-window completion message and two-way acknowledgement.
- Sanitize OAuth and student-session navigation targets to same-origin paths,
  reject network-path and cross-origin values, and retain a safe completion
  screen when popups or opener acknowledgement are unavailable.
- Harden root-account course query parsing so repeated, malformed, or
  non-scalar search, pagination, term, and limit values fall back safely.

### Deployment and upgrades

- Add checksum-protected, source-free Cloud Run and Docker Compose release
  bundles, each with a guided top-level installer and an explicit unattended
  file-based interface.
- Add Cloud Run preflight, preparation, secret bootstrap, first-install,
  two-pass Canvas registration, finalization, upgrade, and guarded rollback
  commands using plain `gcloud`, `docker`, `jq`, `openssl`, and `curl`.
- Pin exact Secret Manager versions, run migrations before application traffic
  changes, schedule bounded cleanup, verify Cloud SQL backups, stage
  zero-traffic revisions, and require an explicit verified traffic cutover.
- Add an interactive Cloud SQL profile chooser with a cost-conscious dedicated
  zonal default, optional high-availability and capacity profiles, connector
  enforcement, backups, point-in-time recovery, deletion protection, and
  opt-in resource creation.
- Add verified Compose backup and upgrade helpers that preserve protected
  secret files and the PostgreSQL volume before pulling or restarting the
  application.
- Document and propagate the per-instance
  `SEB_CONFIG_ENCRYPTION_ENABLED=false` compatibility mode while retaining
  start-password wrapping, Config Key proof, grants, lockdown behavior, and
  certificate encryption as the secure default.

### Release engineering and supply chain

- Replace manual publication with a one-tag workflow that first proves the
  tagged commit is on `main` using read-only permissions, waits for that exact
  commit's application, PostgreSQL, Compose, and CodeQL checks, and only then
  grants publication credentials.
- Build and smoke the exact staged `linux/amd64` and `linux/arm64` image before
  promoting the `1.0.1`, `1.0`, `1`, and `latest` aliases to one verified
  digest.
- Publish the completed GitHub Release as immutable only after generating the
  final digest-specific notes, provenance, SBOM, GitHub attestation, Compose
  and Cloud Run archives, and SHA-256 checksum files.
- Add idempotent draft recovery, final-tag and image-label verification,
  persistent BuildKit caching, immutable action SHA pins, and the
  `npm run release:check` metadata-consistency gate.
- Verify immutability from the final published release record instead of
  requiring the read-only workflow token to call GitHub's administration-only
  repository-settings endpoint.
- Add a reproducible protected-`main` ruleset with pull requests, signed final
  commits, required application/PostgreSQL/Compose/CodeQL checks, dependency
  review, and narrowly scoped automatic merging for eligible Dependabot npm
  patch updates.
- Pin the Node.js 24 build/runtime, PostgreSQL 17, and Caddy base images by
  digest while retaining reviewable automated update coverage for npm,
  GitHub Actions, Dockerfiles, and Compose.

### Documentation

- Reorganized the public documentation around evaluators, deployers, Canvas
  administrators, instructors, students, support staff, contributors, and
  release maintainers.
- Added a documentation hub, role-based user guide, and symptom-driven
  troubleshooting guide.
- Replaced the duplicated deployment monolith with a mode-selection and
  operations guide while keeping the Compose and Cloud Run bundle manuals
  self-contained.
- Revalidated public routes, OAuth scopes, runtime variables, PostgreSQL
  schema, certificate behavior, deployment workflows, test gates, and release
  behavior against the implementation.
- Clarified that `/lti/config` is Canvas’s JSON configuration URL rather than
  the separate OpenID Dynamic Registration protocol, and documented the
  Compose two-pass Canvas bootstrap.

### Dependency maintenance

- Update React and React DOM to 19.2.8, `jose` to 6.2.4, `lucide-react` to
  1.25.0, `@vitejs/plugin-react` to 6.0.4, Prettier to 3.9.6, and Caddy to the
  2.11 release line.

## [1.0.0] - 2026-07-25

Safe Online Exam 1.0.0 is the first stable public release.

### Canvas integration

- Added Canvas LTI 1.3 course and root-account placements with verified role,
  deployment, account, and course authorization.
- Added Classic Quiz and New Quiz discovery, configuration, enable, disable,
  regenerate, and status workflows.
- Added Canvas OAuth setup and reconnection flows for instructors and
  administrators, including the scopes required for cross-course exam-tool
  copying.
- Added a root-account operations dashboard for connected courses, assessment
  state, password recovery, active-course discovery, and reusable school tool
  presets.

### Safe Exam Browser

- Added certificate-encrypted `.seb` configuration generation with supported
  macOS and Windows kiosk policy, optional start passwords, and protected exit
  flows.
- Added Config Key proof and one-time access-code release so Canvas assessment
  access is granted only for the current server-generated configuration.
- Added scoped Canvas session handoff into SEB and approved web-tool access
  without copying normal-browser session cookies.
- Added the Canvas detector script and its public compatibility endpoint, plus
  readiness and installation-recovery flows.

### Deployment and operations

- Added PostgreSQL-backed settings, OAuth tokens, sessions, transient claims,
  admission budgets, and distributed locks with checked forward-only
  migrations and bounded cleanup.
- Added production-ready Node.js 24 container packaging, Docker Compose with
  PostgreSQL 17, optional Caddy HTTPS, and a bootstrap workflow for protected
  runtime secrets and client-only SEB identity material.
- Added Google Cloud Run and Cloud SQL deployment workflows with migration and
  cleanup jobs.
- Added a public release workflow that verifies the application, PostgreSQL
  integration, and Compose topology before publishing `linux/amd64` and
  `linux/arm64` images to GHCR with provenance, an SBOM, an attestation, and a
  digest-pinned Compose bundle.

### Security and project policy

- Added hardened production configuration checks, signed LTI launch
  validation, same-origin request integrity, bounded upstream responses, and
  fail-closed assessment authorization.
- Added unit, coverage, PostgreSQL integration, browser smoke, and full
  production Compose verification paths.
- Published the source under the PolyForm Noncommercial License 1.0.0 with
  commercial licensing, contribution, trademark, and third-party notice
  documentation.

[Unreleased]: https://github.com/JSB2010/safe-online-exam/compare/v1.0.7...HEAD
[1.0.7]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.7
[1.0.6]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.6
[1.0.5]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.5
[1.0.4]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.4
[1.0.3]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.3
[1.0.2]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.2
[1.0.1]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.1
[1.0.0]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.0
