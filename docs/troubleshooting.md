# Troubleshooting

Diagnose Safe Online Exam by locating the boundary that failed. A Canvas iframe
error, OAuth error, SEB launch error, detector error, and database readiness
error have different evidence and should not be treated as one generic launch
problem.

## Start With Safe Evidence

Record the release version or Cloud Run revision, approximate timestamp and
time zone, user role, Canvas course, assessment type, browser/OS/SEB version,
and exact visible message.

Never collect or paste:

- Canvas access or refresh tokens;
- browser cookies or session IDs;
- Canvas access codes;
- one-time Canvas session URLs;
- `.seb` files from live assessments;
- `LTI_PRIVATE_KEY`, database passwords, or state/session secrets;
- the SEB `.p12`, private key, or identity password; or
- student responses or personally identifiable information.

Check the public, secret-free endpoints first:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/ready"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsS "${TOOL_URL}/lti/config"
curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
curl -fsS "${TOOL_URL}/js/canvas-seb-theme-loader.js" | head
```

- `/health` confirms the HTTP process is running.
- `/ready` also checks PostgreSQL and the complete migration set.
- The JWKS, LTI configuration, and detector requests confirm the public origin
  and key Canvas-facing assets.

An HTTP 200 health response alone does not validate Canvas configuration,
OAuth, PostgreSQL migrations, certificate decryption, Config Key proof, or a
real SEB client.

## Service And Database Problems

| Symptom                                      | Likely boundary                     | Checks                                                                                         |
| -------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/health` fails                              | Ingress, service, container, or DNS | Service status, revision/container logs, public DNS/TLS, target port, and bind address         |
| `/health` succeeds but `/ready` fails        | PostgreSQL or migrations            | Database reachability, credentials, pool limits, migration job result, and migration checksums |
| Startup reports invalid configuration        | Hardened runtime validation         | Compare the exact message with [Configuration](configuration.md); do not weaken validation     |
| Intermittent 5xx or timeouts under load      | Database/upstream capacity          | PostgreSQL connections, `DATABASE_POOL_MAX × instances`, Canvas response latency, and job load |
| Expired state or session tables keep growing | Cleanup job or scheduler            | Last successful cleanup execution, scheduler identity, and cleanup logs                        |

For Cloud Run, inspect the active service revision and migration/cleanup job
executions. For Compose, inspect `docker compose ps`, the one-shot migration
result, application logs, PostgreSQL health, disk space, and the named
`postgres_data` volume. Do not expose PostgreSQL publicly to make diagnosis
easier.

## LTI Launch Problems

