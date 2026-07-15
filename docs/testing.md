# Testing and Verification

## Local Quality Gate

Run this before deploying:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
```

The same non-browser gate is available as:

```bash
npm run verify
```

The coverage command enforces thresholds in `vite.config.ts`. The measured surface includes shared models, config, controllers, data repositories, HTTP helpers, and service logic. Browser-only client code remains outside the Vitest coverage gate and is covered through Playwright smoke tests plus manual Canvas/SEB verification when those environments are required.

Current global thresholds are intentionally set near the measured production-code baseline, not as a placeholder:

- 80% statements
- 80% lines
- 87% functions
- 66% branches

## Test Coverage Areas

The current automated tests cover:

- TypeScript domain model parsing for Classic Quiz and New Quiz IDs.
- App config profile, URL, Firestore database, and compatibility behavior.
- LTI launch claim extraction, stateless encrypted state issuance, initiating-browser transaction-cookie binding, atomic cross-instance replay claims, session regeneration, and strict issuer/target/deployment binding.
- JWK generation and production private-key requirements.
- Canvas API URL construction and access-code update behavior.
- Firestore/in-memory repository semantics, runtime session storage, transient one-time state, and operation lock behavior.
- Course-level SEB defaults and structured URL rule normalization.
- Content discovery and New Quiz SEB setting behavior.
- Quiz service enable/disable and access-code behavior.
- SEB configuration plist generation, explicit cross-platform lockdown keys, canonical URL filter keys, exact-query pinning, and allowed-domain policy.
- SEB certificate-encrypted `pkhs` download wrapping, password-encrypted `pswd` inner wrapping, and Cloud Run fail-closed encryption requirements.
- Deterministic SEB Config Key verification without download-time key persistence, setting-generation binding, and cross-instance single-use access-proof token behavior.
- SEB request detection.
- Static detector script serving, safe base URL/debug injection, cache headers, and minified production asset selection.
- Canvas detector jsdom behavior for quiz ID extraction, Classic and New Quiz access-code proof/fill (including proof-first asynchronous rendering, Canvas text/password/default-text input variants, ambiguous-field rejection, and Canvas's initially disabled New Quiz submit control), New Quiz attempt isolation, paused retries after Config Key or access-code failures until an explicit retry, silent one-time capability priming on attempt-history pages, Canvas-cancellable final submission, response-verified Classic Quiz form submission, authoritative Canvas results detection, failed-submission handling, session-bound exit grants, absence of ambient/automatic quit, privacy-safe debug logging, server trace callbacks, and gate-hidden/session-cached external exam tools.
- Session-handoff configuration registration and exact Config Key validation for both stable New Quiz assignment URLs and Canvas-generated New Quiz attempt URLs.
- App shell escaping, forwarded URL handling, exact configured-origin CORS, request-integrity checks, and API error bodies.
- Controller contracts for signed LTI login/launch routing, verified instructor/course/content authorization, session-bound mutation tokens, Canvas OAuth principal binding, redacted ordinary SEB responses plus explicit no-store password reveal, SEB enforcement/download/proof/exit routes, public health/JWKS routes, and debug trace gating.
- Static deployment hardening checks for immutable digest deployment and the retired secret-bearing certificate importer.
- Firestore adapter behavior through mocked Firestore collection, query, delete, and batch APIs.
- Production-build Playwright smoke coverage for health, JWKS, LTI dynamic registration metadata, detector compatibility paths, built assets, launch fallback, SEB exit UI, defensive SEB config downloads, and proof/access-code error handling.

## Local Server Smoke Test

Build first:

```bash
npm run build
```

Start the production build with the in-memory repository:

```bash
HOST=127.0.0.1 \
USE_IN_MEMORY_STORE=true \
TOOL_URL=http://localhost:8080 \
LTI_CLIENT_ID=test-client \
CANVAS_API_CLIENT_ID=test \
CANVAS_API_CLIENT_SECRET=test \
npm start
```

Smoke endpoints:

```bash
curl -i http://127.0.0.1:8080/health
curl -i http://127.0.0.1:8080/.well-known/jwks.json
curl -i http://127.0.0.1:8080/js/canvas-seb-detector.js
curl -i http://127.0.0.1:8080/seb/exit/course-1/classicquiz_quiz-1
curl -i http://127.0.0.1:8080/assets/index.js
```

Expected results:

- `health` returns 200 JSON with `status: "UP"`.
- JWKS returns JSON with at least one RSA key.
- detector script returns JavaScript.
- SEB exit route returns HTML app shell.
- React asset route returns JavaScript with HTTP 200.

## Browser Verification

Use Playwright or the Codex browser tooling against the running production build.

Minimum checks:

- Desktop viewport: open `/seb/exit/course-1/classicquiz_quiz-1`, verify no console errors and no layout overlap.
- Mobile viewport around 390x844: verify the same page remains readable and the quit button fits.
- Verify `/health`, `/.well-known/jwks.json`, `/lti/config`, `/js/canvas-seb-detector.js`, `/api/seb/canvas-detector.js`, and `/assets/index.js` return the expected production-build responses.
- Open a SEB download page route if seeded data is available.
- Open the instructor dashboard from a real Canvas LTI launch in dev.
- Verify the instructor setup wizard appears after first Canvas authorization for a course, then saves course defaults.
- Verify a student LTI launch shows only SEB-enabled assessments with verified, published, currently open Canvas state from a successful refresh no more than 24 hours old and no instructor controls. Remove or unpublish an assessment, refresh successfully, and confirm its retained instructor settings cannot mint a learner config grant. Also simulate a New Quiz discovery failure, expired/invalid verification timestamps, and a timestamp more than five minutes in the future; cached rows can remain available to the instructor but must be hidden and fail closed for learners.
- On both a Classic Quiz and New Quiz access-code page outside SEB, verify the detector popup's primary action launches that exact assessment through Canvas's installed external-tool URL and opens SEB without a second app-page click. Confirm the signed target, two-minute session handoff, and one-time configuration grant are required; reusing the handoff or grant must fail.
- In a normal browser, open the student course-navigation tool without a stored Canvas OAuth credential. Confirm it shows only **Connect Canvas**, completes the scoped Canvas authorization in a user-initiated popup, and returns to the in-frame dashboard without a reconnect control. Revoke the student credential or remove the session-token scope, run the setup check, and confirm the readiness failure returns the student to the connection gate.
- Launch both a Classic Quiz and a New Quiz from SEB with an empty SEB cookie jar. Confirm the generated config starts at Canvas's one-time session URL, reaches the assessment without a Google/SSO prompt, and its URL filter contains no identity-provider or legacy `ssoDomains` entries.

The committed Playwright smoke suite can be run with:

```bash
npm run test:e2e
```

## Regression Checklist

Before merging deployment changes:

1. Existing Java baseline tests have already been used as a reference for behavior extraction.
2. TypeScript tests pass.
3. Coverage thresholds pass.
4. Lint and typecheck pass.
5. Production build starts locally.
6. Health, JWKS, detector, app shell, and React assets return 200.
7. Browser console has no errors on desktop and mobile app-shell routes.
8. Cloud Build deploys to the configured Cloud Run service URL.
9. Canvas LTI launch and OAuth flows work in dev.
10. SEB `.seb` download, Config Key proof, access-code retrieval, generation-bound exit grant, and post-submission Quit Link work in SEB. The validated exit page follows the link after a two-second countdown without a second native SEB warning, and its button works immediately. Native or early quit still requires the configured password.
11. A machine without the matching private-key identity cannot open the downloaded config; a managed test machine with the non-extractable, app-restricted identity can open it and still completes Config Key proof.
12. For a quiz with an exam start password, SEB prompts for that password before loading Canvas, and configs downloaded before the password change fail Config Key proof.
13. New start and exit passwords shorter than 8 characters, longer than 128 characters, low-diversity, repetitive, sequential, or based on values such as `password`, `exam`, or `quit` are rejected without the submitted value appearing in the response or logs. Letters-only and numbers-only values are accepted when they contain at least five different characters and are not predictable. The validation response identifies the unmet rule. A blank field preserves the current secret. The start password cannot equal the effective quiz, course, or managed-server exit password.
14. Saved-password reveal requires a verified instructor, the exact launched course or assessment, and the session-bound management token. The response is `private, no-store`, the UI clears it after 30 seconds, ordinary settings/bootstrap responses remain redacted, and a managed server exit password is never returned.
15. Instructor bootstrap and API responses contain only `hasAccessCode`, `hasConfigKey`, `hasStartPassword`, `hasQuitPassword`, and `hasEffectiveQuitPassword` flags, never the corresponding secret values.
16. Cancelling or failing submission, changing the URL, adding completion-like page text, or submitting an unrelated form never quits SEB. A Classic Quiz can show the exit page only after a successful same-origin final-form response lands on the exact quiz-detail route and contains Canvas's completed-submission structure. A New Quiz requires Canvas's authoritative results UI. Quitting remains an explicit user action, and the passwordless Quit Link fails without a valid course/content/generation-bound exit grant and the exact config-bound Quit URL token.
17. Cloud Run reports the expected image `@sha256:...` digest for the revision produced by the build.
18. On the current school-approved stable SEB builds for both macOS and Windows, the setup check and Config Key proof pass; older/unapproved builds are blocked by device policy.
19. During a real assessment, app/user switching, extra displays, virtual machines, screen capture/sharing, clipboard transfer outside SEB, developer tools, OS escape shortcuts, printing, downloads, uploads, and open/save panels remain blocked. Canvas Classic Quiz/New Quiz navigation, reload, text entry, final submission, native password-protected quit, and every explicitly approved web tool still work.
    - On a Mac, both the setup check and a real assessment run in AAC assessment mode (the SEB log reports AAC/assessment session start, and macOS screenshot shortcuts are OS-blocked rather than SEB-suppressed), and quitting cleanly ends the AAC session. A Mac running macOS older than 12.1 is refused with SEB's version-restriction message instead of silently falling back to classic kiosk mode.
20. An exact external-tool rule rejects added or changed query parameters, fragments, path suffixes, and redirect targets; Canvas's own dynamic quiz/assignment query parameters still work.
21. Enabling Classic and New Quizzes without a quiz/course or managed server exit password fails before Canvas access codes are changed; clearing a course password cannot strand an enabled assessment without protection.
22. Assessment config generation without an effective exit password fails, while the setup-check config remains the deliberate passwordless quit exception.
23. The Exam tools sidebar is absent on Classic and New Quiz access-code gates and attempt-history pages, then appears immediately from the tab-session capability cache on the active `/take` page. On an exact New Quiz assignment or `/launch` route, strict Config Key proof and one-time access-code redemption start once even when no challenge DOM exists yet; no error overlay appears unless a trusted challenge is visible. The field is filled when the gate later renders, including when Canvas's Submit button is initially disabled or omits the previously observed automation marker, provided exactly one contextual Submit control exists.
24. Launching SEB never automatically navigates the ordinary browser tab back to Canvas. The visible Return to course button remains available, while reopening a stale or replayed assessment LTI launch redirects to the configured Canvas course homepage instead of showing an invalid-launch error page.
