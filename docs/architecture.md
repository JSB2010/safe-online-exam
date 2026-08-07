# Architecture And Security Model

This guide explains the implementation boundaries that matter to operators,
reviewers, and contributors. For deployment commands, use
[Deployment](deployment.md). For the visible Canvas workflows, use the
[User guide](user-guide.md).

## System Purpose

Safe Online Exam is an LTI 1.3 tool for requiring Safe Exam Browser (SEB) on Canvas Classic Quizzes and New Quizzes. It has four connected responsibilities:

1. Give instructors a course-scoped interface for discovering Canvas assessments and managing SEB policy.
2. Give verified root-account administrators a Canvas-embedded, school-wide recovery interface with controlled password reveal, active-course connection, and bulk tool rollout.
3. Generate protected SEB configurations and establish a Canvas session inside SEB without transferring a normal-browser session cookie.
4. Release the Canvas access code and approved web-tool capability only when SEB proves that it is using the current configuration.

The service is not a general Canvas proxy. A deployment is configured for one Canvas origin and one LTI deployment boundary. All identity and authorization data used for a request comes from a validated LTI launch or a server-issued, bound capability.

## Runtime Shape

```mermaid
flowchart LR
  Canvas["Canvas"] -->|"OIDC login and signed LTI launch"| App["NestJS service"]
  Canvas -->|"OAuth and REST/New Quiz APIs"| App
  App -->|"assessment, course, token, session, state"| PostgreSQL["PostgreSQL 17+"]
  App -->|"React app shell"| Browser["Instructor or student browser"]
  Canvas -->|"theme loader"| Detector["Canvas detector script"]
  Detector -->|"Config Key proof and one-time redemption"| App
  App -->|"encrypted .seb configuration"| SEB["Safe Exam Browser"]
  SEB -->|"Canvas session URL and assessment"| Canvas
```

The application is one Node.js process. NestJS controllers expose HTTP endpoints, services own protocol and business behavior, repositories provide PostgreSQL storage in deployed environments and in-memory storage for local/test work, and React renders page views supplied by the server app shell. The detector is a separately served browser asset that runs on Canvas quiz pages.

### Deployment portability

The production image has no runtime dependency on a Google Cloud SDK. Durable state is in PostgreSQL, application configuration is read from environment variables or mounted files, and the HTTP process listens on a configurable host and port. Multiple instances share sessions, one-time claims, admission budgets, and operation locks through PostgreSQL, so sticky sessions and a writable application filesystem are not required.

Cloud Run, Cloud SQL, Artifact Registry, Secret Manager, and Cloud Build are the recommended managed deployment, not application requirements. Another platform can run the same image when it provides PostgreSQL 17+, public HTTPS ingress, secret injection, an exact-image migration job before traffic, and a scheduled cleanup job. [Deployment](deployment.md) defines both supported operating models.

## Code Ownership

| Area                      | Primary locations                                                           | Responsibility                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Bootstrap and HTTP policy | `src/server/main.ts`, `src/server/http/`                                    | Express session setup, CORS, security headers, app-shell rendering, request integrity, bounded upstream responses.    |
| Configuration             | `src/server/config/app-config.ts`                                           | Environment parsing, normalizing aliases, and hardened-runtime validation.                                            |
| LTI                       | `lti.controller.ts`, `lti.service.ts`, `lti-state.service.ts`               | OIDC initiation, signed token validation, state encryption/replay claim, role routing, and Canvas JSON configuration. |
| Canvas OAuth and APIs     | `oauth.controller.ts`, `canvas-api.service.ts`                              | Purpose-scoped instructor/student/admin authorization, token refresh, bounded Canvas REST/New Quiz requests.          |
| Account administration    | `admin.controller.ts`, `admin-authorization.service.ts`                     | Root-scoped course connections, recovery actions, password reveal, account-bound authorization, and tool rollout.     |
| Assessment policy         | `quiz.controller.ts`, `assessment.service.ts`, `course-settings.service.ts` | Discovery, Canvas access-code mutations, course defaults, per-assessment overrides, exam tools.                       |
| SEB lifecycle             | `seb.controller.ts`, `seb-configuration.service.ts`, `seb-*.service.ts`     | Configuration grants, configuration generation, proof, access-code redemption, setup check, exit grants.              |
| Browser detector          | `src/server/assets/canvas-seb-detector.js`, `static-js.controller.ts`       | Quiz-page launch UI, access-code filling, approved tools, completion detection, diagnostic reporting.                 |
| Persistence               | `src/server/data/`, `session-store.ts`                                      | PostgreSQL migrations, atomic consumption/claims, distributed rate budgets, locks, Express sessions.                  |

