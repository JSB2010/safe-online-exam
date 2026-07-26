# Changelog

This file records the user-visible changes in each stable Safe Online Exam
release.

## [Unreleased]

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
