# Dev Security-Hardening Deployment — 2026-07-13

## Outcome

- The audited security-remediation workspace was deployed successfully to the Kent Denver development service.
- Automated build, Cloud Run, HTTP security, browser smoke, IAM, secret-reference, image-provenance, image-scanning, and Firestore TTL checks passed.
- Real Canvas instructor reauthorization, course refresh, password replacement, and native SEB device testing remain operational follow-up work; they are not represented as complete here.
- Production was not changed.

## Target

- Operator: `appdev@kentdenver.org`
- Google Cloud project: `securityapis` (`184075650720`)
- Cloud Run service: `canvas-seb-dev`
- Region: `us-central1`
- Firestore database: `seb-canvaslti-dev`
- Canonical Canvas-facing URL: `https://canvas-seb-dev-184075650720.us-central1.run.app`
- Runtime service account: `seb-canvas-dev@securityapis.iam.gserviceaccount.com`

## Source and Artifact Provenance

- Git base commit: `1fd0935e98404e729c8987293470038314eaa18a`
- Deployment source: the complete audited dirty-worktree remediation, uploaded as 128 files. Secret files, local certificates, generated output, dependencies, and local environment files were excluded by the upload manifest.
- Cloud Build ID: `9528f85a-f6d9-4455-ab65-31a1d1f99e47`
- Cloud Build result: `SUCCESS`; all five steps succeeded.
- Build source: `gs://securityapis_cloudbuild/source/1783966729.79404-06430a9e4d9b42b5aa53e0b1d8e03269.tgz`, generation `1783966730407546`
- Artifact: `us-central1-docker.pkg.dev/securityapis/canvas-seb-repo/canvas-seb-dev`
- Immutable digest: `sha256:406f643dd011baa99222241bf685432a994338c6fe42999bc6ad9e0a1034948b`
- Artifact Registry provenance: SLSA build level 3
- Cloud Run revision: `canvas-seb-dev-00375-rrt`
- Revision Ready: `2026-07-13T18:22:25.890328Z`
- Route cutover to 100%: `2026-07-13T18:22:27.271532Z`

The deployment record itself was written after the build so it could include final evidence; it is not part of the deployed image digest.

## Pre-Deployment Safeguards

- Previous revision: `canvas-seb-dev-00374-rrs`
- Previous digest: `sha256:2a9618b5c38ea286f4f927f1779066e9348bc2eb43e8c26e8f8db33e1efcbe75`
- Firestore export: `gs://securityapis-seb-firestore-backups/2026-07-13-pre-security-hardening`
- Export operation: `projects/securityapis/databases/seb-canvaslti-dev/operations/ASBmZjQ4MGQ0MTNjYmUtZDYzOC0yYmU0LTRmODYtZjVjNmFkNTUkGnNlbmlsZXBpcAkKMxI`
- Export result: `SUCCESSFUL`
- Backup bucket controls: uniform bucket-level access, public-access prevention, seven-day retention, and seven-day soft delete
- Backup timing caveat: the unusable Canvas OAuth token record had already been removed by the application's safe refresh path, so it is not present in this export.
- Container scanning was enabled before the image was pushed.

## IAM and Secret Hardening

- Dev now runs as the dedicated `seb-canvas-dev` identity instead of the shared legacy `seb-canvas` identity.
- The runtime identity has database-scoped `roles/datastore.user` access conditioned to `seb-canvaslti-dev`.
- It has `roles/secretmanager.secretAccessor` only on the ten required dev secrets.
- The configured Cloud Build identity can act as the dedicated dev runtime identity.
- Public Canvas access remains enabled through `allUsers` / `roles/run.invoker`; an unauthenticated health request succeeded after cutover.
- Cloud Run references Secret Manager rather than inline values for every sensitive setting.

Enabled secret versions at deployment time:

| Secret                               | Enabled version used through `latest` |
| ------------------------------------ | ------------------------------------: |
| `dev_canvas_domain`                  |                                     1 |
| `dev_lti_client_id`                  |                                     3 |
| `dev_lti_deployment_id`              |                                     1 |
| `dev_tool_url`                       |                                    13 |
| `dev_lti_private_key`                |                                     3 |
| `dev_session_secret`                 |                                     1 |
| `dev_state_encryption_key`           |                                     1 |
| `dev_api_client_id`                  |                                     1 |
| `dev_api_client_secret`              |                                     1 |
| `dev_seb_config_encryption_cert_pem` |                                     1 |

No secret value is included in this record.

## Firestore Migration

Traffic was drained for at least the configured 600-second request timeout before applying the cleanup so an in-flight legacy request could not restore raw New Quiz metadata.