## Identity And Authorization

### LTI launch

Canvas initiates OIDC at `/lti/login`. The service verifies the issuer, requested target link URI, configured client ID, and configured deployment ID before creating encrypted state. State is valid for ten minutes and is additionally bound to a short-lived, `HttpOnly`, secure browser transaction cookie.

Canvas posts an ID token to `/lti/launch`. The service validates:

- RS256 signing against the configured Canvas JWKS;
- issuer, audience, nonce, token age, issued/expiry timestamps, LTI version, message type, and deployment ID;
- the target link URI and initiation state tuple;
- the initiating browser transaction cookie; and
- a durable, atomic PostgreSQL state claim to prevent replay.

After successful validation, the server regenerates the Express session and stores a verified LTI principal. A course principal contains the signed issuer, deployment, subject, numeric Canvas user ID, course ID, roles, and custom fields. A root-account administrator principal instead contains signed numeric account/root-account IDs and Canvas's root-admin substitution. Query parameters and request bodies cannot substitute for either principal.

Instructors receive the course management view. Students receive a launch-only flow and never receive management actions. The school dashboard is available only through the root-account navigation placement and requires both a standard signed LTI Administrator role and Canvas's signed root-account-admin value. A signed Canvas numeric user ID is required for Canvas REST authorization; a Canvas administrator must refresh the LTI registration if Canvas does not supply the configured substitutions.

### Canvas OAuth

An LTI launch authenticates a person but does not authorize Canvas API calls. The application uses a separate Canvas OAuth authorization for API access:

1. An instructor opens `/api/oauth2authorize` or `/api/oauth2reauthorize` from the same-origin tool UI created by an existing verified launch. Browser requests whose Fetch Metadata identifies any other site relationship are rejected.
2. The service records encrypted, one-time state and redirects to Canvas.
3. `/api/oauth2callback` verifies state and exchanges the authorization code.
4. PostgreSQL stores one OAuth grant per Canvas user ID. Administrator authorization upgrades that same record to the complete application-plus-administrator scope set, and `CanvasApiService` refreshes it when necessary.
5. Instructor and administrator authorization normally runs in a popup while the signed LTI page remains open. The callback renders a non-privileged completion screen that sends a fixed completion message only to its exact same-origin opener; the opener verifies both the message origin and popup window before performing its own same-origin refresh. If a popup is unavailable, the callback remains on the non-privileged completion screen and the user returns through Canvas. An OAuth callback never renders or directly redirects into an authenticated management view.

Every Canvas OAuth connection requests the same complete application scope set, including the course-list permission used for teacher-scoped tool duplication (`url:GET|/api/v1/courses`) and the session-token permission required for SEB handoff (`url:GET|/api/v1/login/session_token`). This keeps one durable grant valid when a person is an instructor in one course and a student in another; Canvas still enforces their actual course permissions. The one-time Canvas session URL is generated server-side for each student configuration download. Browser cookies are never copied to the configuration or exposed through the API.

Root-account administrators use `/api/admin/oauth2authorize` to upgrade their existing user grant with administrator scopes. The upgraded grant retains every instructor, student-session, and assessment scope, so the same Canvas user never needs a second token record. Later course or student reauthorization preserves the administrator scope profile instead of replacing it with a narrower grant. The dashboard stores a root-account course index and browses active Canvas courses in bounded, server-filtered pages; it never imports the complete historical catalog. Summary, course list, selected-course detail, tool presets, and the Canvas course catalog are independent resources. Every admin mutation also requires a short-lived HMAC action token bound to the LTI subject, Canvas user, root account, deployment, and current Express session.

## Assessment And Course Model

### Identifiers

All persisted assessment records use a canonical public content ID:

| Assessment type | Canonical ID                        | Canvas mutation target   |
| --------------- | ----------------------------------- | ------------------------ |
| Classic Quiz    | `classicquiz_{quizId}`              | Quiz access-code API     |
| New Quiz        | `newquiz:{courseId}:{assignmentId}` | New Quiz access-code API |

