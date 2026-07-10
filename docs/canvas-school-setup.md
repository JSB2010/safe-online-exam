# Canvas School Setup Guide

This guide covers the Canvas UI work required to make the Safe Exam Browser LTI available to a school and to load the Canvas detector script from a Canvas theme.

Use this after the Cloud Run service has been deployed and the final public `TOOL_URL` is known. If you are using the generated `run.app` URL, deploy once from [school-deployment.md](school-deployment.md), retrieve the URL, then return here.

## Canvas Admin Prerequisites

You need a Canvas root-account admin, or an admin role with these permissions enabled:

- Developer Keys
- Manage LTI / manually configure external apps
- Account Settings
- Themes and custom CSS/JS uploads

Canvas custom JavaScript uploads may not be enabled by default. Instructure's Theme Editor documentation says custom branding and file uploads may need to be enabled by the school's Customer Success Manager before the upload tab is available.

This app also needs a Canvas API OAuth developer key for instructor API actions such as reading quizzes and updating access codes. Confirm `CANVAS_API_CLIENT_ID`, `CANVAS_API_CLIENT_SECRET`, and `CANVAS_REDIRECT_URI` are configured for the deployed Cloud Run service before school rollout. The OAuth redirect URI is:

```text
${TOOL_URL}/api/oauth2callback
```

Do not use a manually generated personal access token for rollout. Canvas' OAuth documentation treats manual tokens as a testing shortcut; this app is built to request and refresh user-scoped OAuth tokens from a Canvas API Developer Key.

## Setup Model

There are two supported install models.

Use the account-wide install for normal school rollout. The admin creates one LTI 1.3 Developer Key, installs it once at the root account or school sub-account, and Canvas makes the app available to courses under that account.

Use the course install for pilots. The admin creates the same LTI 1.3 Developer Key, then a course admin or teacher with sufficient permissions installs that client ID in one course.

Do not install the same LTI app both account-wide and course-local in the same course unless you intentionally want duplicate tool entries.

## Values To Record

Record these values while completing the Canvas steps:

| Value                      | Source in Canvas                                                | Runtime destination                                                 |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `CANVAS_DOMAIN`            | The base Canvas URL used by the school, with no trailing slash. | `CANVAS_DOMAIN` / `${SECRET_PREFIX}_canvas_domain`                  |
| `CANVAS_API_CLIENT_ID`     | API OAuth Developer Key ID/client ID.                           | `CANVAS_API_CLIENT_ID` / `${SECRET_PREFIX}_api_client_id`           |
| `CANVAS_API_CLIENT_SECRET` | API OAuth Developer Key secret/key.                             | `CANVAS_API_CLIENT_SECRET` / `${SECRET_PREFIX}_api_client_secret`   |
| `LTI_CLIENT_ID`            | LTI 1.3 Developer Key Client ID.                                | `LTI_CLIENT_ID` / `${SECRET_PREFIX}_lti_client_id`                  |
| `LTI_DEPLOYMENT_ID`        | External App Deployment ID after installing by Client ID.       | Optional `LTI_DEPLOYMENT_ID` / `${SECRET_PREFIX}_lti_deployment_id` |

`CANVAS_API_CLIENT_ID` and `LTI_CLIENT_ID` are different values from different Canvas Developer Keys. Mixing them causes OAuth or LTI launch failures.

## LTI URLs

For the selected environment, Canvas should point at these URLs:

| Canvas field           | Value                                   |
| ---------------------- | --------------------------------------- |
| JSON configuration URL | `${TOOL_URL}/lti/config`                |
| OIDC initiation URL    | `${TOOL_URL}/lti/login`                 |
| Target link URI        | `${TOOL_URL}/lti/launch`                |
| Redirect URI           | `${TOOL_URL}/lti/launch`                |
| Public JWK URL         | `${TOOL_URL}/.well-known/jwks.json`     |
| Detector script URL    | `${TOOL_URL}/js/canvas-seb-detector.js` |

The app's `/lti/config` endpoint returns a Canvas-compatible LTI 1.3 JSON configuration with course navigation placement metadata. Prefer that URL over manual entry so Canvas receives the same settings the service exposes.

