# Changelog

This file records the user-visible changes in each stable Safe Online Exam
release.

## [Unreleased]

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

[Unreleased]: https://github.com/JSB2010/safe-online-exam/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.1
[1.0.0]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.0