The `assessments` table stores Canvas discovery data, availability verification, and SEB state. `courses` stores course-level defaults and its exam-tool catalog. Course defaults can provide URL policy, start/exit password policy, and selected exam tools; an assessment may inherit defaults, retain an explicit list of course tool IDs, and add quiz-only tool definitions.

### Canvas discovery and availability

Instructor discovery refreshes Classic and New Quiz data from Canvas. A learner can use an assessment only when its cached Canvas verification is current, explicitly verified, published, and within its global unlock/lock window. The verification window is 24 hours. Missing records are retained for instructor reconciliation but fail closed for learners; a failed refresh marks the cached discovery stale.

Assessment updates use short-lived PostgreSQL operation locks while Canvas and database state are changed. Administrator course resets take a course-level lease and then the same per-assessment leases, so ordinary assessment mutations cannot overlap a reset. Course refreshes, administrator connection-count writes, and school-preset assignment writes use the same course fence so they cannot recreate state after a reset. Atomic compare-and-delete/insert operations prevent overlapping workers from owning the same lease and help keep Canvas access codes aligned with persisted SEB settings. Each workflow carries a shared lease guard across nested locks and checks it after external reads and before later Canvas or PostgreSQL mutations; a failed background renewal makes the guard reject those later side effects immediately. After final ownership verification, releasing a lease is best-effort: a cleanup failure cannot replace the verified action result, and the bounded lease expires automatically.

An administrator course reset performs strict Classic Quiz and New Quiz discovery and reads every assessment's current Canvas access-code state before making the first destructive call. It then removes each Canvas access code with the account-administrator grant and only afterward deletes course-related transient state, assessments, the course policy, and per-course school-tool preset assignments in one PostgreSQL transaction. That transaction also stores an operation-specific reset receipt on the retained root-account course connection; the shared OAuth grant is deliberately retained. If a Canvas response is lost, a later Canvas mutation fails, or the database transaction definitively fails, the service restores the exact pre-reset Canvas state for every assessment that may have changed and restores its prior local assessment record in reverse order. If the transaction commit response is ambiguous, the service verifies the durable reset receipt before compensating. An unavailable receipt check, failed compensation, or lost lease is reported as an indeterminate result that requires refresh and verification rather than blindly restoring Canvas state.

### Exam tools and URL policy

Course-owned exam tools have an exact HTTPS launch URL and typed resource rules: one exact page or file, an address and related links, or an explicitly confirmed whole website. Instructors explicitly approve both tool start pages and resources, including a different HTTPS website such as a CDN asset; the instructor UI calls out cross-site access before saving. A saved instructor-owned tool can be duplicated into active Canvas courses where the same OAuth user is a teacher. The browser can only choose from a Canvas-filtered course list, and the server retrieves that list again before every target write; target IDs alone never authorize a copy. The copy appends a local tool without replacing the target catalog, preserves an existing equivalent definition on retry, and propagates the target course defaults so relevant configuration fingerprints are invalidated. A dedicated YouTube video tool accepts a watch, share, Shorts, or embed link and turns it into one embedded public video with a server-owned player page and bounded media policy. The server-owned page supplies YouTube's required embedding identity while deliberately excluding YouTube browsing and Google sign-in. User-entered general rules remain restricted to safe HTTPS URLs or concrete domains. Wildcards, credentials, arbitrary regular expressions, and unsafe historical patterns are rejected or quarantined.

Root administrators can create reusable school presets in `admin_tool_presets` and assign them to individual courses. An assigned definition is synchronized into the course catalog as school-managed: instructors may enable or disable it but cannot silently change its launch URL or resource access. Updating or deleting the preset synchronizes every assigned course and invalidates affected configuration fingerprints. Quiz-only definitions remain on the assessment record and never become course defaults.

The detector sidebar is an affordance only. The SEB URL filter in the generated configuration is the control that determines what can load. Changing any selected tool or URL policy changes the configuration fingerprint; students must download a new configuration.

## SEB Lifecycle

### Instructor configuration

When an instructor enables SEB, `AssessmentService` creates an access code, mutates the appropriate Canvas assessment, and persists SEB state only after the mutation is successful. Enabling requires an effective exit password: assessment override, course default, or configured managed default. Optional start passwords protect the inner configuration payload. Password responses are redacted by default; an instructor can make a narrowly bound, short-lived reveal request.

### Student configuration download

