# Architecture

## Purpose

This service connects Canvas LMS to Safe Exam Browser (SEB). Instructors launch the tool from Canvas, authorize Canvas API access, choose which quizzes require SEB, and the service updates Canvas access codes and module links. Students receive SEB configuration files and are redirected back into Canvas only after SEB can prove it is using the generated configuration.

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
  -> quizzes, settings, content, OAuth tokens, module update audit data
```

## Main Components

- `src/server/main.ts`: Nest bootstrap, session cookies, CORS, static React assets.
- `src/server/config/app-config.ts`: environment normalization and compatibility with old Spring profile variables.
- `src/server/data/repositories.ts`: Firestore-backed repositories plus in-memory stores for tests and local smoke checks.
- `src/server/controllers/lti.controller.ts`: Canvas LTI login, launch, config, and deep-link endpoints.
- `src/server/controllers/oauth.controller.ts`: Canvas OAuth2 authorize/callback/status flow.
- `src/server/controllers/quiz.controller.ts`: instructor quiz APIs for refresh, enable, disable, regenerate, status, and structured SEB settings.
- `src/server/controllers/seb.controller.ts`: student SEB routes, config downloads, proof/access-code APIs, validation, redirects, and exit pages.
- `src/server/services/canvas-api.service.ts`: Canvas REST/New Quiz API calls and OAuth token usage.
- `src/server/services/quiz.service.ts`: Classic Quiz persistence and SEB enable/disable behavior.
- `src/server/services/content.service.ts`: New Quiz and non-classic Canvas content behavior.
- `src/server/services/seb-configuration.service.ts`: `.seb` plist generation and allowed-domain policy.
- `src/server/services/seb-config-key.service.ts`: Config Key hashing and proof validation.
- `src/server/services/seb-access-proof.service.ts`: short-lived one-time proof tokens.
- `src/client/app.tsx`: React views for instructor dashboard, SEB-required/download pages, and exit pages.

Tooling and CI choices are documented separately in `docs/tooling.md`.

## Data Model

Classic quiz settings are keyed by Canvas quiz ID. New Quiz settings and content items use:

```text
newquiz:{courseId}:{assignmentId}
```

Classic quiz LTI content IDs use:

```text
classicquiz_{quizId}
```

Firestore collections:

- `quizzes`: Classic Quiz metadata discovered from Canvas.
- `sebSettings`: Classic Quiz SEB settings and generated access-code/config-key state.
- `contentItems`: New Quiz/content metadata discovered from Canvas.
- `contentSebSettings`: New Quiz/content SEB settings.
- `oauthTokens`: Canvas OAuth access and refresh tokens per Canvas user.
- `module_item_updates`: audit data for Canvas module rewrites.

## LTI Flow

1. Canvas starts OIDC login at `/lti/login`.
2. The service creates encrypted state and nonce using `LtiStateService`.
3. The browser is redirected to Canvas authorization.
4. Canvas posts or redirects back to `/lti/launch`.
5. `LtiService` validates the ID token against Canvas JWKS, issuer, audience, nonce, and deployment claims.
6. Launch data is stored in the session.
7. The instructor UI renders with course/user context and quiz management actions.

The public JWKS endpoint is `/.well-known/jwks.json`. In production the private key must come from `LTI_PRIVATE_KEY`.

## Canvas OAuth Flow

LTI launch proves Canvas identity but does not provide the Canvas API token needed to update quizzes and modules. Instructor API actions use a separate Canvas OAuth2 flow:

1. `/api/oauth2authorize` creates an encrypted state and redirects to Canvas.
2. Canvas redirects to `/api/oauth2callback`.
3. The service exchanges the code for access/refresh tokens.
4. Tokens are stored in Firestore in `oauthTokens`.
5. `CanvasApiService` uses the token for quiz, New Quiz, assignment, and module calls.

## SEB Enforcement Flow

1. Instructor enables SEB for a quiz/content item.
2. The service generates a secure access code.
3. Canvas is updated:
   - Classic Quiz: quiz access code via Canvas quiz API.
   - New Quiz: New Quiz API access code endpoint.
4. The SEB setting is saved with `sebRequired`, `enabled`, `accessCode`, and a Browser Exam Key.
5. Module items are rewritten to point to the tool launch where possible.
6. Student launches the assessment.
7. Non-SEB browsers receive a React page that offers the `.seb` configuration download.
8. Downloading the config generates and persists a Config Key.
9. SEB opens the configured Canvas URL.
10. The detector script validates Config Key proof and retrieves the access code through a one-time proof token.

## Security Notes

- Production requires `STATE_ENCRYPTION_KEY`; dev has a fallback for local testing.
- Sessions use `JSESSIONID` for legacy cookie compatibility.
- Secure cookies are used when the profile is prod or `TOOL_URL` is HTTPS.
- CORS allows Canvas domains, the configured tool origin, and localhost only in non-production.
- Access-code APIs return real HTTP 403/404/409 statuses for failed proof or missing SEB state.
- The detector script never receives an access code until Config Key proof succeeds.
- Config proof tokens are single-use and short lived.

## React UI

The React app is not a marketing site. It renders operational views:

- instructor dashboard for quiz/content SEB management
- OAuth authorization state
- SEB download/required pages
- SEB completion and quit pages

The UI uses text labels and Lucide icons, not emoji, and is designed to work inside Canvas iframes and SEB.
