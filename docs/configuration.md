# Configuration Reference

This application reads configuration from process environment variables. The checked-in [.env.example](../.env.example) is a local reference only; the process does not load `.env` files itself. In Cloud Run, supply ordinary values with `--set-env-vars` and secrets with `--set-secrets`.

## Profiles And Validation

`APP_ENV` determines the application profile:

| Value                    | Result                                              |
| ------------------------ | --------------------------------------------------- |
| `prod` or `production`   | Production profile. Hardened validation is enabled. |
| `test`                   | Test profile. The in-memory repository is selected. |
| Any other value or unset | Development profile.                                |

Cloud Run always enables hardened validation, including when `APP_ENV=dev`. A failing validation stops startup before the service listens. In a hardened runtime, the app requires real Canvas/LTI/OAuth values, Firestore, configuration encryption, and independent secrets; it rejects an in-memory store, debug mode, unsafe URLs, wildcard required domains, and a mismatched OAuth callback.

`NODE_ENV` controls Node/build behavior and is normally `production` in the runtime image. Set `APP_ENV` explicitly when the desired application profile differs from the Node environment.

## Required Runtime Values

| Variable                         | Purpose                                                      | Hardened-runtime requirements                                                         |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `NODE_ENV`                       | Node runtime mode.                                           | Set to `production` for the Cloud Run image.                                          |
| `APP_ENV`                        | Application profile.                                         | Use `dev` for an isolated non-production service or `prod` for production.            |
| `PORT`                           | HTTP listener port.                                          | Defaults to `8080`; Cloud Run provides it.                                            |
| `GCP_PROJECT_ID`                 | Google Cloud project used by Firestore.                      | Required. `GOOGLE_CLOUD_PROJECT` is accepted as an alias.                             |
| `FIRESTORE_DATABASE_ID`          | Firestore database ID.                                       | Required.                                                                             |
| `TOOL_URL`                       | Public base URL of this deployment.                          | Required HTTPS origin only; no path, query, fragment, or credentials.                 |
| `CANVAS_DOMAIN`                  | Base URL of the connected Canvas tenant.                     | Required HTTPS origin only; no path, query, fragment, or credentials.                 |
| `LTI_CLIENT_ID`                  | Canvas LTI 1.3 Developer Key client ID.                      | Required.                                                                             |
| `LTI_PRIVATE_KEY`                | RSA private JWK used to publish the tool JWKS.               | Required. Must be RSA, at least 2048 bits, exponent 65537, and compatible with RS256. |
| `LTI_DEPLOYMENT_ID`              | Canvas External App deployment ID.                           | Required. A comma/newline-separated allowlist is accepted.                            |
| `CANVAS_API_CLIENT_ID`           | Canvas API OAuth Developer Key client ID.                    | Required. This is distinct from `LTI_CLIENT_ID`.                                      |
| `CANVAS_API_CLIENT_SECRET`       | Canvas API OAuth Developer Key secret.                       | Required and must be treated as a secret.                                             |
| `SESSION_SECRET`                 | Express session signing secret.                              | Required, at least 32 characters, and different from `STATE_ENCRYPTION_KEY`.          |
| `STATE_ENCRYPTION_KEY`           | AES-GCM key material used to protect opaque LTI/OAuth state. | Required, at least 32 characters, and different from `SESSION_SECRET`.                |
| `SEB_CONFIG_ENCRYPTION_CERT_PEM` | PEM X.509 public certificate for `.seb` encryption.          | One certificate source is required and must be currently valid.                       |

`SEB_CONFIG_ENCRYPTION_CERT_PATH` is the file-based alternative to `SEB_CONFIG_ENCRYPTION_CERT_PEM`. Both hold public material only. [Certificate management](certificate-management.md) explains the required client private-identity handling.

## Canvas And LTI Endpoints

The normal Canvas cloud defaults are built in. Override them only for a Canvas environment with different LTI endpoints.

| Variable              | Default                                                | Notes                                                                                        |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `LTI_ISSUER`          | `https://canvas.instructure.com`                       | HTTPS issuer URL; a path is permitted, query/fragment/credentials are not.                   |
| `LTI_KEY_SET_URL`     | `https://sso.canvaslms.com/api/lti/security/jwks`      | HTTPS endpoint. Installation-specific query parameters are permitted.                        |
| `LTI_AUTH_URL`        | `https://sso.canvaslms.com/api/lti/authorize_redirect` | HTTPS endpoint. Installation-specific query parameters are permitted.                        |
| `CANVAS_API_BASE_URL` | `${CANVAS_DOMAIN}/api/v1`                              | In a hardened runtime it must be exactly the configured Canvas origin followed by `/api/v1`. |
| `CANVAS_REDIRECT_URI` | `${TOOL_URL}/api/oauth2callback`                       | If provided, it must equal that exact callback in a hardened runtime.                        |