Student downloads do not use a reusable `.seb` link. A verified LTI principal requests a configuration grant, and the server mints a one-time 120-second capability bound to the principal, course, content ID, and current settings fingerprint. `GET /seb/config/:courseId/:contentId.seb` consumes that capability.

For a student download, the service obtains a fresh Canvas session URL and builds the SEB start URL around it. The configuration contains the canonical Canvas assessment entry route, SEB URL policy, Config Key behavior, and an HMAC-bound quit URL. It is then encrypted to the configured public certificate. The service holds only public encryption material.

### Config Key proof and access-code release

On the Canvas assessment page, the detector gets the SEB Config Key hash and current browser URL through the SEB JavaScript API. It requests a proof from `POST /api/seb/access-proof/:courseId/:quizId`; the server verifies the assessment, current settings fingerprint, URL family, and Config Key hash before returning a one-time proof token.

`POST /api/seb/access-code/:courseId/:quizId` consumes that proof token. It returns the access code, approved tools, and an exit grant with sensitive response headers. A proof is valid for two minutes and can be consumed once. The detector then fills only an unambiguous Canvas access-code prompt. It does not treat DOM content as authorization.

In an ordinary browser, an access-code field is only a Canvas challenge signal. Before showing the SEB-required prompt, the detector calls `GET /api/seb/requirement/:courseId/:quizId`. The endpoint normalizes the assessment identifier and performs one exact `assessments` primary-key lookup; a short, bounded promise cache coalesces concurrent checks for the same assessment. It returns true only when the stored course/content relationship matches and the SEB configuration is enabled, required, and usable. An absent, mismatched, disabled, malformed, or unverifiable result does not produce a launch prompt.

### Completion and exit

The detector waits for Canvas-authored completion evidence. Classic Quiz completion requires a successful final submission and the matching Canvas result structure; New Quiz completion requires the authoritative result UI. On confirmed completion, the detector uses a settings-bound exit grant to display a quit link. Unbound manual/automatic quit paths intentionally return `410` rather than accepting a general-purpose quit request.

### Setup check

`/seb/check/config.seb` generates a separate configuration for testing certificate decryption, SEB runtime detection, connectivity, storage, and Config Key proof. It never releases an assessment access code and does not establish device trust. It should be part of pre-exam readiness testing, not a substitute for device management.

## Configuration Security Boundary

Generated assessment configurations include a strict Canvas and approved-resource URL filter, SEB Config Key proof setup, session-monitoring and kiosk-related policy, exit protection, and optional start-password protection. The exact plist is built by `SebConfigurationService`; use integration testing with the supported SEB clients rather than assuming a setting is honored by every client release or operating system.

Certificate encryption is enabled by default, including in hardened runtimes. The public X.509 certificate or public key permits wrapping the file; the matching private identity belongs only on approved client devices. An instance that cannot distribute that identity may explicitly set `SEB_CONFIG_ENCRYPTION_ENABLED=false`; in that mode the configuration is plaintext unless an instructor sets a start password. [Certificate management](certificate-management.md) defines the security trade-off and rotation model.

### Assessment and setup-check configuration policy

Assessment configurations use the SEB exam-start purpose and include the assessment start URL, an HMAC-bound quit URL, URL filter rules, a derived Browser Exam Key, and a Config Key salt. If an instructor sets a start password, the inner configuration is password-protected before certificate wrapping. The outer encrypted file uses SEB’s public-key-hash (`pkhs`) format when a public certificate is configured.

The setup-check configuration is deliberately different from an assessment configuration: it starts at `/seb/check`, has no assessment access code, allows quit without an assessment exit password, and cannot redeem an access-code proof. It applies the same macOS installation/AAC checks as an assessment so a client incompatibility is discovered before an exam.

Assessment lockdown settings explicitly block configuration surfaces that would undermine the browser boundary, including application/user switching, virtual machines, additional displays, screen capture/sharing, AirPlay, Siri and dictation, developer console, printing, downloads/uploads, open/save panels, and non-SEB clipboard transfer. They leave Canvas-required browser behavior, reload, JavaScript, and SEB-managed browser windows available so Canvas and approved web tools can function.

On macOS, the generated policy requires Automatic Assessment Configuration (AAC) through both `enableMacOSAAC` and `lockdownModePolicy`, requires installation from the system Applications location, and sets a macOS 12.1 floor through explicit version-number settings plus the coarse version field. The overlapping AAC keys cover supported SEB client generations; they do not replace device management. AAC may block third-party assistive technology, so an accommodation that requires it needs a separate approved assessment/proctoring arrangement rather than a weakened common configuration.