| Phase                | Scanned | Matched | Updated | Batches | Result |
| -------------------- | ------: | ------: | ------: | ------: | ------ |
| Pre-deploy dry run   |       4 |       4 |       0 |       0 | Passed |
| Post-cutover dry run |       4 |       4 |       0 |       0 | Passed |
| Apply                |       4 |       4 |       4 |       1 | Passed |
| Post-apply dry run   |       4 |       0 |       0 |       0 | Passed |

The migration only removes legacy `canvas.metadata` payloads. TTL remained active for `sessions`, `transientStates`, and `operationLocks`.

## Verification

| Check                  | Result                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Local non-browser gate | Passed: typecheck, lint, Prettier, 38 test files / 410 tests, coverage thresholds, client build, and server build                |
| Browser smoke          | Passed: 14/14 Chromium desktop and mobile tests                                                                                  |
| Build and artifact     | Cloud Build succeeded; deployed image is pinned to the recorded digest                                                           |
| Cloud Run              | New revision Ready and serving 100%; dedicated runtime identity confirmed                                                        |
| Public IAM             | `allUsers` retains `roles/run.invoker`                                                                                           |
| Health and metadata    | `/health`, JWKS, detector, compatibility detector, and `/lti/config` passed                                                      |
| Canonical URLs         | LTI registration uses the stable Canvas-facing URL, not the alternate Cloud Run alias                                            |
| Canvas CORS            | Allowed Canvas origin succeeded with exact ACAO and no credential grant                                                          |
| Hostile CORS           | Hostile simple request and preflight rejected with 403 and no CORS grants                                                        |
| Security headers       | CSP, HSTS, no-sniff, no-referrer, permissions policy, and cache controls present; `x-powered-by` absent                          |
| Config download        | Direct download without one-time grant rejected; HEAD prefetch rejected                                                          |
| Access-code proof      | GET rejected; forged proof requests failed closed without returning an access code                                               |
| Config grant           | Unauthenticated grant rejected with `LTI_PRINCIPAL_REQUIRED`                                                                     |
| Exit behavior          | Retired automatic quit routes return 410; exit page exposes no automatic quit link or headers                                    |
| Logs                   | No application stdout/stderr warnings or errors; request warnings were expected 4xx security-test and password-policy rejections |
| Firestore TTL          | Active for all three transient collections                                                                                       |

### Container Scan

Artifact Analysis completed successfully with continuous analysis active across OS, NPM, secret, and other analyzers. The exact deployed digest has:

- 0 effective critical findings
- 0 effective high findings
- 0 effective medium findings
- 5 effective low findings
- 7 effective minimal findings

The low/minimal findings are inherited Debian 13 `glibc`/`zlib` items in the distroless base image. Artifact Analysis did not surface a fixed Debian package version for them. Continue continuous scanning and rebuild when Google publishes an updated fixed base image.

## Required Instructor Reconciliation

Before using this deployment for a real exam:

1. Reauthorize Canvas OAuth through an instructor LTI launch.
2. Refresh every active course to establish authoritative Canvas verification state. The eight legacy-unverified assessment records, including two enabled assessments, intentionally fail closed until refreshed.
3. Replace the weak legacy course quit password and the enabled assessment's explicit weak override with distinct policy-compliant values.
4. Re-enable or regenerate affected assessment configs as needed after password replacement.
5. Test instructor launch, learner launch, Classic Quiz, New Quiz, the setup check, managed-device certificate decryption, Config Key proof, access-code fill, and explicit native quit behavior using a real SEB-managed device.

Do not restore wildcard domain rules to make native testing pass. Add only explicitly required resource hosts after verifying each dependency.

## Residual Follow-Up

- Audit all remaining consumers of the shared `seb-canvas@securityapis.iam.gserviceaccount.com` identity, then remove its broad Secret Manager roles and user-managed keys when safe. The dev service no longer uses it.
- Replace the broad project permissions on the current Cloud Build execution identity with a dedicated least-privilege build identity.
- Review and disable superseded enabled secret versions after the rollback window closes.
- Rebuild when a distroless base containing fixes for the scan's low/minimal OS findings is available.

## Rollback

Rollback should normally use a forward fix. The metadata cleanup is designed for the hardened data model, so do not route traffic to a pre-fix revision after applying it unless the security tradeoff is explicitly accepted.

Emergency traffic rollback command:

```bash
gcloud run services update-traffic canvas-seb-dev \
  --project=securityapis \
  --region=us-central1 \
  --to-revisions=canvas-seb-dev-00374-rrs=100
```

The previous digest is recorded above. The pre-deployment Firestore export is available at the recorded backup URI; restoring legacy metadata should occur only as part of a deliberate legacy-code rollback that accepts the original exposure.

## Completion

- Infrastructure deployment completed at `2026-07-13T18:22:30.829Z`.
- Firestore cleanup completed at `2026-07-13T18:33:09Z`.
- Automated deployment verification is complete.
- Canvas instructor and native SEB verification remain pending as explicitly listed above.