The deployed registration document is `GET ${TOOL_URL}/lti/config`. It publishes `${TOOL_URL}/lti/login`, `${TOOL_URL}/lti/launch`, and `${TOOL_URL}/.well-known/jwks.json`.

## SEB Policy Values

| Variable                                | Default | Notes                                                                                                                                   |
| --------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SEB_QUIT_PASSWORD`                     | Unset   | Optional managed exit-password fallback. It must pass the password policy and must not be reused as a start password.                   |
| `SEB_REQUIRED_DOMAINS`                  | Empty   | Comma/newline list of concrete, reviewed hostnames required by every configuration. Wildcards and identity-provider hosts are rejected. |
| `SEB_CONFIG_ENCRYPTION_ENABLED`         | `true`  | Must remain `true` in a hardened runtime.                                                                                               |
| `SEB_CONFIG_ENCRYPTION_CERT_PEM`        | Unset   | Preferred public X.509 certificate input. Literal `\\n` is normalized to newlines.                                                      |
| `SEB_CONFIG_ENCRYPTION_CERT_PATH`       | Unset   | Public X.509 certificate file path.                                                                                                     |
| `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM`  | Unset   | Public-key fallback for local development. It is not enough for hardened runtime validation, which requires a certificate.              |
| `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH` | Unset   | File-based public-key fallback for local development.                                                                                   |

The password policy allows 8–128 characters and requires at least five distinct letters or numbers. It rejects common words, simple sequences, repetitive values, and control characters. The application preserves an existing password when an update field is blank; explicit UI controls remove a password.

## Firestore Collections

These names default to the values below and can be overridden for an isolated deployment:

| Variable                                | Default collection  | Contents                                                                |
| --------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `FIRESTORE_ASSESSMENTS_COLLECTION`      | `assessments`       | Assessment discovery state and SEB settings.                            |
| `FIRESTORE_COURSES_COLLECTION`          | `courses`           | Course defaults and exam-tool catalog.                                  |
| `FIRESTORE_OAUTH_TOKENS_COLLECTION`     | `canvasOAuthTokens` | Canvas OAuth tokens and student setup-prompt preference.                |
| `FIRESTORE_SESSIONS_COLLECTION`         | `sessions`          | Express session records.                                                |
| `FIRESTORE_TRANSIENT_STATES_COLLECTION` | `transientStates`   | One-time state, grants, proofs, session handoff, and admission budgets. |
| `FIRESTORE_OPERATION_LOCKS_COLLECTION`  | `operationLocks`    | Short assessment-update leases.                                         |

Configure Firestore TTL on the `expiresAt` field for `sessions`, `transientStates`, and `operationLocks`. Application logic checks expiry immediately; Firestore TTL is the eventual cleanup mechanism.

## Diagnostics And Local Values

| Variable                           | Default   | Notes                                                                                                 |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `HOST`                             | `0.0.0.0` | Bind address for a local process. Use `127.0.0.1` for local smoke tests.                              |
| `USE_IN_MEMORY_STORE`              | `false`   | Set to `true` only for local development or tests. Cloud Run rejects it.                              |
| `APP_DEBUG_ENABLED`                | `false`   | Enables readable detector serving and detector diagnostics behavior. Hardened runtime rejects `true`. |
| `APP_DETECTOR_DIAGNOSTICS_ENABLED` | `false`   | Records sanitized detector traces with more detail. Production profile rejects it.                    |
| `APP_ASSET_VERSION`                | Unset     | Optional cache-busting version for the React app shell; `K_REVISION` is used when present.            |

`ADMIN_PASSWORD` is accepted only as a local-development compatibility alias for `SESSION_SECRET`; do not use it in a deployed environment. Older aliases for LTI, Canvas API, project, or URL values are accepted by the config parser for transition purposes, but new deployments should use the canonical variables listed here.

## Secret Handling

Put the following in a secret manager rather than source control, shell history, build substitutions, or client-side code:

- `LTI_PRIVATE_KEY`
- `CANVAS_API_CLIENT_SECRET`
- `SESSION_SECRET`
- `STATE_ENCRYPTION_KEY`
- `SEB_QUIT_PASSWORD`, if used
- the public certificate value when organizational policy classifies it as a secret

The matching configuration-encryption private key and `.p12` identity are not runtime secrets. They must never be added to Cloud Run. See [Certificate management](certificate-management.md).

## Local Example

For route and UI smoke testing, this minimal shell environment is sufficient:

```bash
HOST=127.0.0.1 \
USE_IN_MEMORY_STORE=true \
TOOL_URL=http://localhost:8080 \
LTI_CLIENT_ID=test-client \
CANVAS_API_CLIENT_ID=test-client-id \
CANVAS_API_CLIENT_SECRET=test-client-secret \
npm start
```

Use actual Canvas, OAuth, Firestore, and certificate values only in a controlled integration environment. The local defaults are intentionally not a substitute for a real LTI or SEB configuration test.