On Windows, the configuration requests the OS-session and SEB-service controls used by the generated policy, including the kiosk desktop, process/session monitoring, and the supported SEB version floor. Client releases that do not understand a newer configuration key cannot enforce that key, so managed-device policy must also pin the approved SEB client version and integrity baseline. Validate the complete policy with a real supported client after SEB or operating-system updates.

## Persistence And Expiration

| Table                           | Contents                                                                                            | Expiration behavior                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `assessments`                   | Canvas discovery and per-assessment SEB state                                                       | Durable until intentionally changed.                          |
| `courses`                       | Course defaults, setup state, and exam-tool catalog                                                 | Durable until intentionally changed.                          |
| `canvas_oauth_tokens`           | Canvas access and refresh tokens                                                                    | Durable; lifecycle is driven by Canvas authorization/refresh. |
| `admin_course_connections`      | Root-account-scoped cached Canvas course metadata and assessment counts                             | Durable until a course connection is intentionally removed.   |
| `admin_tool_presets`            | Root-account tool definitions                                                                       | Durable until an administrator changes or deletes the preset. |
| `admin_tool_preset_assignments` | Per-course desired state, rollout status, and retry information                                     | Durable until the preset is deleted or the course is reset.   |
| `sessions`                      | Express session payloads keyed by a hashed session ID                                               | Expired rows are removed by bounded cleanup.                  |
| `transient_states`              | LTI replay claims, OAuth state, configuration grants, proofs, session-handoff records, rate budgets | Expired rows are removed by bounded cleanup.                  |
| `operation_locks`               | Short assessment-update and administrator course-reset leases                                       | Expired rows are removed by bounded cleanup.                  |

PostgreSQL transactions and row locks implement atomic state claims, one-time token consumption, rate-budget increments, and operation-lock ownership. Claim/consume operations use conditional mutations so two app instances cannot both win. Cleanup selects bounded batches with `FOR UPDATE SKIP LOCKED`, allowing safe overlap without long table locks. This is why multiple app instances can share runtime state without sticky sessions.

Schema changes are explicit, ordered migrations recorded with checksums in `schema_migrations`. The application never mutates schema on ordinary startup; `/ready` fails until all checked-in migrations are applied. A migration job must complete before traffic reaches a new image.

## HTTP And Security Controls

- Security headers are applied before application routes; Express disables `x-powered-by` and trusts one proxy hop.
- Sessions use `HttpOnly` cookies and use `Secure; SameSite=None` when the configured tool URL is HTTPS or the profile is production.
- Sensitive proof, access-code, and password-reveal responses are no-store and are bound to the verified session/principal.
- LTI initiation and token validation use process-local and PostgreSQL-backed admission budgets. Configuration-grant minting is rate-limited per principal and IP.
- Canvas API calls are constrained to the configured Canvas origin and `/api/v1` base. Responses have size limits and upstream deadlines; a `401` triggers at most one safe token refresh/retry.
- The public detector script has two stable paths. Debug or diagnostic modes serve a readable, non-cacheable asset; normal production mode serves the built minified asset from the same public path.

## Route Reference

### Public and LTI routes

| Route                                                | Purpose                                              |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `GET /`, `GET /login`                                | Public service status and Canvas-launch fallback.    |
| `GET /health`, `GET /login/health`, `GET /js/health` | Lightweight health responses.                        |
| `GET /setup`, `GET /setup/guide`                     | Public role-oriented setup handoff.                  |
| `GET /.well-known/jwks.json`                         | Public LTI signing keys.                             |
| `GET /lti/config`                                    | Canvas LTI 1.3 JSON configuration document.          |
| `GET /lti/login`, `POST /lti/login`                  | OIDC initiation.                                     |
| `GET /lti/launch`, `POST /lti/launch`                | Signed LTI launch handling and session-based reload. |

### Canvas OAuth routes

