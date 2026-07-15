# Architecture

## Purpose

This service connects Canvas LMS to Safe Exam Browser (SEB). Instructors launch the tool from Canvas, authorize Canvas API access, choose which quizzes require SEB, and the service updates Canvas access codes. Students receive SEB configuration files and are redirected back into Canvas only after SEB can prove it is using the generated configuration.

## Framework Choice

The rewrite uses NestJS for the backend and React/Vite for the UI.

NestJS was chosen because the original app is an HTTP API plus server-rendered workflow service, not a content website. It provides clear controller/service/module boundaries, dependency injection, and straightforward testing while keeping deployment as one Cloud Run container. React/Vite handles app-shell routes and instructor/student UI without introducing a second deployable service.

## Runtime Shape

```text
Canvas
  -> LTI 1.3 OIDC login and launch
  -> Canvas OAuth callback
  -> SEB detector script requests

Cloud Run NestJS service
  -> controllers validate route/session input
  -> services handle Canvas, LTI, SEB, quiz, and content behavior
  -> repositories persist to Firestore
  -> React app shell hydrates workflow pages

Firestore
  -> assessments, course defaults, Canvas OAuth tokens, runtime state
```

## Main Components

- `src/server/main.ts`: Nest bootstrap, session cookies, CORS, static React assets.
- `src/server/config/app-config.ts`: environment normalization and compatibility with old Spring profile variables.
- `src/server/data/repositories.ts`: Firestore-backed repositories plus in-memory stores for tests and local smoke checks.
- `src/server/data/session-store.ts`: Express session store backed by the repository layer for Cloud Run multi-instance routing.
- `src/server/controllers/lti.controller.ts`: Canvas LTI login, launch, config, and deep-link endpoints.
- `src/server/controllers/oauth.controller.ts`: Canvas OAuth2 authorize/callback/status flow.
- `src/server/controllers/quiz.controller.ts`: instructor quiz APIs for refresh, enable, disable, regenerate, status, and structured SEB settings.
- `src/server/controllers/seb.controller.ts`: student SEB routes, config downloads, proof/access-code APIs, validation, redirects, and exit pages.
- `src/server/services/canvas-api.service.ts`: Canvas REST/New Quiz API calls and OAuth token usage.
- `src/server/services/assessment.service.ts`: unified Classic Quiz/New Quiz assessment persistence, cached Canvas metadata, and SEB enable/disable behavior.
- `src/server/services/seb-configuration.service.ts`: `.seb` plist generation and allowed-domain policy.
- `src/server/services/seb-config-key.service.ts`: Config Key hashing and proof validation.
- `src/server/services/seb-access-proof.service.ts`: short-lived one-time proof tokens.
- `src/client/app.tsx`: React views for instructor dashboard, SEB-required/download pages, and exit pages.

Tooling and CI choices are documented separately in `docs/tooling.md`.

## Data Model

Assessment documents are keyed by the public content ID used in SEB and LTI routes. Classic Quiz assessment IDs use:

```text
classicquiz_{quizId}
```

New Quiz assessment IDs use:

```text
newquiz:{courseId}:{assignmentId}
```

Firestore collections:

- `assessments`: one document per Canvas assessment/content item, including Canvas metadata plus SEB enforcement, access-code, Config Key, URL rule, and exam-tool state.
- `courses`: one document per Canvas course, including setup completion and course-level SEB defaults.
- `canvasOAuthTokens`: Canvas OAuth access and refresh tokens keyed by Canvas user ID.
- `sessions`: Express `JSESSIONID` payloads keyed by hashed session ID.
- `transientStates`: short-lived OAuth state, LTI replay claims, and SEB proof records keyed by hashed token/state.
- `operationLocks`: short-lived assessment update leases used while mutating Canvas access codes and matching Firestore state.

The Cloud Run deployment is safe to run with multiple instances. Durable application data and short-lived runtime state are both shared through Firestore; `USE_IN_MEMORY_STORE=true` is rejected when the app detects Cloud Run.

## LTI Flow

