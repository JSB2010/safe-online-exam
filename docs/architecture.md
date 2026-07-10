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
- `transientStates`: short-lived LTI/OAuth state and SEB proof records keyed by hashed token/state.
- `operationLocks`: short-lived assessment update leases used while mutating Canvas access codes and matching Firestore state.

The Cloud Run deployment is safe to run with multiple instances. Durable application data and short-lived runtime state are both shared through Firestore; `USE_IN_MEMORY_STORE=true` is rejected when the app detects Cloud Run.

## LTI Flow

1. Canvas starts OIDC login at `/lti/login`.
2. The service creates encrypted state and nonce using `LtiStateService` and records a one-time state entry in Firestore.
3. The browser is redirected to Canvas authorization.
4. Canvas posts or redirects back to `/lti/launch`.
5. `LtiService` validates the ID token against Canvas JWKS, issuer, audience, nonce, and deployment claims.
6. Launch data is stored in the Firestore-backed session.
7. Instructor launches render with course/user context and quiz management actions.
8. Student launches render a launch-only list of SEB-enabled assessments from cached course settings. Students do not see instructor settings or Canvas OAuth actions.

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
7. Downloading the config uses a canonical Canvas start URL, generates the plaintext config, persists a Config Key from that plaintext, and returns a certificate-encrypted `pkhs` `.seb` file unless certificate wrapping is explicitly disabled. Classic Quizzes use `/quizzes/:quizId/take`; New Quizzes use the stable `/assignments/:assignmentId` entry route and let Canvas redirect to the student-specific `/taking/:attemptId` session.
8. If an exam start password is configured, SEB prompts for that password before opening the exam config.
9. SEB opens the configured Canvas URL.
10. The detector script validates strict Config Key proof and retrieves the access code through a Firestore-backed one-time proof token.
11. For New Quizzes, the detector treats the page-level Submit control as a request to open Canvas's confirmation dialog. It records final-submit intent only from the confirmation dialog, waits until Canvas renders the assessment-results page or another completion signal, and then redirects to the SEB exit page. A cancelled or failed submission remains in the quiz.

The student launch page also exposes a setup check that downloads `/seb/check/config.seb`. That config starts on `/seb/check`, is allowlisted only for the LTI app host, and validates against `/api/seb/check-proof`. It is intentionally separate from quiz settings and never releases Canvas access codes; its purpose is to verify certificate decryption, SEB runtime detection, service connectivity, storage, and Config Key proof before a real assessment.

Course defaults are stored per Canvas course. They include an optional exam start password, a default exit password, structured allowed URL rules, and external exam tools. Enabling SEB for a quiz applies those defaults unless the quiz already has an override. Per-quiz settings can reset to defaults. URL rules support exact URLs, whole-domain entries, and an advanced regex option while preserving legacy domain arrays for older settings.

External exam tools are configured in course defaults or per quiz/content item. Enabled tools are stored with a label, HTTPS URL, and optional extra resource entries. During `.seb` generation their URLs are added to the canonical SEB `URLFilterRules` allowlist, with `URLFilterEnable` enabled so unmatched page loads and links remain blocked by SEB. `URLFilterEnableContentFilter` is intentionally disabled so Canvas-managed embedded resources can change without making an exam config stale or requiring broad top-level domain rules. Canvas itself is restricted to the configured quiz or assignment URL family plus static/file/media resources needed to render the assessment. New Quiz configs additionally allow only the configured Canvas tenant's regional `quiz-lti` and `quiz-api` service hosts. The Canvas detector script fetches the enabled tool list from `/api/seb/tools/:courseId/:quizId` to render a draggable sidebar on the quiz page. The sidebar opens tools in SEB-controlled new tabs/windows; URL filtering remains the enforcement boundary.

Generated `.seb` downloads are certificate-encrypted by default using SEB macOS-compatible `pkhs` public-key-hash format. The server stores only the public certificate or public key and never needs the private key. SEB clients need the matching private-key identity installed in Keychain or the Windows certificate store, usually through Jamf or another device-management channel. If an exam start password is set, the inner SEB payload uses SEB `pswd` password encryption and the generated plaintext settings include a native `configKeySalt` value. `SEB_CONFIG_ENCRYPTION_ENABLED=false` disables only the certificate wrapper; configs with exam start passwords remain password-encrypted. The public certificate, when configured, is available from `/seb/config-encryption-certificate.pem` and `/seb/config-encryption-certificate.cer`; the private `.p12` identity is never served by the app.

Certificate and password encryption harden the file against casual editing, but the server-side security boundary remains strict Config Key proof before releasing the hidden Canvas access code. Browser-provided proof is accepted only for the exact configured Classic Quiz or New Quiz assignment path family; assignment IDs that merely share a prefix are rejected. Any SEB-affecting setting change clears the stored Config Key so students must download a fresh config before access-code proof can succeed. Changing the exam start password rotates `configKeySalt`, which makes older passwordless or differently passworded configs fail Config Key validation. Broad allowlist patterns and effectively global regex rules are rejected before config generation.

Config downloads persist Config Keys with a compare-and-set update: if instructor settings change while a config is being generated, the stale Config Key is not saved and the student must download again. Canvas access-code enable, disable, and regenerate operations use short Firestore leases per assessment so two instances do not race Canvas writes against Firestore writes.

`APP_DEBUG_ENABLED` is the single debug/development toggle for the service. It enables detector console logging, sanitized detector trace callbacks to `/api/debug/canvas-detector-trace`, and no-store detector script serving. With debug disabled, the detector callback is dormant and the same public detector URLs serve the minified asset with cache headers.

## Security Notes

- Production requires `STATE_ENCRYPTION_KEY`; dev has a fallback for local testing.
- Cloud Run requires explicit school configuration through env vars or Secret Manager, including `TOOL_URL`, `CANVAS_DOMAIN`, LTI credentials, Canvas OAuth credentials, Firestore database ID, and runtime secrets.
- If `LTI_DEPLOYMENT_ID` is configured, launches from other Canvas deployment IDs are rejected.
- Sessions use `JSESSIONID` for legacy cookie compatibility and are stored in Firestore by hashed session ID.
- Secure cookies are used when the profile is prod or `TOOL_URL` is HTTPS.
- CORS allows Canvas domains, the configured tool origin, and localhost only in non-production.
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