| Route                                                    | Caller and purpose                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/oauth2authorize`, `GET /api/oauth2reauthorize` | Verified instructor begins or repeats Canvas API authorization.                                    |
| `GET /api/student-session-authorize`                     | Verified student begins the complete application authorization and returns to the session handoff. |
| `GET /api/admin/oauth2authorize`                         | Verified root administrator upgrades the user's shared grant with account scopes.                  |
| `GET /api/oauth2callback`                                | Canvas OAuth redirect URI; state and launch session are validated.                                 |
| `GET /api/oauth2status`                                  | Verified instructor checks stored authorization availability.                                      |

### Root-account administrator routes

All routes below are under `/api/admin`, require a verified root-account administrator principal, and validate each target course against Canvas's root-account boundary. Mutations additionally require the session-bound administrator action token.

| Route                                                                             | Purpose                                                           |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /api/admin/summary`                                                          | Read lightweight account and configured-course totals.            |
| `GET /api/admin/courses`                                                          | Search and cursor-page the root-account course index.             |
| `GET /api/admin/courses/:courseId`                                                | Read one connected course and its assessments.                    |
| `GET /api/admin/course-catalog`                                                   | Browse active Canvas courses in bounded, filtered pages.          |
| `GET /api/admin/terms`                                                            | Read active Canvas enrollment terms for the course picker.        |
| `POST /api/admin/courses/connect`                                                 | Validate, connect, and initially synchronize selected courses.    |
| `POST /api/admin/courses/:courseId/refresh`                                       | Refresh one course's Classic and New Quiz discovery.              |
| `POST /api/admin/courses/:courseId/reset`                                         | Disable every Canvas assessment, then reset local course setup.   |
| `POST /api/admin/courses/:courseId/passwords/reveal`                              | Controlled, no-store course password reveal.                      |
| `POST /api/admin/courses/:courseId/quit-password/rotate`                          | Generate, apply, and briefly reveal a new course exit password.   |
| `POST /api/admin/courses/:courseId/assessments/:assessmentId/passwords/reveal`    | Controlled, no-store assessment secret reveal.                    |
| `POST /api/admin/courses/:courseId/assessments/:assessmentId/quit-password/reset` | Reset only the assessment exit password to its effective default. |
| `POST /api/admin/courses/:courseId/assessments/:assessmentId/reset-defaults`      | Reset an assessment to its course defaults.                       |
| `POST /api/admin/courses/:courseId/assessments/:assessmentId/regenerate-code`     | Rotate the Canvas access code.                                    |
| `PUT /api/admin/courses/:courseId/assessments/:assessmentId/seb`                  | Enable or disable SEB enforcement.                                |
| `GET`, `POST /api/admin/tool-presets`                                             | List or create validated school tool presets.                     |
| `PUT`, `DELETE /api/admin/tool-presets/:presetId`                                 | Update a preset or delete one after all assignments are removed.  |
| `PUT /api/admin/tool-presets/:presetId/courses/:courseId`                         | Assign or unassign a preset for one Canvas course.                |
| `PUT /api/admin/tool-presets/:presetId/assignments`                               | Queue a selected-course or all-course preset rollout.             |
| `POST /api/admin/tool-presets/:presetId/assignments/reconcile`                    | Process or retry a bounded rollout batch.                         |

### Instructor assessment routes

All routes below are under `/api/quizzes` and require the verified instructor/request-integrity boundary unless they are simple reads exposed through the current session.