1. Canvas starts OIDC login at `/lti/login`.
2. The service creates encrypted, authenticated, self-contained state and nonce using `LtiStateService`. It also puts a fresh per-transaction secret in one fixed-name `HttpOnly`, `Secure`, `SameSite=None`, `__Host-` cookie and stores only that secret's hash inside the encrypted state. Issuance remains stateless and works across instances; a new login supersedes any unfinished login in the same browser without accumulating cookies.
3. The browser is redirected to Canvas authorization.
4. Canvas posts the signed launch to `/lti/launch`. For the assessment-specific target created by the detector popup, the signed `target_link_uri` is `/seb/launch/:contentId`; after validation the callback stores a two-minute, single-use handoff and redirects to that route.
5. Before token validation or state consumption, both launch callbacks require the exact browser-transaction cookie created by the initiating login. A copied state cannot be completed from a different browser. The cookie supports Canvas's cross-site `form_post`, expires with the ten-minute state window, and is cleared immediately after a successful atomic claim.
6. `LtiService` validates the ID token against Canvas JWKS, issuer, audience, nonce, the configured deployment ID, and the initiating login's issuer/target/deployment tuple.
7. The callback atomically claims the encrypted state in Firestore to prevent replay, regenerates the session ID, and stores an immutable verified principal derived only from the signed launch.
8. Instructor launches render with course/user context and quiz management actions.
9. Course-navigation student launches render a launch-only list of SEB-enabled assessments from cached course settings. On an assessment page, the detector popup adds a same-tool `launch_url` to Canvas's installed external-tool route. Canvas validates the tool host and performs the normal signed LTI launch for that exact assessment. The server consumes the signed single-use handoff, mints the existing one-time configuration grant, and redirects directly to the `sebs://` URL, so there is no second launch button. A reopened direct-launch page returns to the Canvas course rather than issuing another configuration. A raw or reusable `.seb` URL is never placed in Canvas JavaScript. Students do not see instructor settings or Canvas OAuth actions. Learner release additionally requires a completed, bounded, fully paginated Canvas discovery no more than 24 hours old that found the assessment published and within its global unlock/lock window. Omitted records are retained for instructor reconciliation but tombstoned for learners; failed discovery marks cached records stale and also fails closed. Legacy records, invalid timestamps, and timestamps more than five minutes in the future remain unavailable until an instructor completes a successful refresh.

The public JWKS endpoint is `/.well-known/jwks.json`. In production the private key must come from `LTI_PRIVATE_KEY`.

## Canvas OAuth Flow

LTI launch proves Canvas identity but does not provide the Canvas API token needed to read course content or update quiz access codes. Instructor API actions use a separate Canvas OAuth2 flow:

1. `/api/oauth2authorize` creates an encrypted one-time state in Firestore and redirects to Canvas.
2. Canvas redirects to `/api/oauth2callback`.
3. The service exchanges the code for access/refresh tokens.
4. Tokens are stored in Firestore in `canvasOAuthTokens`.
5. `CanvasApiService` refreshes expiring access tokens with the stored refresh token before quiz, New Quiz, and assignment calls.
6. If Canvas rejects an access token with `401`, the service refreshes once and retries the API call before asking the instructor to reauthorize.

## SEB Enforcement Flow

1. Instructor enables SEB for a quiz/content item.
2. The service generates a secure access code.
3. Canvas is updated:
   - Classic Quiz: quiz access code via Canvas quiz API.
   - New Quiz: New Quiz API access code endpoint.