## Create the Canvas API OAuth Developer Key

Create this key first if the Cloud Run `TOOL_URL` is already final. If you are still bootstrapping to discover the generated `run.app` URL, create this key after the first deploy.

1. In Canvas Global Navigation, select `Admin`, then open the root account.
2. Open `Developer Keys`.
3. Select `Add Developer Key`, then `API Key`.
4. Enter the key metadata:
   - Key Name: `Safe Exam Browser Canvas API`
   - Owner Email: the school or vendor technical owner
   - Redirect URIs: `${TOOL_URL}/api/oauth2callback`
5. If Canvas shows an `Enforce Scopes` or scoped-key option, enable it and add these scopes:

```text
url:GET|/api/v1/courses/:course_id/quizzes
url:GET|/api/v1/courses/:course_id/assignments
url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id
url:PUT|/api/v1/courses/:course_id/quizzes/:id
url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id
```

6. Save the API key.
7. Turn the developer key on if Canvas created it in an off or disabled state.
8. Copy the API key's ID/client ID to `CANVAS_API_CLIENT_ID`.
9. Copy the API key's secret/key to `CANVAS_API_CLIENT_SECRET`.
10. Store both values in the school's password manager and then in Secret Manager.

If Canvas does not enforce scopes on this key, the OAuth token can use any endpoint available to the authorizing Canvas user. The app still requests only the five scopes listed above.

If an API key already exists, open it and confirm the redirect URI exactly matches `${TOOL_URL}/api/oauth2callback`, then confirm the scopes above are enabled. After changing redirect URIs or scopes, instructors who already authorized the app may need to reauthorize from the app.

## Create the LTI Developer Key

1. In Canvas Global Navigation, select `Admin`, then open the root account or target school sub-account.
2. Open `Developer Keys`.
3. Select `Add Developer Key`, then `Add LTI Key`.
4. Enter the key metadata:
   - Key Name: `Safe Exam Browser Canvas Integration`
   - Owner Email: the school or vendor technical owner
   - Redirect URIs: `${TOOL_URL}/lti/launch`
5. In the configuration method menu, select `Enter URL`.
6. Enter `${TOOL_URL}/lti/config`.
7. Save the LTI key.
8. Turn the developer key on if Canvas created it in an off or disabled state.
9. Copy the key's `Client ID` to `LTI_CLIENT_ID`.
10. Store the value in the school's password manager and then in Secret Manager.

Canvas also supports `Paste JSON` and `Manual Entry` for LTI keys. If the JSON URL cannot be used, open `${TOOL_URL}/lti/config`, paste the returned JSON into the LTI 1.3 configuration field, and confirm these values are present:

- `oidc_initiation_url`: `${TOOL_URL}/lti/login`
- `target_link_uri`: `${TOOL_URL}/lti/launch`
- `public_jwk_url`: `${TOOL_URL}/.well-known/jwks.json`
- Course Navigation placement
- Assignment Selection deep-linking placement
- `custom_fields.canvas_membership_roles`: `$Canvas.membership.roles`
- `custom_fields.canvas_lis_membership_roles`: `$com.Instructure.membership.roles`
- `custom_fields.canvas_membership_permissions`: `$Canvas.membership.permissions<...>`

## Install the App for the Entire School

Use this path for the normal school setup.

1. In Canvas Global Navigation, select `Admin`, then open the root account or target school sub-account.
2. Open `Settings`.
3. Select the `Apps` tab.
4. Select `View App Configurations`.
5. Select `Add App`.
6. Set `Configuration Type` to `By Client ID`.
7. Paste the LTI Developer Key `Client ID`.
8. Select `Submit`.
9. Review the app confirmation screen and select `Install`.
10. Confirm `Safe Exam Browser Canvas Integration` appears on the External Apps page.
11. Open the app settings menu and record the `Deployment ID` for support records and optional `LTI_DEPLOYMENT_ID` enforcement.

If Canvas says the client ID is not found, verify that the LTI Developer Key exists in the same Canvas root account and is enabled.

