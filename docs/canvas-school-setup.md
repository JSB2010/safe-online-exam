# Canvas School Setup Guide

This guide covers the Canvas UI work required to make the Safe Exam Browser LTI available to a school and to load the Canvas detector script from a Canvas theme.

Use this after the Cloud Run service has been deployed and the public `TOOL_URL` is known. The examples below use the current dev URL:

```text
https://canvas-seb-dev-184075650720.us-central1.run.app
```

For production, replace that value with the production `TOOL_URL`.

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

## Setup Model

There are two supported install models.

Use the account-wide install for normal school rollout. The admin creates one LTI 1.3 Developer Key, installs it once at the root account or school sub-account, and Canvas makes the app available to courses under that account.

Use the course install for pilots. The admin creates the same LTI 1.3 Developer Key, then a course admin or teacher with sufficient permissions installs that client ID in one course.

Do not install the same LTI app both account-wide and course-local in the same course unless you intentionally want duplicate tool entries.

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
9. Copy the key's `Client ID`.

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
11. Open the app settings menu and record the `Deployment ID` for support records.

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

If the course UI does not show the app configuration controls, the user's course or account role does not have permission to manually configure external apps. Use the account-wide install or ask a Canvas root-account admin to enable the role permission.

## Add the Detector Script to a Canvas Theme

The detector script has to run inside Canvas quiz-taking pages so it can exchange SEB Config Key proof for the one-time quiz access code. Canvas theme JavaScript is the account-level place to load that script across courses.

Create a small JavaScript file, for example `canvas-seb-theme-loader.js`:

```javascript
(function () {
  "use strict";

  const detectorUrl = "https://canvas-seb-dev-184075650720.us-central1.run.app/js/canvas-seb-detector.js";
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

For a course-limited pilot, replace the path pattern with the specific course ID:

```javascript
const quizTakePath = /^\/courses\/11825\/(?:quizzes\/\d+\/take|assignments\/\d+)(?:\/|$)/;
```

Do not paste a Markdown link into `script.src`. It must be a plain URL string:

```javascript
script.src = "https://canvas-seb-dev-184075650720.us-central1.run.app/js/canvas-seb-detector.js";
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
10. Confirm the exit route works after quiz completion.

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

Researched on July 6, 2026.

- [Instructure: Configure an LTI key for an account](https://community.instructure.com/en/kb/articles/661475-how-do-i-configure-an-lti-key-for-an-account)
- [Instructure: Configure an external app for an account using a client ID](https://community.instructure.com/en/kb/articles/661478-how-do-i-configure-an-external-app-for-an-account-using-a-client-id)
- [Instructure: Create a theme for an account using the Theme Editor](https://community.instructure.com/en/kb/articles/661410-how-do-i-create-a-theme-for-an-account-using-the-theme-editor)
- [Instructure: Upload custom JavaScript and CSS files to an account](https://community.instructure.com/en/kb/articles/661411-how-do-i-upload-custom-javascript-and-css-files-to-an-account)
- [Canvas LMS API: External Tools](https://canvas.instructure.com/doc/api/external_tools.html)
- [Canvas LMS API: Content Security Policy Settings](https://canvas.instructure.com/doc/api/content_security_policy_settings.html)