4. The SEB setting is saved with `sebRequired`, `enabled`, and `accessCode`.
5. Student launches the assessment.
6. Non-SEB browsers receive a React page that offers the `.seb` configuration download.
7. Downloading the config uses a canonical Canvas start URL, generates the inner config without persisting a replayable Config Key, and returns a certificate-encrypted `pkhs` `.seb` file. Cloud Run rejects startup if certificate wrapping or its validity-checked X.509 certificate is missing, and each assessment download rechecks that the cached certificate is currently valid. Classic Quizzes use `/quizzes/:quizId/take`; New Quizzes use the stable `/assignments/:assignmentId` entry route and let Canvas redirect to the student-specific `/taking/:attemptId` session.
8. If an exam start password is configured, SEB prompts for that password before opening the exam config.
9. SEB opens the configured Canvas URL.
10. The detector script validates strict Config Key proof and retrieves the access code, approved tools, and a setting-generation-bound exit grant through a Firestore-backed one-time proof token. On an exact New Quiz assignment route it starts this exchange once before Canvas's asynchronous access-code field necessarily exists, then waits for one text/password input anchored to Canvas's access-code prompt and unique Submit control. Canvas may render that input as password, text, or an input with the default text type; the detector accepts those real component variants but refuses ambiguous input groups. An attempt-history view may prime the same config-bound capability, but it shows no access-code error and no tool sidebar. Tools are cached only in the current tab session, stay hidden on the access-code gate and attempt-history views, and render immediately when the active quiz-taking page appears.
11. For Classic Quizzes, the detector lets Canvas's own unanswered-question confirmation run first, then submits the exact same-origin final-attempt form without leaving the detector-loaded page. It opens the SEB exit page only after Canvas returns the exact quiz-detail route with its server-rendered completed-submission or withheld-results structure. For New Quizzes, the detector watches for Canvas's late-rendered access gate, treats the page-level Submit control as a request to open Canvas's confirmation dialog, records final-submit intent only from that dialog, and requires Canvas's authoritative results UI before showing the SEB exit page. Ambient DOM text, URL changes, unrelated forms, and timers cannot mark an assessment complete. A cancelled, failed, or structurally unconfirmed submission remains in Canvas with a blocking proctor-help message. After confirmed completion, the detector presents an explicit Quit Link through the bound exit grant; the exit page follows that link after a two-second countdown, and the link redirects to the exact HMAC-authenticated Quit URL embedded in the current config. The redundant native SEB Quit URL confirmation is disabled. Native or early quit continues to require the configured password.

The student launch page also exposes a setup check that downloads `/seb/check/config.seb`. That config starts on `/seb/check`, is allowlisted only for the LTI app host, and validates against `/api/seb/check-proof`. It is intentionally separate from quiz settings and never releases Canvas access codes; its purpose is to verify certificate decryption, SEB runtime detection, service connectivity, storage, and Config Key proof before a real assessment.

Assessment configs explicitly disable application and user switching, virtual machines, additional displays, screen capture/sharing/mirroring, AirPlay, Siri and dictation, developer consoles, OS escape shortcuts, printing, downloads, uploads, open/save panels, and non-SEB clipboard access. In-browser camera, microphone, and screen capture (`browserMediaCapture*`) are disabled alongside the legacy `allowAudioCapture`/`allowVideoCapture` keys they replace in SEB 3.7, cookies are cleared at session start as well as end so each exam begins with the fresh SEB cookie jar the Canvas session hand-off assumes, and on macOS SEB must run from the system Applications folder (`forceAppFolderInstall` without `allowUserAppFolderInstall`) so a student-writable copy of the app is refused. They also require process/session monitoring, the Windows SEB service, a private clipboard, and request the Windows create-new-desktop kiosk mode. On macOS they enforce Apple's Automatic Assessment Configuration (AAC) assessment mode through the overlapping `enableMacOSAAC` (SEB 3.2–3.6.x, off by default) and `lockdownModePolicy` (SEB 3.7+, value 2 = enforce AAC) keys, with `aacDnsPrePinning` covering the macOS releases where AAC otherwise fails DNS resolution. Because SEB falls back to its weaker user-space classic kiosk mode — or, under the 3.7 enforce policy, to no kiosk mode at all — when the OS cannot run AAC, the config also floors macOS at 12.1 (the first release where AAC works unconditionally) via `allowMacOSVersionNumberCheckFull`/`allowMacOSVersionNumberMajor|Minor|Patch`, with the coarser `minMacOSVersion` (macOS 12) as the legacy-client fallback. AAC blocks screen capture, app switching, Siri, and dictation at the OS level, but it also blocks third-party assistive technology; accommodations that need such tools require a separate proctoring arrangement rather than a weakened baseline. Because `createNewDesktop` and the macOS lockdown policy are session-wide and can be governed by the installed client's local settings, the managed-device baseline must enforce the same kiosk/AAC modes. The setup check config carries the same macOS AAC and version-floor keys so an unsupported Mac fails the setup check instead of an exam. JavaScript, reload controls, and SEB-managed additional browser windows remain enabled so Canvas, New Quizzes, and explicitly allowlisted web tools continue to work. No native third-party applications are added to `permittedProcesses`, and the generated config intentionally does not replace SEB's built-in prohibited-process presets.