| Route                                                                                      | Purpose                                                                                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /api/quizzes`, `GET /api/quizzes/:quizId`, `GET /api/quizzes/seb-settings`            | Read cached course assessment/settings views.                                                   |
| `POST /api/quizzes/course/:courseId/refresh`                                               | Refresh Classic Quiz and New Quiz discovery from Canvas.                                        |
| `GET /api/quizzes/course/:courseId/defaults`, `PUT /api/quizzes/course/:courseId/defaults` | Read or update course defaults and exam-tool catalog.                                           |
| `GET /api/quizzes/course/:courseId/exam-tools/:toolId/copy-targets`                        | List other active Canvas teacher courses eligible to receive one saved instructor tool.         |
| `POST /api/quizzes/course/:courseId/exam-tools/:toolId/copy`                               | Reauthorize selected targets against Canvas and copy the tool without replacing their catalogs. |
| `POST /api/quizzes/course/:courseId/passwords/reveal`                                      | Session-bound course password reveal.                                                           |
| `POST /api/quizzes/:courseId/:quizId/passwords/reveal`                                     | Session-bound assessment password reveal.                                                       |
| `PUT /api/quizzes/:quizId/seb`, `POST /api/quizzes/seb-config-structured`                  | Update SEB settings.                                                                            |
| `POST /api/quizzes/:courseId/:quizId/seb/enable`                                           | Enable SEB and set the Canvas access code.                                                      |
| `POST /api/quizzes/:courseId/:quizId/seb/disable`                                          | Disable SEB and remove Canvas access-code protection.                                           |
| `POST /api/quizzes/:courseId/:quizId/seb/reset-defaults`                                   | Return one assessment to course defaults.                                                       |
| `POST /api/quizzes/:courseId/:quizId/seb/regenerate-code`                                  | Rotate the protected Canvas access code.                                                        |
| `GET /api/quizzes/:courseId/:quizId/seb/config`                                            | Redirect to the current configuration flow.                                                     |
| `GET /api/quizzes/:courseId/:quizId/seb/status`                                            | Return the secret-free SEB status view.                                                         |

### Student SEB, proof, and exit routes

| Route                                                                                             | Purpose                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /seb/quiz/:courseId/:quizId`                                                                 | Render assessment SEB-required/download view.                                        |
| `POST /api/seb/config-grant/:courseId/:contentId`                                                 | Mint a one-time configuration download grant from a verified launch.                 |
| `GET /seb/config/:courseId/:contentId.seb`                                                        | Consume a configuration grant and download the encrypted assessment configuration.   |
| `GET /seb/config-encryption-certificate.pem`, `GET /seb/config-encryption-certificate.cer`        | Public active encryption certificate in PEM/DER form.                                |
| `POST /api/seb/session-readiness`, `POST /api/seb/session-readiness/dismiss`                      | Test or dismiss the optional student setup prompt.                                   |
| `GET /seb/check/config.seb`, `GET /seb/check`, `POST /api/seb/check-proof`, `GET /seb/check/quit` | Setup-check configuration, page, proof, and quit flow.                               |
| `GET /seb/launch/:contentId`, `POST /seb/launch/:contentId`, `GET /seb/launch/:contentId/login`   | Signed/direct assessment-launch handoff.                                             |
| `GET /seb/launch-handoff`                                                                         | Same-tab launcher page for a configuration URL held only in browser session storage. |
| `GET /seb/config/:courseId/:quizId`, `GET /seb/config/:quizId`                                    | Compatibility redirects into the current configuration flow.                         |
| `POST /api/seb/access-proof/:courseId/:quizId`                                                    | Validate Config Key proof and mint the one-time access-code proof.                   |
| `POST /api/seb/access-code/:courseId/:quizId`                                                     | Redeem a proof for the access code, approved tools, and exit grant.                  |
| `GET /api/seb/access-code/:courseId/:quizId`                                                      | Explicit method guidance; redemption is POST-only.                                   |
| `GET /api/seb/requirement/:courseId/:quizId`                                                      | Return the secret-free configured requirement used by the Canvas detector.           |
| `GET /api/seb/tools/:courseId/:quizId`                                                            | Return the current approved tool view under the proof/session boundary.              |
| `GET /seb/tool/youtube/:videoId`                                                                  | Render the server-owned, single-video YouTube player used by an approved video tool. |
| `GET /seb/exit/session/:courseId/:quizId/:grant`                                                  | Render a validated post-submission exit page.                                        |
| `GET /seb/exit/:courseId/:quizId`                                                                 | Render a non-terminal/manual exit page.                                              |
| `GET /seb/exit/quit/:courseId/:quizId/:grant`                                                     | Redirect a validated exit grant to the configuration-bound SEB quit URL.             |
| `GET /seb/exit/complete/:courseId/:quizId/:token`                                                 | Render the HMAC-authenticated SEB quit completion page.                              |
| `GET /seb/exit/quit/:courseId/:quizId`, `GET /seb/exit/manual/:courseId/:quizId`                  | Deliberately unavailable unbound quit routes; return `410`.                          |

### Detector and diagnostics routes

| Route                                   | Purpose                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /js/canvas-seb-detector.js`        | Stable detector script URL for new Canvas theme loaders.                                              |
| `GET /js/canvas-seb-theme-loader.js`    | Hosted, quiz-route-limited loader for Canvas deployments that cannot serve uploaded theme JavaScript. |
| `GET /api/seb/canvas-detector.js`       | Stable compatibility alias for an existing loader.                                                    |
| `POST /api/debug/canvas-detector-trace` | Accepts sanitized detector diagnostics only when debug/diagnostic mode is enabled.                    |

The route handlers are the source of truth for parameters and response schemas. Treat unlisted query parameters or output fields as implementation details.
