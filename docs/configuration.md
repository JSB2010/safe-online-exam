# Configuration Reference

The application reads process environment variables. It does not load `.env`
files itself; [`.env.example`](../.env.example) is a local-development
reference and Compose explicitly loads an environment file. Protect local
production files with `chmod 600 .env` and keep them outside version control.

For a new deployment, use the template shipped with that deployment mode:

- source checkout: [`.env.example`](../.env.example);
- Compose source topology: [`.env.compose.example`](../.env.compose.example)
  or [`.env.compose.secrets.example`](../.env.compose.secrets.example); and
- Cloud Run release bundle:
  [`deploy/cloudrun.env.example`](../deploy/cloudrun.env.example).

Do not combine templates blindly. Deployment-only variables such as
`APP_IMAGE`, `PROJECT_ID`, or `PUBLIC_HOST` are consumed by scripts/Compose and
are not application runtime settings.

## Profiles And Validation

Profile resolution uses the first non-empty value from `APP_ENV`, `NODE_ENV`, and the compatibility alias `SPRING_PROFILES_ACTIVE`:

| Resolved value                       | Result                                             |
| ------------------------------------ | -------------------------------------------------- |
| `prod` or `production`               | Production profile and hardened validation.        |
| `test`                               | Test profile; in-memory repositories are selected. |
| Any other value, or all values unset | Development profile.                               |

Cloud Run is always treated as hardened, including an isolated `APP_ENV=dev` service. Hardened validation requires real database, Canvas, LTI, OAuth, secret, URL, and certificate values. Startup fails before listening if the configuration is unsafe or incomplete.

The parser retains a small number of historical aliases for maintained
deployments, including `APP_BASE_URL`, `CANVAS_BASE_URL`, `DEPLOYMENT_ID`, and
the `DEV_*`/`PROD_*` credential names. New public installations should use the
canonical names in this guide. In a hardened runtime, any supplied
`APP_BASE_URL` or `BASE_URL` must match `TOOL_URL`.

## PostgreSQL

PostgreSQL 17 or newer is the supported durable store. The application uses ordinary PostgreSQL protocol settings and is not tied to a managed provider.

| Variable                         | Default      | Notes                                                                                            |
| -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `DATABASE_HOST`                  | `127.0.0.1`  | Hostname, IP, or Unix socket directory. Required in hardened runtimes.                           |
| `DATABASE_PORT`                  | `5432`       | Integer from 1–65535. For Cloud SQL sockets this remains `5432`.                                 |
| `DATABASE_NAME`                  | `canvas_seb` | Dedicated application database. Required in hardened runtimes.                                   |
| `DATABASE_USER`                  | `canvas_seb` | Application role. Required in hardened runtimes.                                                 |
| `DATABASE_PASSWORD`              | Unset        | Required in hardened runtimes. Prefer `DATABASE_PASSWORD_FILE`.                                  |
| `DATABASE_PASSWORD_FILE`         | Unset        | Absolute/readable file containing the password. Conflicts with the direct variable.              |
| `DATABASE_SSL_MODE`              | `disable`    | `disable`, `require`, `verify-ca`, or `verify-full`. Use verification over untrusted networks.   |
| `DATABASE_POOL_MAX`              | `5`          | Per-process maximum, 1–100. Size the database for pool max multiplied by app instances/jobs.     |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `10000`      | Connection acquisition timeout, 100–120000 ms.                                                   |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | `30000`      | Server-side statement timeout, 100–600000 ms.                                                    |
| `DATABASE_CLEANUP_BATCH_SIZE`    | `500`        | Cleanup-job batch size, 1–10000. This is read by the cleanup command rather than normal startup. |

Cloud Run connects to Cloud SQL with `DATABASE_HOST=/cloudsql/PROJECT:REGION:INSTANCE` and `DATABASE_SSL_MODE=disable`; the authenticated Unix socket is local to the Cloud Run sandbox. A VM or external managed PostgreSQL connection should normally use `verify-full` with a trusted certificate chain. If the provider uses a private certificate authority, mount the CA file and set Node's `NODE_EXTRA_CA_CERTS` to that path before process startup.

The migration ledger is `schema_migrations`. Application/runtime data uses nine tables:

| Table                           | Contents                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| `admin_course_connections`      | Root-scoped Canvas course metadata and summary counts.       |
| `admin_account_settings`        | Root-scoped persisted operational-term selection.            |
| `admin_tool_presets`            | School-managed tool definitions.                             |
| `admin_tool_preset_assignments` | Durable per-course rollout state and failures.               |
| `assessments`                   | Assessment discovery state and SEB settings.                 |
| `courses`                       | Course defaults and exam-tool catalog.                       |
| `canvas_oauth_tokens`           | Purpose-scoped Canvas OAuth tokens and student preference.   |
| `sessions`                      | Express session records with expiry.                         |
| `transient_states`              | One-time states, grants, proofs, handoffs, and rate budgets. |
| `operation_locks`               | Short assessment-update leases.                              |

