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

The coverage command enforces thresholds in `vite.config.ts`. The threshold intentionally covers shared models, config, data, HTTP helpers, and service logic. Controller behavior is verified through targeted service tests and local route smoke checks.

## Test Coverage Areas

The current automated tests cover:

- TypeScript domain model parsing for Classic Quiz and New Quiz IDs.
- App config profile, URL, Firestore database, and compatibility behavior.
- LTI launch claim extraction and encrypted state replay protection.
- JWK generation and production private-key requirements.
- Canvas API URL construction and access-code update behavior.
- Firestore/in-memory repository semantics.
- Content discovery and New Quiz SEB setting behavior.
- Quiz service enable/disable, access-code, and Browser Exam Key behavior.
- Deep-link module item rewrite behavior.
- SEB configuration plist generation and allowed-domain policy.
- SEB Config Key and access-proof token behavior.
- SEB request detection and Browser Exam Key validation.
- Static detector script serving.
- App shell escaping, forwarded URL handling, CORS allow-listing, and API error bodies.

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
- Open a SEB download page route if seeded data is available.
- Open the instructor dashboard from a real Canvas LTI launch in dev.

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
8. Cloud Build deploys to the existing service URL.
9. Canvas LTI launch and OAuth flows work in dev.
10. SEB `.seb` download, Config Key proof, access-code retrieval, and exit link work in SEB.
