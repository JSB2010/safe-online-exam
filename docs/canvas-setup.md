# Canvas Setup

This guide installs a deployed Canvas Safe Exam Browser LTI service in Canvas. Complete [Configuration](configuration.md) and the initial deployment first: the public `TOOL_URL` must be final before creating Canvas registrations.

The service is portable across Canvas environments, but each deployment is configured for one Canvas origin. Keep separate client IDs, deployment IDs, OAuth credentials, Firestore databases, and service URLs for environments that must remain isolated.

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

| Value                      | Canvas source                                                | Runtime destination              |
| -------------------------- | ------------------------------------------------------------ | -------------------------------- |
| `CANVAS_DOMAIN`            | The Canvas base origin, such as `https://canvas.example.edu` | `CANVAS_DOMAIN`                  |
| `LTI_CLIENT_ID`            | LTI 1.3 Developer Key client ID                              | `LTI_CLIENT_ID`                  |
| `LTI_DEPLOYMENT_ID`        | External App deployment ID after installation                | `LTI_DEPLOYMENT_ID`              |
| `CANVAS_API_CLIENT_ID`     | API OAuth Developer Key client ID                            | `CANVAS_API_CLIENT_ID`           |
| `CANVAS_API_CLIENT_SECRET` | API OAuth Developer Key secret                               | `CANVAS_API_CLIENT_SECRET`       |
| `CANVAS_REDIRECT_URI`      | OAuth callback registration                                  | `${TOOL_URL}/api/oauth2callback` |

The LTI client ID and Canvas API OAuth client ID come from different registrations. Mixing them breaks either signed LTI launches or Canvas API authorization.

## 1. Create the Canvas API OAuth Developer Key

The application uses user-scoped Canvas OAuth tokens for assessment discovery and access-code changes. Do not replace this with a personal access token.

In the root account’s Developer Keys area, create an API key with this redirect URI:

```text
${TOOL_URL}/api/oauth2callback
```

If the Canvas instance supports enforced scopes, allow these instructor scopes:

```text
url:GET|/api/v1/courses/:course_id/quizzes
url:GET|/api/v1/courses/:course_id/assignments
url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id
url:PUT|/api/v1/courses/:course_id/quizzes/:id
url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id
```

Also allow the student session-handoff scope:

```text
url:GET|/api/v1/login/session_token
```

The service requests only the applicable subset: instructors authorize the assessment scopes and students authorize the session-token scope. Some Canvas environments do not show every endpoint scope in the UI. Do not replace the session-token scope with a similarly named login permission. Use the instance’s supported Developer Keys administration/API path to add the exact endpoint scope, then verify it with a student test account.

Store the API key’s client ID and secret in the deployment’s secret manager as `CANVAS_API_CLIENT_ID` and `CANVAS_API_CLIENT_SECRET`. If you change the redirect URI or scope set, affected users must reauthorize.

## 2. Create the LTI 1.3 Developer Key

Create a separate LTI 1.3 Developer Key and use dynamic registration configuration where Canvas offers it:

```text
${TOOL_URL}/lti/config
```

The dynamic document supplies the title, course-navigation placement, OIDC initiation URL, target link URI, public JWKS URL, and signed course/user/role custom fields. Prefer it over manually copying fields because the deployed service remains the registration source of truth.

The relevant values are:

| Canvas field               | Value                               |
| -------------------------- | ----------------------------------- |
| Dynamic JSON configuration | `${TOOL_URL}/lti/config`            |
| OIDC initiation URL        | `${TOOL_URL}/lti/login`             |
| Target link URI            | `${TOOL_URL}/lti/launch`            |
| Redirect URI               | `${TOOL_URL}/lti/launch`            |
| Public JWK URL             | `${TOOL_URL}/.well-known/jwks.json` |

Enable the key and record its client ID as `LTI_CLIENT_ID`.

## 3. Install the External App

At the root account or the desired account scope, open the external-app configuration area and add the app by client ID. Paste the LTI client ID from the previous step, approve the registration, and record the deployment ID Canvas assigns.

Set the deployment ID in `LTI_DEPLOYMENT_ID`, update the LTI client ID secret/value if necessary, and deploy a new service revision before testing. The application rejects launches from a deployment ID that is not explicitly configured.

Use an account-level installation for a broad rollout. Use a course-level installation for an isolated pilot. Do not install the same registration both account-wide and course-local in the same course unless duplicate navigation entries are intentional.

## 4. Load the Detector Script Through the Canvas Theme

The detector runs on Canvas quiz-taking pages. It launches the protected SEB flow, fills an access code only after Config Key proof, shows approved web tools, and detects Canvas-confirmed completion. The stable script URL is:

```text
${TOOL_URL}/js/canvas-seb-detector.js
```

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

Upload the loader as the account theme’s desktop JavaScript and apply the theme at the intended account scope. Theme upload capability and inherited themes vary by Canvas configuration; if the upload control is unavailable, resolve that account setting before treating the detector as installed. Retest the loader after significant Canvas theme, CSP, or quiz-rendering changes.

The service also exposes `/api/seb/canvas-detector.js` for an existing installation that uses that path, but new loaders should use `/js/canvas-seb-detector.js`.

## 5. Verify The Integration

Use separate administrator, instructor, and student accounts.

1. As an administrator, retrieve `/lti/config`, confirm Canvas has the intended client and deployment IDs, and confirm the app appears in the target course navigation.
2. As an instructor, launch the tool from Canvas, complete OAuth, refresh assessments, set an effective exit-password policy, and enable one Classic Quiz and one New Quiz.
3. In a normal browser, open each assessment page and verify that the theme loaded the detector script without console errors.
4. As a student, launch the course-navigation tool, complete the one-time Canvas connection, and run the optional setup check.
5. Download a fresh configuration. On an approved SEB client, verify the configuration opens, reaches Canvas, proves its Config Key, fills the Canvas access-code prompt, and makes only selected exam tools available.
6. For each assessment type, cancel one Canvas submission confirmation and ensure no exit occurs. Then submit successfully and ensure the exit flow begins only after Canvas shows the authoritative completed state.

See [Testing](testing.md) for the full acceptance sequence and [Certificate management](certificate-management.md) for the client identity prerequisite.

## Common Integration Failures

| Symptom                                                       | Check                                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas reports an LTI configuration/identity error            | Refresh the registration from `/lti/config`; confirm the launch includes the signed numeric Canvas user custom field and that `LTI_DEPLOYMENT_ID` matches the installed app. |
| Instructor is asked to authorize repeatedly                   | Confirm the API OAuth redirect URI exactly matches `${TOOL_URL}/api/oauth2callback`, the OAuth key is enabled, and the configured client ID/secret are the API-key values.   |
| Student cannot connect Canvas or configuration download fails | Confirm the exact session-token scope shown earlier is allowed and that the student is authorizing the same Canvas environment as the LTI launch.                            |
| Access code is not filled in SEB                              | Confirm a fresh configuration was downloaded, the detector loaded on the actual assessment route, Config Key proof succeeded, and the Canvas prompt is not ambiguous.        |
| Detector never loads                                          | Check the active account theme, inherited theme behavior, browser console/CSP, and that the public detector URL returns JavaScript.                                          |
| A launch works in one environment but not another             | Treat client IDs, deployment IDs, URLs, OAuth keys, secrets, and Firestore databases as environment-specific; do not mix them.                                               |