Run `npm run db:migrate` before a new application revision. Run `npm run db:cleanup` on a schedule to remove expired rows in bounded batches. Readiness returns failure when PostgreSQL is unavailable or the checked-in migrations have not all been applied.

## Required Application Values

| Variable                             | Purpose                                                 | Hardened requirement                                                                                                  |
| ------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                           | Node runtime mode.                                      | `production` for the deployed image.                                                                                  |
| `APP_ENV`                            | Application profile.                                    | `dev` for isolated non-prod; `prod` for production.                                                                   |
| `PORT`                               | HTTP port.                                              | Defaults to `8080`; platforms may inject it.                                                                          |
| `TOOL_URL`                           | Public origin of this deployment.                       | HTTPS origin only, with no path/query/credentials.                                                                    |
| `CANVAS_DOMAIN`                      | Connected Canvas origin.                                | HTTPS origin only.                                                                                                    |
| `LTI_CLIENT_ID`                      | Canvas LTI 1.3 Developer Key client ID.                 | Required.                                                                                                             |
| `LTI_PRIVATE_KEY`                    | RSA private JWK used for tool signing.                  | RSA 2048+ bits, exponent 65537, RS256-compatible.                                                                     |
| `LTI_DEPLOYMENT_ID_CHECKING_ENABLED` | Enforce the configured deployment-ID allowlist.         | Defaults to `true`. Set `false` only for a controlled self-service course-install rollout.                            |
| `LTI_DEPLOYMENT_ID`                  | Installed External App deployment ID.                   | Required when checking is enabled; comma/newline allowlist supported.                                                 |
| `CANVAS_API_CLIENT_ID`               | Canvas API OAuth Developer Key client ID.               | Required and distinct from the LTI key.                                                                               |
| `CANVAS_API_CLIENT_SECRET`           | Canvas API OAuth secret.                                | Required secret.                                                                                                      |
| `SESSION_SECRET`                     | Express session signing secret.                         | At least 32 characters and different from state encryption.                                                           |
| `STATE_ENCRYPTION_KEY`               | AES-GCM material for opaque LTI/OAuth state.            | At least 32 characters and different from session signing.                                                            |
| `SEB_CONFIG_ENCRYPTION_CERT_PEM`     | Public X.509 certificate used to encrypt `.seb` output. | Required when certificate encryption is enabled; valid end-entity RSA certificate whose Key Usage permits encryption. |

`SEB_CONFIG_ENCRYPTION_CERT_PATH` is the public-certificate file alternative. The matching private key is never a server input; it remains on managed SEB clients. Neither certificate input is required when certificate encryption is disabled.

`LTI_PRIVATE_KEY`, `CANVAS_API_CLIENT_SECRET`, `DATABASE_PASSWORD`,
`SESSION_SECRET`, `STATE_ENCRYPTION_KEY`, and `SEB_QUIT_PASSWORD` also have the
file alternatives listed below. Use only one form for each value.

## Deployment-ID Policy

`LTI_DEPLOYMENT_ID_CHECKING_ENABLED=true` is the default and restricts launches to the IDs in `LTI_DEPLOYMENT_ID`. Set it to `false` only when the configured Canvas issuer and LTI client ID are intentionally trusted to create course-level installations. Disabled mode still requires Canvas's signed deployment-ID claim and retains token signature, issuer, audience, nonce, target-link, and browser/state binding validation; it removes only the preconfigured deployment-ID allowlist.

## File-Based Secrets

The following secret values accept a mutually exclusive `_FILE` alternative:

- `DATABASE_PASSWORD_FILE`
- `LTI_PRIVATE_KEY_FILE`
- `CANVAS_API_CLIENT_SECRET_FILE`
- `SESSION_SECRET_FILE`
- `STATE_ENCRYPTION_KEY_FILE`
- `SEB_QUIT_PASSWORD_FILE`

Files are read once during configuration startup. The app rejects a direct value and its `_FILE` alternative being set together and reports unreadable paths without echoing secret contents. Required-value validation rejects a missing or empty result. Docker/Kubernetes secret mounts work without provider-specific SDKs.

The checked-in `compose.secrets.yaml` override clears direct secret variables and supplies these file paths to the app, migration, and cleanup processes. It also gives the PostgreSQL image the same database password through its native `POSTGRES_PASSWORD_FILE` input. Start it with `.env.compose.secrets.example`. On a Linux host, keep the containing directory mode `0700`; Compose mounts only the named files into each service, and container-readable source files can be mode `0644` within that protected directory.