## Install the App for One Course

Use this path only for a pilot or a course-specific install.

1. Open the Canvas course.
2. Open `Settings`.
3. Select the `Apps` tab.
4. Select `View App Configurations`.
5. Select `Add App`.
6. Set `Configuration Type` to `By Client ID`.
7. Paste the LTI Developer Key `Client ID`.
8. Select `Submit`.
9. Review the app confirmation screen and select `Install`.
10. Confirm the app appears in that course's External Apps list.
11. Open the app settings menu and record the `Deployment ID` if you want deployment ID enforcement for the pilot.

If the course UI does not show the app configuration controls, the user's course or account role does not have permission to manually configure external apps. Use the account-wide install or ask a Canvas root-account admin to enable the role permission.

## Write Canvas Values To Secret Manager

After recording the Canvas values, update the existing secrets created during deployment:

```bash
export CANVAS_DOMAIN="https://school.instructure.com"
export LTI_CLIENT_ID="REPLACE_WITH_CANVAS_LTI_CLIENT_ID"
export CANVAS_API_CLIENT_ID="REPLACE_WITH_CANVAS_API_CLIENT_ID"
export CANVAS_API_CLIENT_SECRET="REPLACE_WITH_CANVAS_API_CLIENT_SECRET"

printf '%s' "${CANVAS_DOMAIN}" | gcloud secrets versions add "${SECRET_PREFIX}_canvas_domain" --data-file=-
printf '%s' "${LTI_CLIENT_ID}" | gcloud secrets versions add "${SECRET_PREFIX}_lti_client_id" --data-file=-
printf '%s' "${CANVAS_API_CLIENT_ID}" | gcloud secrets versions add "${SECRET_PREFIX}_api_client_id" --data-file=-
printf '%s' "${CANVAS_API_CLIENT_SECRET}" | gcloud secrets versions add "${SECRET_PREFIX}_api_client_secret" --data-file=-
```

If using deployment ID enforcement:

```bash
export LTI_DEPLOYMENT_ID="REPLACE_WITH_CANVAS_DEPLOYMENT_ID"
printf '%s' "${LTI_DEPLOYMENT_ID}" | gcloud secrets create "${SECRET_PREFIX}_lti_deployment_id" --replication-policy=automatic --data-file=-
```

If the deployment ID secret already exists, add a new version instead:

```bash
printf '%s' "${LTI_DEPLOYMENT_ID}" | gcloud secrets versions add "${SECRET_PREFIX}_lti_deployment_id" --data-file=-
```

Then redeploy Cloud Run so the service receives the latest Secret Manager versions. If you are enforcing `LTI_DEPLOYMENT_ID`, also follow the optional deployment ID note in [school-deployment.md](school-deployment.md) so future Cloud Build deploys keep that secret mounted.

## Add the Detector Script to a Canvas Theme

The detector script has to run inside Canvas quiz-taking pages so it can exchange SEB Config Key proof for the one-time quiz access code. Canvas theme JavaScript is the account-level place to load that script across courses.

Create a small JavaScript file, for example `canvas-seb-theme-loader.js`:

```javascript
(function () {
  "use strict";

  const detectorUrl = "${TOOL_URL}/js/canvas-seb-detector.js";
  const quizTakePath = /^\/courses\/\d+\/(?:quizzes\/\d+\/take|assignments\/\d+)(?:\/|$)/;

  function onPage(pattern, callback) {
    if (pattern.test(window.location.pathname)) {
      callback();
    }
  }

  onPage(quizTakePath, function () {
    if (document.querySelector('script[data-canvas-seb-detector="true"]')) {
      return;
    }

    const script = document.createElement("script");
    script.src = detectorUrl;
    script.async = true;
    script.dataset.canvasSebDetector = "true";
    document.head.appendChild(script);
  });
})();
```

Replace `${TOOL_URL}` with the deployed Cloud Run service URL before uploading the file to Canvas.

For a course-limited pilot, replace the path pattern with the specific course ID:

```javascript
const quizTakePath = /^\/courses\/12345\/(?:quizzes\/\d+\/take|assignments\/\d+)(?:\/|$)/;
```

