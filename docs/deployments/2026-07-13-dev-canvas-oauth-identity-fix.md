# Dev Canvas OAuth Identity Fix — 2026-07-13

## Outcome

- Patched the OAuth authorization flow so it only binds a Canvas OAuth token to a signed, numeric Canvas REST user ID from the validated LTI launch.
- Updated the generated Canvas LTI registration to request public launch identity and to send the Canvas course and user IDs at both the tool and course-navigation placement levels.
- Deployed the patch successfully to the Kent Denver development service.
- Production was not changed.
- The existing Canvas Developer Key must still be updated from the deployed `/lti/config` document before an end-to-end OAuth retry can succeed. Deploying Cloud Run does not rewrite the registration Canvas already stored.

## Target

- Operator: `appdev@kentdenver.org`
- Google Cloud project: `securityapis` (`184075650720`)
- Cloud Run service: `canvas-seb-dev`
- Region: `us-central1`
- Firestore database: `seb-canvaslti-dev`
- Canonical Canvas-facing URL: `https://canvas-seb-dev-184075650720.us-central1.run.app`
- Runtime service account: `seb-canvas-dev@securityapis.iam.gserviceaccount.com`

## Cause and Fix

The failing launch was valid but anonymous: Canvas did not send the custom `canvas_user_id` value, so the launch only contained an opaque LTI subject. The hardened OAuth authorization guard correctly refused to treat that opaque subject as a Canvas REST user ID and returned `OAuth identity does not match the validated Canvas launch` before starting OAuth.

The patch preserves that fail-closed identity check and makes the registration requirement explicit:

- `privacy_level` is `public` in the Canvas extension.
- `$Canvas.user.id` and `$Canvas.course.id` are requested at both tool and placement scope.
- A validated launch without a signed numeric Canvas user ID now returns a safe Canvas configuration error instead of installing an unusable principal.
- The OAuth callback still requires the token owner returned by Canvas to match the signed numeric launch identity.

## Build and Artifact

- Cloud Build ID: `fa1554b8-8462-4ee7-a5ef-b8a5729b371d`
- Cloud Build result: `SUCCESS`
- Build duration: 6 minutes 2 seconds
- Build source: `gs://securityapis_cloudbuild/source/1783975706.924586-2113b75294ad42cf9a3b88874d5a8191.tgz`
- Upload manifest: 130 files; local secrets, generated output, dependencies, and environment files were excluded.
- Artifact: `us-central1-docker.pkg.dev/securityapis/canvas-seb-repo/canvas-seb-dev`
- Immutable digest: `sha256:a1fd4fc877552629d1647de3f3bd433a6c4fd7fdfa4a8aaf515ade07d3b8af65`
- Artifact Registry provenance: SLSA build level 3
- Cloud Run revision: `canvas-seb-dev-00376-pjd`
- Previous revision: `canvas-seb-dev-00375-rrt`
- Previous digest: `sha256:406f643dd011baa99222241bf685432a994338c6fe42999bc6ad9e0a1034948b`

This record was written after the build so it could include final deployment evidence; it is not part of the deployed image digest.

## Verification

| Check                 | Result                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Focused regression    | Passed: 5 files / 95 tests                                                                                        |
| Full non-browser gate | Passed: typecheck, lint, Prettier, 39 files / 421 tests, coverage thresholds, client build, and server build      |
| Browser smoke         | Passed: 14/14 Chromium desktop and mobile tests                                                                   |
| Cloud Build gate      | Passed all Docker-owned install, static-analysis, test, build, prune, and runtime-assembly steps; npm audit was 0 |
| Cloud Run             | Revision Ready and serving 100% of traffic; exact immutable digest and dedicated runtime identity confirmed       |
| Public IAM            | `allUsers` retains `roles/run.invoker`                                                                            |
| Health                | Canonical `/health` returned `{"status":"UP"}`                                                                    |
| Published LTI config  | Canonical URLs, `privacy_level: public`, and root/placement Canvas user and course substitutions confirmed        |
| New-revision logs     | No warning or error entries after deployment                                                                      |
| Firestore migration   | None required; this patch changes launch validation and generated registration metadata only                      |

### Container Scan

Artifact Analysis completed successfully with continuous analysis active. The exact deployed digest has 0 effective critical, high, or medium findings; 5 effective low and 7 effective minimal findings remain in the distroless Debian 13 `glibc`/`zlib` packages. Artifact Analysis reports no fixed package version for these occurrences.

## Required Canvas Registration Refresh

Before retesting OAuth, a Canvas root administrator must edit the existing LTI Developer Key and update/save its JSON configuration from:

`https://canvas-seb-dev-184075650720.us-central1.run.app/lti/config`

Then launch the tool again from the intended Canvas course and select Connect Canvas. A fresh launch must include a numeric `canvas_user_id`; the application deliberately fails closed if Canvas continues to provide an anonymous launch.

Prefer updating the existing key. Recreating the key and installation can create a new deployment ID; if that happens, update the `dev_lti_deployment_id` secret and redeploy before testing.

## Rollback

No database rollback is needed. To return dev traffic to the immediately preceding hardened revision:

```bash
gcloud run services update-traffic canvas-seb-dev \
  --project=securityapis \
  --region=us-central1 \
  --to-revisions=canvas-seb-dev-00375-rrt=100
```

Rollback would restore the anonymous-launch behavior that caused this incident, so a forward fix is preferred.
