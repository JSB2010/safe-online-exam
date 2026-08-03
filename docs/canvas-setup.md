# Canvas Installation And Setup

This guide is for a Canvas root-account administrator installing a deployed
Safe Online Exam service. Complete [Configuration](configuration.md) and the
initial [deployment](deployment.md) first: the public `TOOL_URL` must be final
before creating Canvas registrations. For Docker/VPS, establish DNS and TLS
before creating either Developer Key. The Cloud Run bundle reserves the stable
URL before it pauses for the Canvas steps.

Canvas changes its administrative interface over time. The durable contract is
the pair of Developer Keys, the external-app installation, and the theme
loader—not a particular button position. In current Canvas terminology, LTI
1.3 tools may be installed manually by JSON, configuration URL, or UI; this
service provides the configuration URL `${TOOL_URL}/lti/config`. It does not
implement the separate OpenID Dynamic Registration protocol. See Canvas’s
[LTI registration documentation](https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.registration)
and [OAuth documentation](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)
when the current UI differs from this guide.

The service is portable across Canvas environments, but each deployment is configured for one Canvas origin. Keep separate client IDs, deployment IDs, OAuth credentials, PostgreSQL databases, secrets, and service URLs for environments that must remain isolated.

## Deployment Boundary

### Why a second Canvas needs a second deployment

The service has one active LTI platform configuration: `CANVAS_DOMAIN`, `LTI_ISSUER`, `LTI_KEY_SET_URL`, `LTI_AUTH_URL`, `LTI_CLIENT_ID`, and `LTI_DEPLOYMENT_ID`. Canvas cloud values are the defaults. If a service configured with those defaults is registered in a self-hosted Canvas, `/lti/login` redirects the embedded tool frame to `sso.canvaslms.com`; that page is intentionally not embeddable by the self-hosted Canvas and the browser shows `sso.canvaslms.com refused to connect`.