| Visible result                            | Meaning and safe recovery                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sso.canvaslms.com refused to connect`    | A self-hosted Canvas is using the cloud authorization default. Configure its actual `LTI_AUTH_URL` and `LTI_KEY_SET_URL`, deploy, and relaunch.          |
| `Canvas Signing-Key Error`                | Canvas published an RSA signing key below the service’s 2048-bit minimum. Rotate Canvas platform LTI keys, restart/reload Canvas, and relaunch.          |
| `LTI Deployment Configuration Required`   | The signed deployment ID is not in `LTI_DEPLOYMENT_ID`. Confirm the installed app and append the exact intended ID before deploying.                     |
| `Canvas Configuration Error`              | Required signed user/account/course substitutions are absent. Refresh the LTI registration from `${TOOL_URL}/lti/config`, reinstall if needed, relaunch. |
| `Invalid LTI Launch`                      | Signature, issuer, audience, nonce, browser binding, state, target URI, or token timing failed. Compare Canvas registration with the deployed config.    |
| Tool says the role is not authorized      | The signed launch role does not permit that view. Test from the intended course or root-account placement with a separate correctly assigned account.    |
| Launch returns to `/login` outside Canvas | No valid LTI session exists. Reopen the tool from Canvas instead of bookmarking an internal route.                                                       |

For repeated launch failures, compare:

- `LTI_ISSUER` with the actual signed `iss` claim;
- Canvas’s LTI client ID with `LTI_CLIENT_ID`;
- the installed deployment ID with the configured allowlist;
- login, target-link, redirect, and public JWKS URLs with `/lti/config`; and
- the public origin with `TOOL_URL`.

Do not disable deployment-ID checking as a quick fix. That setting is only for
a reviewed self-service installation model where anyone allowed to install the
configured client ID is intentionally trusted.

## Canvas OAuth Problems

| Symptom                                      | Check                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connect Canvas** appears after LTI success | The current Canvas user has no usable OAuth grant. Complete the prompted authorization.                                                            |
| `invalid_scope`                              | The API Developer Key does not permit the complete exact scope set in [Canvas setup](canvas-setup.md#1-create-the-canvas-api-oauth-developer-key). |
| Redirect URI mismatch                        | Canvas and `CANVAS_REDIRECT_URI` must use exactly `${TOOL_URL}/api/oauth2callback`.                                                                |
| A feature works for one role but not another | Reauthorize after scope changes; confirm the Canvas user actually has the corresponding course/account permission.                                 |
| Popup completed but the LTI page did not     | Return to Canvas and reopen the tool. Popup blocking or loss of the exact opener can prevent the fixed completion message from refreshing it.      |
| Course-copy picker is empty                  | Reconnect after OAuth scope version changes and confirm the user is an active teacher in another course.                                           |
| Root-account dashboard cannot load courses   | Use `/api/admin/oauth2authorize`, confirm root-account permissions and all administrator scopes, then reconnect.                                   |

The LTI Developer Key and API OAuth Developer Key are separate registrations.
Do not exchange their client IDs or secrets.

## Assessment Synchronization Problems

| Symptom                                     | Check                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A quiz is missing                           | Refresh the course; confirm it is a Classic Quiz or New Quiz and the OAuth user can access it.                                |
| A student cannot launch a listed assessment | Confirm the latest discovery is verified, the item is published, and the global Canvas unlock/lock window is open.            |
| Enable/disable reports a Canvas error       | Inspect the Canvas permission/upstream response. Refresh before retrying; do not manually create divergent access-code state. |
| Old `.seb` file stopped working             | A protected setting or certificate changed. Download a fresh configuration from a new launch.                                 |
| Tool copy fails for one target              | Confirm the source tool is instructor-owned and the same OAuth user is currently a teacher in the target course.              |
| School preset shows a failed rollout        | Fix the target course authorization/problem, then use the dashboard’s reconcile/retry action.                                 |

The service deliberately fails closed when cached Canvas discovery is missing
or stale. Restoring availability should come from a successful Canvas refresh,
not by editing database documents.

## Detector And Canvas Theme Problems

Use the browser developer console on a non-sensitive test assessment.

1. Confirm the active Canvas account/sub-account theme includes the loader.
2. Confirm the loader requests
   `${TOOL_URL}/js/canvas-seb-detector.js` only on supported assessment routes.
3. Confirm the request succeeds without CSP, mixed-content, DNS, or TLS errors.
4. Confirm the detector does not load twice.

The supported paths are:

- Classic Quiz: `/courses/:courseId/quizzes/:quizId/take`
- New Quiz: `/courses/:courseId/assignments/:assignmentId` and its
  Canvas-generated descendants

If a self-hosted Canvas returns HTTP `422` with
`ActionController::InvalidCrossOriginRequest` for its locally stored theme
JavaScript attachment, use the externally hosted
`${TOOL_URL}/js/canvas-seb-theme-loader.js` workaround documented in
[Canvas setup](canvas-setup.md#self-hosted-canvas-local-file-workaround), or
move Canvas theme assets to supported object storage. Do not disable Canvas
CSRF protection.

`APP_DETECTOR_DIAGNOSTICS_ENABLED=true` adds sanitized server-side detector
tracing for development only. Production profile validation rejects it. Use a
separate test deployment if more detail is required.

## Student And Device Problems

| Symptom                                          | Check                                                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Browser asks which app should open the link      | Install a supported Safe Exam Browser client and retry from a fresh launch.                                                              |
| Nothing happens after **Open Safe Exam Browser** | Wait for the recovery panel, confirm the browser permits the `sebs://` handoff, then retry. OS/browser protocol handling is client-side. |
| SEB cannot decrypt the configuration             | Confirm the correct private identity is installed in the intended device/user scope and its public-key hash matches the active service.  |
| A device worked before certificate rotation      | Confirm the replacement identity arrived, then download a fresh configuration.                                                           |
| Setup check says reconnect is required           | Return to Canvas, select **Reconnect Canvas**, and rerun the check.                                                                      |
| Config Key proof fails                           | Use a fresh configuration and supported SEB client; verify the assessment and certificate have not changed since download.               |
| Access-code prompt is not filled                 | Confirm the detector loaded, the page has one recognizable Canvas prompt, and valid Config Key proof succeeded.                          |
| Approved tool is blocked                         | Review the exact launch URL and required resource hosts. Broaden only the reviewed tool rule—not the global filter.                      |
| Exit does not appear after submission            | Confirm Canvas shows its authoritative completed state. A cancelled confirmation or intermediate page must not grant exit.               |

The setup check is a readiness aid, not device attestation. Device-management
status, operating-system policy, assistive-technology compatibility, and the
approved SEB version must be verified separately.

## Certificate Problems

If encryption is enabled, hardened startup requires a currently valid
end-entity X.509 certificate with an RSA key suitable for encryption. The
server must receive only the public certificate.

Compare the active certificate:

```bash
curl -fsSI "${TOOL_URL}/seb/config-encryption-certificate.cer"
curl -fsS "${TOOL_URL}/seb/config-encryption-certificate.pem" -o /tmp/seb-config-certificate.pem
openssl x509 -in /tmp/seb-config-certificate.pem -noout -subject -issuer -dates -fingerprint -sha256
```

The response includes `x-seb-public-key-hash`; compare it with the identity
distributed to clients. Delete the temporary public certificate after use if
your local policy requires it.

Do not upload the `.p12` or private PEM to the service. If the private identity
may be compromised, pause affected assessments, rotate it, distribute the new
identity, update the service’s public certificate, and require fresh
configurations. Do not switch production to plaintext as an incident shortcut.

## Escalation Checklist

Before opening a non-sensitive issue, confirm:

- the problem reproduces on the current supported `1.x` release;
- `/health`, `/ready`, JWKS, LTI configuration, and detector endpoint results;
- the exact role, placement, assessment type, and failure stage;
- whether a fresh Canvas authorization and fresh `.seb` configuration change
  the result;
- whether it reproduces in an isolated test course and test account; and
- logs have been redacted of credentials, tokens, session URLs, user data, and
  school-private hostnames when those are not essential.

Use [GitHub private vulnerability reporting](https://github.com/JSB2010/safe-online-exam/security/advisories/new)
for any suspected security issue. Do not test against school or production
systems without authorization.
