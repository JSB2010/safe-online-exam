# Dev SEB Launch, Password, and SSO Fix — 2026-07-13

## Outcome

- Deployed the direct assessment launch flow from the Canvas detector popup without exposing a reusable `.seb` URL.
- Added instructor-only, same-origin, session-bound password reveal responses with `no-store` caching and a 30-second UI lifetime. Managed server defaults remain non-retrievable.
- Relaxed start/exit passwords to 8–128 characters and allowed letters-only or numbers-only values while retaining predictable, sequential, repetitive, low-diversity, and control-character rejection with specific error messages.
- Restored the configured Canvas host's `/login` path and the exact current Google identity host in generated SEB URL filters, fixing blank SEB launches from a fresh Canvas cookie jar without adding wildcard Canvas or Google access.
- Production was not changed.

## Target

- Google Cloud project: `securityapis` (`184075650720`)
- Cloud Run service: `canvas-seb-dev`
- Region: `us-central1`
- Firestore database: `seb-canvaslti-dev`
- Canonical Canvas-facing URL: `https://canvas-seb-dev-184075650720.us-central1.run.app`
- Runtime service account: `seb-canvas-dev@securityapis.iam.gserviceaccount.com`

## Build and Artifact

- Cloud Build ID: `c7655fc5-a9f6-4b4b-a9b1-5ea6d5d93530`
- Cloud Build result: `SUCCESS`
- Build duration: 5 minutes 40 seconds
- Build source: `gs://securityapis_cloudbuild/source/1783980627.129906-b8122267621d4681802b724ebd535f2c.tgz`
- Upload manifest: 131 files, 1.4 MiB before compression
- Artifact: `us-central1-docker.pkg.dev/securityapis/canvas-seb-repo/canvas-seb-dev`
- Immutable digest: `sha256:4cd5bad4bb4f9f13ddcb6586fd18d99923775743551e688bebb8f7bbd4154c1b`
- Artifact Registry provenance: SLSA build level 3
- Cloud Run revision: `canvas-seb-dev-00377-4tl`
- Previous revision: `canvas-seb-dev-00376-pjd`
- Previous digest: `sha256:a1fd4fc877552629d1647de3f3bd433a6c4fd7fdfa4a8aaf515ade07d3b8af65`

This record was written after the build so it could contain final deployment evidence; it is not part of the deployed image digest.

## Verification

| Check                  | Result                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local non-browser gate | Passed: typecheck, lint, Prettier, 39 files / 426 tests, coverage thresholds, client build, and server build                                                                |
| Local browser smoke    | Passed: 14/14 Chromium desktop and mobile tests                                                                                                                             |
| Cloud Build gate       | Passed all Docker-owned install, static-analysis, 426-test coverage, build, prune, and runtime-assembly steps; npm audit reported 0 vulnerabilities                         |
| Cloud Run              | Revision Ready, container healthy, and serving 100% of traffic from the exact immutable digest                                                                              |
| Runtime configuration  | `APP_ENV=dev`, `APP_DEBUG_ENABLED=false`, and `FIRESTORE_DATABASE_ID=seb-canvaslti-dev`; all required values remain Secret Manager references                               |
| Public IAM             | Existing `allUsers` binding retains `roles/run.invoker`; the deploy warning occurred because the binding was already present                                                |
| Health/JWKS/config     | Canonical `/health`, `/.well-known/jwks.json`, `/lti/config`, `/login`, and public encryption certificate returned 200                                                      |
| Detector               | Both compatibility URLs returned 200, byte-identical assets, and the deployed script contains the assessment-specific `launch_url` and `Open in Safe Exam Browser` behavior |
| Defensive routes       | Anonymous password reveal returned 401 and anonymous assessment launch returned 403                                                                                         |
| Firestore migration    | None required; the new launch marker is backward-compatible transient session state and no persistent document shape changed                                                |
| Firestore TTL          | `sessions`, `transientStates`, and `operationLocks` `expiresAt` policies remain Active                                                                                      |
| New-revision logs      | No error-severity entries or HTTP 5xx responses after deployment and smoke testing                                                                                          |

## Artifact Analysis

Artifact Analysis finished successfully and continuous analysis is active for the deployed digest. It reports no critical, high, or medium occurrences; 5 low and 7 minimal base-image occurrences remain. Build provenance is attached to the exact digest.

## Required Functional Smoke

The public and automated checks cannot complete a real signed Canvas student launch or start the native SEB application. Before using this revision for an actual exam, complete these dev checks with a test student and instructor:

1. Open a protected Classic Quiz outside SEB and confirm the detector popup's primary button opens that exact assessment directly in SEB without a second app-page click.
2. Repeat for a protected New Quiz and confirm “View quiz page” still dismisses the prompt for attempt-history review.
3. Start from an SEB profile with no Canvas cookies and confirm Kent Denver Google SSO returns to the assessment instead of a blank page.
4. As an instructor, reveal course and assessment passwords, confirm course/quiz source labels are correct, and confirm the values disappear after 30 seconds.
5. Confirm an 8-character non-sequential numeric value and an 8-character letters-only value save, while `12345678`, repeated patterns, and common passwords show the specific failing requirement.

## Rollback

No database rollback is needed. To return dev traffic to the immediately preceding revision:

```bash
gcloud run services update-traffic canvas-seb-dev \
  --project=securityapis \
  --region=us-central1 \
  --to-revisions=canvas-seb-dev-00376-pjd=100
```

That revision contains the blank-page URL-filter regression and the extra student launch page, so a forward fix is preferred.