The Config Key integration uses the SEB JavaScript API and therefore requires SEB 3.0 or newer on macOS/iOS and 3.3.2 or newer on Windows. Assessment configs additionally request Windows 3.6 or newer through `sebAllowedVersions`, which is the first Windows release family capable of enforcing that file-level version floor. `sebAllowedVersions` is not implemented by SEB for macOS, so the configs floor Macs on the OS version instead (macOS 12.1+ via the `allowMacOSVersionNumber*` keys) and rely on device policy to pin the SEB build itself. Older clients cannot enforce an unknown version-restriction key, so production device policy must pin a current school-approved stable SEB build and the setup check must pass before an assessment. The setup check proves API/config compatibility; it does not replace MDM version enforcement or application-integrity verification.

Course defaults are stored per Canvas course. They include an optional exam start password, a default exit password, structured allowed URL rules, and external exam tools. Enabling SEB for a quiz applies those defaults unless the quiz already has an override. Per-quiz settings can reset to defaults. User-entered URL rules support exact HTTPS URLs and concrete whole-domain entries only. Wildcards, caller-authored regular expressions, URLs with credentials, and broad or malformed hostnames are rejected; unsafe legacy rules are quarantined instead of compiled into a config. The built-in Desmos launcher uses an exact Desmos assessment-testing URL; the standard account-enabled calculator is not an exam preset.

External exam tools are configured in course defaults or per quiz/content item. Enabled tools are stored with a label, HTTPS URL, and optional extra resource entries. During `.seb` generation their URLs are added to the canonical SEB `URLFilterRules` allowlist, with `URLFilterEnable` enabled so unmatched page loads and links remain blocked by SEB. Exact tool URLs pin the normalized path, query, and fragment; an attacker cannot append an alternate redirect target or other query parameter. Whole-domain and explicit resource-wildcard rules remain broader by definition. `URLFilterEnableContentFilter` is intentionally disabled so Canvas-managed embedded resources can change without granting their shared storage and CDN hosts as top-level navigation destinations. Canvas-internal quiz and assignment rules separately allow dynamic query strings needed by Canvas. Canvas itself is restricted to the configured quiz or assignment URL family and same-tenant static asset paths; even the course-files page is not a navigation destination. New Quiz configs additionally allow only the configured Canvas tenant's regional `quiz-lti` and `quiz-api` service hosts. The detector receives the enabled tool list only with the proof-gated access-code exchange, sanitizes it again, and keeps it in the current tab's session storage. It deliberately hides the sidebar on an access-code challenge or attempt-history page and renders it from that cache as soon as the active `/take` page is visible. The sidebar opens tools through an opener-isolated broker; URL filtering remains the enforcement boundary.

Generated `.seb` downloads are certificate-encrypted using SEB macOS-compatible `pkhs` public-key-hash format. The server stores only the public certificate or public key and never needs the private key. Cloud Run requires encryption and a validity-checked X.509 certificate; public-key-only material remains a local-development fallback. Managed clients receive the matching private identity through an MDM Certificates payload configured as non-extractable and app-restricted; the retired login-keychain importer does not accept or install secrets. If an exam start password is set, the inner SEB payload also uses SEB `pswd` password encryption and includes a native `configKeySalt` value. The public certificate, when configured, is available from `/seb/config-encryption-certificate.pem` and `/seb/config-encryption-certificate.cer`; the private `.p12` identity is never served by the app.

The generated URL filter keeps assessment navigation scoped to the configured Canvas course/content paths, the issued one-time Canvas session URL, and configured exam resources. It does not permit Canvas's general login family, Google, an identity provider, or legacy `ssoDomains`. Student Canvas authorization occurs once in the regular browser before SEB starts; the service then creates a fresh Canvas session URL during config generation. No wildcard Google, Canvas, Instructure, or user-content host is added.

Certificate and password encryption harden the file against editing, but the server-side security boundary remains strict Config Key proof before releasing the hidden Canvas access code. Browser-provided proof is accepted only for the exact configured Classic Quiz or New Quiz assignment path family; assignment IDs that merely share a prefix are rejected. Proof tokens are single-use, short-lived, and bound to the current setting generation. The server deterministically regenerates the current inner config and computes its expected Config Key during proof verification rather than storing a replayable key at download time. Any SEB-affecting setting change alters that expected key and invalidates outstanding proof, so students must download a fresh config. Changing the exam start password rotates `configKeySalt`, which makes older passwordless or differently passworded configs fail Config Key validation.

