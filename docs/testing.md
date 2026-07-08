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
- LTI launch claim extraction, encrypted state replay protection, and cross-instance state consumption.
- JWK generation and production private-key requirements.
- Canvas API URL construction and access-code update behavior.
- Firestore/in-memory repository semantics, runtime session storage, transient one-time state, and operation lock behavior.
- Course-level SEB defaults and structured URL rule normalization.
- Content discovery and New Quiz SEB setting behavior.
- Quiz service enable/disable and access-code behavior.
- SEB configuration plist generation, canonical URL filter keys, and allowed-domain policy.
- SEB certificate-encrypted `pkhs` download wrapping, password-encrypted `pswd` wrapping, and plaintext fallback.
- SEB Config Key, compare-and-set Config Key persistence, and cross-instance access-proof token behavior.
- SEB request detection.
- Static detector script serving, safe base URL/debug injection, cache headers, and minified production asset selection.
- Canvas detector jsdom behavior for quiz ID extraction, access-code proof/fill, final submit redirects, debug logging, server trace callbacks, and external exam tools.
- App shell escaping, forwarded URL handling, CORS allow-listing, and API error bodies.
- Controller contracts for LTI login/launch routing, Canvas OAuth authorization/callback behavior, quiz/defaults APIs, SEB enforcement/download/proof/exit routes, public health/JWKS routes, and debug trace gating.
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
- Verify a student LTI launch shows only SEB-enabled assessments and no instructor controls.

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
10. SEB `.seb` download, Config Key proof, access-code retrieval, and exit link work in SEB.
11. With certificate encryption enabled, a machine without the matching private-key identity cannot open the downloaded config; a test machine with the generated/imported identity can open it and still completes Config Key proof.
12. For a quiz with an exam start password, SEB prompts for that password before loading Canvas, and configs downloaded before the password change fail Config Key proof.
