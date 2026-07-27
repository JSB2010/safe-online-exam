# Changelog

This file records the user-visible changes in each stable Safe Online Exam
release.

## [Unreleased]

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

### Release engineering

- Reworked publication into a one-tag workflow that creates a draft, waits for
  the tagged `main` commit's required CI and CodeQL checks, builds and smokes a
  staged multi-architecture image, and publishes the completed draft as an
  immutable GitHub Release.
- Added idempotent draft recovery, final-tag verification, release bundle
  checksums, persistent BuildKit caching, immutable action SHA pins, and a
  checked release-metadata consistency command.
- Added a reproducible `main` ruleset requiring pull requests, application,
  PostgreSQL, Compose, and CodeQL checks while leaving release tags free to
  target verified commits on `main`.
- Added signed-commit enforcement, pull-request dependency review, immutable
  container base-image digests, and synchronized npm toolchain validation.
- Expanded Dependabot to maintain npm and lockfile dependencies, Dockerfile and
  Compose images, and GitHub Actions with bounded cooldowns and reviewable
  framework/ecosystem grouping.
- Added checksum-protected, source-free Cloud Run and Compose release bundles.
  The Cloud Run path provisions application infrastructure, pins exact Secret
  Manager versions, supports two-pass Canvas registration, schedules cleanup,
  verifies a Cloud SQL backup, gates on migrations, stages a zero-traffic
  revision, and performs an explicit verified cutover with guarded rollback.
- Added verified Compose backup/upgrade helpers, strict release-attestation
  verification, a shared deployment contract with Cloud Build drift checks,
  self-hosted Canvas endpoint support, and explicit per-instance SEB
  certificate-encryption configuration.
- Added a read-only Cloud Run deployment doctor, consistent
  `safe-online-exam` names for newly provisioned portable resources, and an
  interactive Cloud SQL chooser with dated price/term guidance, a
  cost-conscious dedicated zonal default, optional HA/capacity and clearly
  labeled pilot/development profiles, exact unattended flags, backups,
  point-in-time recovery, deletion protection, connector enforcement, and
  opt-in creation. Existing maintained `canvas-seb-*` targets remain
  unchanged.
- Added guided top-level installers for the Cloud Run and Docker Compose
  release bundles. Both retain explicit unattended contracts; secrets use
  protected files or no-echo prompts, Cloud Run exposes resumable stages around
  Canvas administration handoffs, and Compose can bootstrap, validate, start,
  and health-check the complete topology.

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

[Unreleased]: https://github.com/JSB2010/safe-online-exam/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/JSB2010/safe-online-exam/releases/tag/v1.0.0