## Canvas And LTI Endpoints

Canvas cloud defaults are built in. Override the authorization and JWKS URLs for a Canvas environment with different LTI endpoints. `LTI_ISSUER` must equal the `iss` value in that Canvas's launch request; do not assume it equals `CANVAS_DOMAIN`, because a self-hosted Canvas can retain the standard Canvas issuer.

| Variable              | Default                                                | Notes                                                            |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `LTI_ISSUER`          | `https://canvas.instructure.com`                       | HTTPS issuer URL.                                                |
| `LTI_KEY_SET_URL`     | `https://sso.canvaslms.com/api/lti/security/jwks`      | Canvas platform JWKS endpoint.                                   |
| `LTI_AUTH_URL`        | `https://sso.canvaslms.com/api/lti/authorize_redirect` | Canvas OIDC authorization endpoint.                              |
| `CANVAS_API_BASE_URL` | `${CANVAS_DOMAIN}/api/v1`                              | Must match the configured Canvas origin in hardened runtimes.    |
| `CANVAS_REDIRECT_URI` | `${TOOL_URL}/api/oauth2callback`                       | If supplied, must equal the exact callback in hardened runtimes. |

The registration document is `${TOOL_URL}/lti/config` and publishes the login, launch, and JWKS endpoints.

`LTI_PRIVATE_KEY` is the tool’s own signing key. It is unrelated to Canvas’s
platform JWKS at `LTI_KEY_SET_URL` and unrelated to the SEB configuration
certificate. Generate it with `npm run generate:lti-key` or the release
bundle’s bootstrap helper; never reuse another application’s JWK.

## SEB And Diagnostics

| Variable                                | Default   | Notes                                                                                                                                                                               |
| --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEB_QUIT_PASSWORD`                     | Unset     | Optional managed exit-password fallback; must pass password policy.                                                                                                                 |
| `SEB_REQUIRED_DOMAINS`                  | Empty     | Concrete reviewed hostnames; wildcards and identity-provider hosts are rejected.                                                                                                    |
| `SEB_CONFIG_ENCRYPTION_ENABLED`         | `true`    | Set explicitly to `false` to disable certificate wrapping for this instance, including hardened runtimes. A teacher-set start password still wraps that assessment's configuration. |
| `SEB_CONFIG_ENCRYPTION_CERT_PATH`       | Unset     | Public certificate path; used by the Compose secret mount.                                                                                                                          |
| `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM`  | Unset     | Local-development fallback; insufficient for hardened validation.                                                                                                                   |
| `SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PATH` | Unset     | File form of the local public-key fallback.                                                                                                                                         |
| `HOST`                                  | `0.0.0.0` | Bind address.                                                                                                                                                                       |
| `USE_IN_MEMORY_STORE`                   | `false`   | Local/test only; hardened runtimes reject it.                                                                                                                                       |
| `APP_DEBUG_ENABLED`                     | `false`   | Hardened runtimes reject true.                                                                                                                                                      |
| `APP_DETECTOR_DIAGNOSTICS_ENABLED`      | `false`   | Sanitized detector detail; production profile rejects true.                                                                                                                         |
| `APP_ASSET_VERSION`                     | Unset     | Optional client cache version; `K_REVISION` is used when present.                                                                                                                   |

Generated configurations use a Safari-compatible browser user agent on macOS so Google Sheets selects its full-resolution canvas path. SEB appends its own identifier to that user agent. Windows configurations retain SEB's native Chromium-based browser user agent.

Certificate encryption is the default because it restricts a configuration to devices holding the matching private identity. Set `SEB_CONFIG_ENCRYPTION_ENABLED=false` only for an instance whose devices cannot receive that identity. The setting leaves Config Key proof, one-time configuration grants, Canvas session handoff, URL filtering, and SEB lockdown policies enabled, but it does not make a downloaded configuration device-specific. If an instructor sets a start password, SEB still password-protects that configuration.

## Secret Rotation

Rotate one secret at a time and create a new immutable secret version. Update the runtime to the numbered version, deploy, smoke test, then disable the old version. Rotating `SESSION_SECRET` invalidates sessions; rotating `STATE_ENCRYPTION_KEY` invalidates outstanding opaque state; rotating LTI signing material requires Canvas/JWKS coordination; rotating the SEB certificate requires distributing the matching new private identity and issuing fresh configurations.

For Cloud Run, the checked-in builds deliberately use numbered Secret Manager versions and never `latest`. The exact dev, prod, and parameterized secret names and bootstrap order are documented in [Deployment](deployment.md).