Config downloads do not write Config Keys to Firestore. Proof validation is derived from the current assessment settings, and setting-generation digests bind outstanding one-time proofs to that exact state. Canvas access-code enable, disable, and regenerate operations use short Firestore leases per assessment so two instances do not race Canvas writes against Firestore writes.

The cached Canvas availability gate is course-global. Canvas differentiated-assignment overrides, module prerequisites, individual attempt state, and enrollment-specific availability still require an assessment resource-link/start-ticket design that binds a signed learner launch to the specific assessment and attempt; cached instructor discovery does not claim to prove those per-user conditions.

`APP_DEBUG_ENABLED` is the single local debug toggle for the service. It enables type-only detector diagnostics, sanitized detector trace callbacks to `/api/debug/canvas-detector-trace`, and no-store detector script serving. It defaults to false, Cloud Run rejects true, and trace payloads do not include page content or user-supplied message text. With debug disabled, the detector callback is dormant and the same public detector URLs serve the minified asset with cache headers.

## Security Notes

- Production requires `STATE_ENCRYPTION_KEY`; dev has a fallback for local testing.
- Cloud Run requires explicit school configuration through env vars or Secret Manager, including `TOOL_URL`, `CANVAS_DOMAIN`, `LTI_DEPLOYMENT_ID`, other LTI credentials, Canvas OAuth credentials, Firestore database ID, certificate encryption, and runtime secrets.
- LTI login and launch fail closed unless the issuer, client, target URI, nonce, audience, and deployment ID all match the configured school and the initiating login. A `GET /lti/launch` can only reuse an already verified session; query parameters cannot create an identity.
- Sessions use `JSESSIONID` for legacy cookie compatibility and are stored in Firestore by hashed session ID.
- Secure cookies are used when the profile is prod or `TOOL_URL` is HTTPS.
- Credentialed CORS allows exactly the configured Canvas origin and tool origin. It does not trust wildcard Canvas suffixes or arbitrary localhost origins.
- Instructor APIs require the verified instructor principal, exact course/content ownership, and a session-bound action token for mutations. OAuth authorization is bound to that same principal.
- Ordinary instructor settings treat access codes, Config Keys, start passwords, and quit passwords as redacted inputs; responses contain only presence booleans. Saved course/assessment passwords are returned only by the explicit instructor-authorized, session-bound, same-origin reveal POST and never include a managed server default.
- Newly supplied start and exit passwords pass one server-side 8–128 character policy requiring at least five different letters or numbers. Letters-only and numbers-only values are allowed; common, sequential, repetitive, low-diversity, and control-character values are rejected with a specific message that never reflects the attempted secret. Because students may know an exam start password, it must differ from the effective course, quiz, or managed-server exit password. Legacy weak or reused passwords cannot generate an assessment config and must be replaced. Ordinary settings and bootstrap payloads remain redacted; saved values are available only through an explicit instructor-authorized, same-origin, session-bound, no-store reveal response that the UI clears after 30 seconds. Managed server defaults are never returned.
- Enabled assessments and assessment config generation require an effective nonempty quit password from quiz/course settings or the managed server default. Native and early quit remain password protected. The post-submission countdown and explicit Quit Link require both a session exit grant and the HMAC-authenticated Quit URL embedded in the current config; static, manual, reusable, and pre-completion automatic assessment quit paths remain disabled.
- Access-code APIs return real HTTP 403/404/409 statuses for failed proof or missing SEB state.
- The detector script never receives an access code until strict Config Key proof succeeds.
- Config proof tokens are single-use and short lived.
- Detector traces redact access codes, proof tokens, OAuth/state/token values, cookies, passwords, and secret/private key fields before logging.

## React UI

The React app is not a marketing site. It renders operational views:

- instructor dashboard for quiz/content SEB management
- setup wizard and course default settings for instructors after Canvas authorization
- student launch page listing SEB-enabled assessments only
- OAuth authorization state
- SEB download/required pages
- SEB completion and quit pages

The UI uses text labels and Lucide icons, not emoji, and is designed to work inside Canvas iframes and SEB.