Do not paste a Markdown link into `script.src`. It must be a plain URL string:

```javascript
script.src = "${TOOL_URL}/js/canvas-seb-detector.js";
```

Then upload the file in Canvas:

1. In Canvas Global Navigation, select `Admin`, then open the root account or target school sub-account.
2. Open `Themes`.
3. Open the active theme, or create a new theme from the default template.
4. Open the Theme Editor `Upload` tab.
5. Under the desktop `JavaScript file` heading, select the loader file.
6. Select `Preview Your Changes`.
7. Test the preview in Canvas beta or test first.
8. Save the theme with a clear name, for example `School Theme with SEB Detector`.
9. Apply the theme to the account.

Canvas theme inheritance matters. A theme applied to the root account normally applies to sub-accounts and their courses. If a sub-account has its own theme, update that sub-account's theme too or confirm it inherits the root account theme.

## Verification Checklist

After installing the LTI app and applying the theme:

1. Open a test course as an instructor.
2. Confirm `Safe Exam Browser` appears in course navigation or in the configured placement.
3. Launch the tool from the course.
4. Complete Canvas OAuth authorization if prompted.
5. Refresh the course quiz list in the tool.
6. Enable SEB for a Classic Quiz or New Quiz.
7. Open the quiz-taking page in a normal browser and confirm the browser console loads `${TOOL_URL}/js/canvas-seb-detector.js`.
8. Download the generated `.seb` file from the app.
9. Open the quiz through SEB and confirm the access-code field is filled only after SEB launches with the generated configuration.
10. For a New Quiz, confirm Canvas moves from `/assignments/:assignmentId/taking/:attemptId` to `/taking/:attemptId/take` after access-code validation.
11. Select the first New Quiz Submit control and confirm SEB stays on Canvas while the confirmation dialog is open.
12. Cancel once and confirm the quiz remains open, then submit again and confirm the SEB exit page opens only after Canvas renders the assessment results.
13. Confirm the exit route closes SEB.

Useful service checks:

```bash
curl -fsS "${TOOL_URL}/health"
curl -fsS "${TOOL_URL}/.well-known/jwks.json"
curl -fsS "${TOOL_URL}/js/canvas-seb-detector.js" | head
```

## Operations Notes

- Test the theme JavaScript in Canvas beta or test before applying it to production.
- Keep the loader file small. The maintained detector implementation is served by this app at `/js/canvas-seb-detector.js`.
- Custom Canvas JavaScript depends on Canvas page paths and DOM behavior. Re-test after major Canvas updates.
- If Canvas Content Security Policy blocks the script, add the Cloud Run host to the account's allowed domains or install the app account-wide so Canvas can include the tool domain in the effective allowlist.
- Record the Canvas Client ID, Deployment ID, installed account or course, theme name, and detector script URL in the school's internal change log.

## Sources

Researched on July 8, 2026.

- [Instructure Developer Portal: Canvas OAuth2 Overview](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)
- [Instructure Developer Portal: Developer Keys](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys)
- [Instructure Developer Portal: LTI 1.3 Configuring](https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.lti_dev_key_config)
- [Instructure: Configure an LTI key for an account](https://community.instructure.com/en/kb/articles/661475-how-do-i-configure-an-lti-key-for-an-account)
- [Instructure: Configure an external app for an account using a client ID](https://community.instructure.com/en/kb/articles/661478-how-do-i-configure-an-external-app-for-an-account-using-a-client-id)
- [Instructure: Create a theme for an account using the Theme Editor](https://community.instructure.com/en/kb/articles/661410-how-do-i-create-a-theme-for-an-account-using-the-theme-editor)
- [Instructure: Upload custom JavaScript and CSS files to an account](https://community.instructure.com/en/kb/articles/661411-how-do-i-upload-custom-javascript-and-css-files-to-an-account)
- [Canvas LMS API: External Tools](https://canvas.instructure.com/doc/api/external_tools.html)
- [Canvas LMS API: Content Security Policy Settings](https://canvas.instructure.com/doc/api/content_security_policy_settings.html)