Deploy a separate service for each independent Canvas instance. For self-hosted Canvas, set its JWKS and authorization endpoints (normally `${CANVAS_DOMAIN}/api/lti/security/jwks` and `${CANVAS_DOMAIN}/api/lti/authorize_redirect`). Set `LTI_ISSUER` to the exact `iss` value Canvas sends, not by inferring it from `CANVAS_DOMAIN`: a self-hosted Canvas can still use `https://canvas.instructure.com` as its issuer. See [Configuration](configuration.md#canvas-and-lti-endpoints) and the self-hosted overrides in [Deployment](deployment.md#maintained-source-based-cloud-build-deployments).

### Self-hosted Canvas signing keys

Canvas must sign LTI launch tokens with an RSA key of at least 2048 bits. Before registering a tool, inspect `${CANVAS_DOMAIN}/api/lti/security/jwks`; do not use the legacy sample JWKs shipped with some Canvas Docker configurations. A verifier must reject undersized `RS256` keys rather than accepting a weaker platform signature.

For a running Canvas instance, rotate the three platform keys through Canvas's
own `Lti::KeyStorage` and restart its web service so its JWKS response reloads
the new keys. Canvas internal APIs are version-sensitive; take a backup and
confirm this operation against the exact Canvas source/version first. A
current self-hosted installation may use a Rails runner operation like:

```bash
bundle exec rails runner '
  store = Lti::KeyStorage
  values = {
    CanvasSecurity::KeyStorage::PAST => CanvasSecurity::KeyStorage.new_key,
    CanvasSecurity::KeyStorage::PRESENT => CanvasSecurity::KeyStorage.new_key,
    CanvasSecurity::KeyStorage::FUTURE => CanvasSecurity::KeyStorage.new_key
  }
  store.send(:consul_proxy).set_keys(values, global: true)
  DynamicSettings.reset_cache!
'
```

After the web-service restart, verify that every key at `${CANVAS_DOMAIN}/api/lti/security/jwks` has a 2048-bit (or larger) modulus, then reopen the external tool to make Canvas issue a fresh launch token. Rotating all three keys invalidates a launch that was already in an open iframe; this is expected.

### LTI launch recovery

Use the visible error state to choose the next check:

| What appears in Canvas                 | Meaning                                                                                                               | Recovery                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sso.canvaslms.com refused to connect` | The tool is using Canvas cloud's authorization endpoint for a self-hosted Canvas.                                     | Set `LTI_AUTH_URL` and `LTI_KEY_SET_URL` to the self-hosted Canvas endpoints, deploy the tool, and relaunch it.                                   |
| `Canvas Signing-Key Error`             | Canvas's platform JWKS contains an RSA key smaller than 2048 bits.                                                    | Rotate the three `Lti::KeyStorage` keys above, restart Canvas web, verify the public JWKS, and reopen the tool.                                   |
| `Invalid LTI Launch`                   | The tool could not verify the signed launch for another reason.                                                       | Reopen the tool. If it repeats, compare the deployment ID, issuer, client ID, target-link URI, and public JWKS URL with the Canvas Developer Key. |
| `Connect Canvas`                       | The LTI launch succeeded but the current user has not yet granted Canvas API access to this separate Canvas instance. | Select **Connect Canvas** and complete the Canvas authorization flow.                                                                             |

## Prerequisites

Have a Canvas administrator who can manage Developer Keys, external apps, account themes, and OAuth scopes. You also need the deployed service URL and access to the secret store that supplies its runtime values.

Before changing Canvas, confirm these service endpoints respond:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/lti/config"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
```

`/setup` and `/setup/guide` provide a public role-oriented checklist. They confirm that the service responds, not that Canvas has stored the intended registration or loaded the detector.

## Values To Record

| Value                      | Canvas source                                                | Runtime destination                          |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| `CANVAS_DOMAIN`            | The Canvas base origin, such as `https://canvas.example.edu` | `CANVAS_DOMAIN`                              |
| `LTI_CLIENT_ID`            | LTI 1.3 Developer Key client ID                              | `LTI_CLIENT_ID`                              |
| `LTI_DEPLOYMENT_ID`        | External App deployment ID after installation                | `LTI_DEPLOYMENT_ID` when checking is enabled |
| `CANVAS_API_CLIENT_ID`     | API OAuth Developer Key client ID                            | `CANVAS_API_CLIENT_ID`                       |
| `CANVAS_API_CLIENT_SECRET` | API OAuth Developer Key secret                               | `CANVAS_API_CLIENT_SECRET`                   |
| `CANVAS_REDIRECT_URI`      | OAuth callback registration                                  | `${TOOL_URL}/api/oauth2callback`             |

The LTI client ID and Canvas API OAuth client ID come from different registrations. Mixing them breaks either signed LTI launches or Canvas API authorization.

## 1. Create the Canvas API OAuth Developer Key

The application uses user-scoped Canvas OAuth tokens for assessment discovery and access-code changes. Do not replace this with a personal access token.

In Canvas, open **Admin**, select the root account, open **Developer Keys**, and
create an **API Key**. Use a recognizable name, owner email, and purpose, then
set this exact redirect URI:

```text
${TOOL_URL}/api/oauth2callback
```

If the Canvas instance supports enforced scopes, allow this complete application scope set:

```text
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:course_id/quizzes
url:GET|/api/v1/courses/:course_id/assignments
url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id
url:PUT|/api/v1/courses/:course_id/quizzes/:id
url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id
url:GET|/api/v1/login/session_token
```

Every Canvas connection requests this same scope set, regardless of the user’s role in the course that initiated authorization. This prevents a person who is an instructor in one course and a student in another from retaining an incompatible role-specific grant. Canvas continues to enforce the authorizing user’s actual account and course permissions. The course-list scope powers the instructor exam-tool copy picker; the service requests only active courses with the Canvas `teacher` enrollment filter and rechecks that list immediately before writing any target course.

For the root-account administrator dashboard, also allow this administrator scope set on the same OAuth key:

```text
url:GET|/api/v1/accounts/:id
url:GET|/api/v1/accounts/:account_id/permissions
url:GET|/api/v1/accounts/:account_id/courses
url:GET|/api/v1/accounts/:account_id/terms
url:GET|/api/v1/courses/:id
```

The administrator authorization requests the complete application scope set—including `url:GET|/api/v1/login/session_token`—plus these administrator scopes. Course and term collection access powers the paginated active-course picker; it does not import or preload the root account's complete historical catalog. Individual course access supports connection, refresh, recovery, and assessment changes. PostgreSQL stores one OAuth grant per Canvas user. Administrator consent upgrades that grant in place, and later instructor or student reauthorization preserves the complete administrator scope profile. A multi-role administrator therefore authorizes once and uses the same refreshable grant in every Canvas context.

Some Canvas environments do not show every endpoint scope in the UI. Do not replace the session-token scope with a similarly named login permission. Use the instance’s supported Developer Keys administration/API path to add the exact endpoint scope, deploy the service, then have each affected administrator select **Reconnect Canvas** once. Administrator-only scope additions do not invalidate ordinary instructor or student connections. Scope changes apply only to newly issued tokens.

Store the API key’s client ID and secret in the deployment’s secret manager as
`CANVAS_API_CLIENT_ID` and `CANVAS_API_CLIENT_SECRET`. If you change the
redirect URI or scope set, affected users must reauthorize. Grants issued
before OAuth scope contract version 3 may not include
`url:GET|/api/v1/courses`; those instructors must select **Reconnect Canvas**
before using course-to-course exam-tool copy.

## 2. Create the LTI 1.3 Developer Key

Return to the root account’s **Developer Keys**, create an **LTI Key**, and
choose Canvas’s JSON configuration URL option:

```text
${TOOL_URL}/lti/config
```

The configuration document supplies the title, course-navigation and
root-account-navigation placements, OIDC initiation URL, target link URI,
public JWKS URL, and signed course/account/user/role custom fields. Prefer it
over manually copying fields because the deployed service remains the
registration source of truth. The account placement is marked
root-account-only and administrator-visible; the server still independently
requires the signed LTI Administrator role, Canvas's signed root-admin
substitution, numeric account identifiers, and a matching account-admin OAuth
grant.

The relevant values are:

| Canvas field           | Value                               |
| ---------------------- | ----------------------------------- |
| JSON configuration URL | `${TOOL_URL}/lti/config`            |
| OIDC initiation URL    | `${TOOL_URL}/lti/login`             |
| Target link URI        | `${TOOL_URL}/lti/launch`            |
| Redirect URI           | `${TOOL_URL}/lti/launch`            |
| Public JWK URL         | `${TOOL_URL}/.well-known/jwks.json` |

Enable the key and record its client ID as `LTI_CLIENT_ID`.

## 3. Install the External App

At the root account or desired account scope, open **Settings**, **Apps**, then
**View App Configurations**. Add an app **By Client ID**, paste the LTI client
ID from the previous step, approve the registration, and record the deployment
ID Canvas assigns. If Canvas has moved these controls, use its current External
Apps installation flow while preserving the same client and deployment IDs.

By default, set the deployment ID in `LTI_DEPLOYMENT_ID`, update the LTI client ID secret/value, and deploy a new service revision before testing. On Google Cloud, add numbered Secret Manager versions and submit Cloud Build with those exact version pins. On Docker/VPS, update the protected environment or mounted secret and recreate the application container. The default policy rejects launches from a deployment ID that is not explicitly configured.

For a controlled self-service rollout where instructors may add this exact registered app to their own courses, set `LTI_DEPLOYMENT_ID_CHECKING_ENABLED=false` on the service and deploy it. This accepts any non-empty deployment ID in a Canvas-signed launch from the configured issuer and client ID; it does not bypass token signatures, issuer/audience, nonce, target-link, or browser/state validation. Only use it if everyone able to install this client ID in Canvas is trusted to grant access to the tool.

Use a root-account-level installation for a broad rollout and for the school administrator dashboard. Use a course-level installation only for an isolated instructor/student pilot; a course-level installation does not provide the root-account navigation surface. Do not install the same registration both account-wide and course-local in the same course unless duplicate navigation entries are intentional.

## 4. Load the Detector Script Through the Canvas Theme

The detector runs on Canvas quiz-taking pages. It treats a Canvas access-code field only as a challenge signal and verifies the exact course/assessment against the service before showing the protected SEB flow. It fills an access code only after Config Key proof, shows approved web tools, and detects Canvas-confirmed completion. The stable script URL is:

```text
${TOOL_URL}/js/canvas-seb-detector.js
```

For a Cloud Run release bundle, run `./canvas-theme-loader.sh cloudrun.env`
after `prepare.sh`. It writes an upload-ready `canvas-theme-loader.js` containing
the exact configured public origin; upload that file rather than manually
transcribing the loader URL. The generated file contains no secret material.

Create a small JavaScript loader, replacing `${TOOL_URL}` before upload:

```javascript
(function () {
  "use strict";

  const detectorUrl = "${TOOL_URL}/js/canvas-seb-detector.js";
  const assessmentPath = /^\/courses\/\d+\/(?:quizzes\/\d+\/take|assignments\/\d+)(?:\/|$)/;

  if (!assessmentPath.test(window.location.pathname)) {
    return;
  }
  if (document.querySelector('script[data-canvas-seb-detector="true"]')) {
    return;
  }

  const script = document.createElement("script");
  script.src = detectorUrl;
  script.async = true;
  script.dataset.canvasSebDetector = "true";
  document.head.appendChild(script);
})();
```

The pattern includes Classic Quiz `/take` pages and New Quiz assignment routes, including their Canvas-generated descendants. `script.src` must be a plain JavaScript URL string, not a Markdown link.

From **Admin**, select the intended account, open **Themes**, edit or create the
active theme, and upload the loader as its desktop JavaScript. Preview, save,
and apply the theme. Theme upload capability and inherited themes vary by
Canvas configuration; if the upload control is unavailable, resolve that
account setting before treating the detector as installed. Retest the loader
after significant Canvas theme, CSP, or quiz-rendering changes.

### Self-hosted Canvas local-file workaround

Some self-hosted Canvas deployments store an uploaded theme JavaScript file as a local `/accounts/:accountId/files/:fileId/download` attachment. Rails can reject that JavaScript response with `ActionController::InvalidCrossOriginRequest` (HTTP `422`), so the loader never reaches this service. This is a Canvas attachment-serving limitation, not an LTI, detector, or deployment-ID failure.

When the browser console shows that `422`, do **not** disable Canvas CSRF protection globally. Instead, configure the account theme's `js_overrides` value to this externally hosted loader URL:

```text
${TOOL_URL}/js/canvas-seb-theme-loader.js
```

The hosted loader keeps the same quiz-route scope as the uploaded file and loads the full detector only on Canvas Classic Quiz `/take` pages and New Quiz assignment routes. Canvas's Theme Editor does not provide a direct URL field, so set this value through your Canvas provisioning or administration path and preserve it on future theme saves. For a one-off root-account recovery, run this inside the Canvas web container after replacing the account ID and URL:

```bash
bundle exec rails runner '
account = Account.find(1)
current = account.brand_config || BrandConfig.default
attrs = current.attributes.slice(*BrandConfig::ATTRS_TO_INCLUDE_IN_MD5.map(&:to_s))
attrs["js_overrides"] = "https://seb.example.edu/js/canvas-seb-theme-loader.js"
replacement = BrandConfig.for(attrs.symbolize_keys)
replacement.save_unless_dup!
replacement.sync_to_s3_and_save_to_account!(nil, account)
'
```

For a broader Canvas deployment, configure S3-compatible attachment storage and re-upload the theme file. Canvas then serves uploaded theme assets from object storage instead of the local files controller. That is the durable solution for arbitrary uploaded theme JavaScript, CSS, and similar assets; the hosted loader is the smallest safe fix for this integration.

The service also exposes `/api/seb/canvas-detector.js` for an existing
installation that uses that path, but new loaders should use
`/js/canvas-seb-detector.js`. Canvas’s
[account theme documentation](https://community.canvaslms.com/html/assets/Canvas_Admin_Guide.pdf)
describes the current custom JavaScript upload and account/sub-account
inheritance behavior.

## 5. Verify The Integration

Use separate administrator, instructor, and student accounts.

1. As a root-account administrator, retrieve `/lti/config`, confirm Canvas has the intended client and deployment IDs, and confirm both **Safe Online Exam Admin** in root-account navigation and the course app in a target course.
2. Open **Safe Online Exam Admin**, complete its separate Canvas authorization, verify school courses load, create and assign a school tool preset, refresh a test course, reveal and rotate a test exit password, reset an assessment exit password, rotate its access code, and confirm each operation appears in recent administrator activity.
3. As an instructor, launch the tool from Canvas, complete OAuth, refresh assessments, enable the assigned school tool, create one quiz-only tool, set an effective exit-password policy, and enable one Classic Quiz and one New Quiz.
4. In a normal browser, open each assessment page and verify that the theme loaded the detector script without console errors.
5. As a student, launch the course-navigation tool, complete the one-time Canvas connection, and run the optional setup check.
6. Download a fresh configuration. On an approved SEB client, verify the configuration opens, reaches Canvas, proves its Config Key, fills the Canvas access-code prompt, and makes only selected exam tools available.
7. For each assessment type, cancel one Canvas submission confirmation and ensure no exit occurs. Then submit successfully and ensure the exit flow begins only after Canvas shows the authoritative completed state.

See [Testing](testing.md) for the full acceptance sequence and [Certificate management](certificate-management.md) for the client identity prerequisite.

## Common Integration Failures

| Symptom                                                       | Check                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LTI Deployment Configuration Required                         | Deployment-ID checking is enabled and Canvas installed this app with an ID not yet allowed by the service. Retrieve the `deployment_id` from Canvas's External Tools API for that course/account app, append it to `LTI_DEPLOYMENT_ID` without replacing existing IDs, deploy a new revision, then reopen the tool. For an intentional self-service rollout, an administrator can instead set `LTI_DEPLOYMENT_ID_CHECKING_ENABLED=false`. |
| Canvas reports an LTI configuration/identity error            | Refresh the registration from `/lti/config`; confirm the launch includes the signed numeric Canvas user custom field and that `LTI_DEPLOYMENT_ID` matches the installed app.                                                                                                                                                                                                                                                              |
| Instructor is asked to authorize repeatedly                   | Confirm the API OAuth redirect URI exactly matches `${TOOL_URL}/api/oauth2callback`, the OAuth key is enabled, and the configured client ID/secret are the API-key values.                                                                                                                                                                                                                                                                |
| Administrator dashboard is missing or denied                  | Install the LTI app at the root account from the current `/lti/config`, use an actual root-account administrator, confirm Canvas expands the account/root-account/root-admin custom fields, and allow the administrator OAuth scopes above. A course installation or instructor enrollment is intentionally insufficient.                                                                                                                 |
| Student cannot connect Canvas or configuration download fails | Confirm the exact session-token scope shown earlier is allowed and that the student is authorizing the same Canvas environment as the LTI launch.                                                                                                                                                                                                                                                                                         |
| Access code is not filled in SEB                              | Confirm a fresh configuration was downloaded, the detector loaded on the actual assessment route, Config Key proof succeeded, and the Canvas prompt is not ambiguous.                                                                                                                                                                                                                                                                     |
| Detector never loads                                          | Check the active account theme, inherited theme behavior, browser console/CSP, and that the public detector URL returns JavaScript.                                                                                                                                                                                                                                                                                                       |
| A launch works in one environment but not another             | Treat client IDs, deployment IDs, URLs, OAuth keys, secrets, and PostgreSQL databases as environment-specific; do not mix them.                                                                                                                                                                                                                                                                                                           |
