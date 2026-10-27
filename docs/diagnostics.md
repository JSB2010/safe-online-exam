# Production diagnostics (1.2)

Diagnostics operate independently of `APP_DEBUG_ENABLED` and development detector tracing. They default off. Publishing or upgrading the application does not automatically enable capture. Configure a bounded pilot window separately.

## Opt-in controls

Set `DIAGNOSTICS_ENABLED=true`, `DIAGNOSTICS_INSTALLATION_ID=pilot`, and a dedicated random `DIAGNOSTICS_HASH_KEY` (at least 32 characters). Restrict capture with comma-separated `DIAGNOSTICS_COURSE_IDS` and an ISO UTC `DIAGNOSTICS_EXPIRES_AT`. Invalid enabled configuration fails startup; expiry stops capture automatically. A course restriction permits pseudonymous early login events before a course is verified, but identity capture requires a verified allowed course.

Identity additionally requires `DIAGNOSTICS_IDENTITY_ENABLED=true`, `DIAGNOSTICS_IDENTITY_ACTIVE_KEY_ID`, and `DIAGNOSTICS_IDENTITY_KEYRING`, a JSON map of key IDs to 32-byte base64url AES keys. Use the dedicated diagnostics keyring, never a session, state or OAuth encryption key. Rotate by adding a new key, changing the active key, and retaining old decryption keys through the 90-day evidence window.

`DIAGNOSTICS_OTEL_ENABLED=true` enables bounded, asynchronous Cloud Trace export. Grant the product runtime `roles/cloudtrace.agent` at the later deployment. Owned request, Canvas and database spans contain fixed operation names and safe route templates, with no SQL text, URL credentials, identity, access codes or token values. Events carry Cloud Trace IDs. Export or logging failure does not grant access or fail an exam.

## Evidence and correlation

`src/shared/diagnostics` contains protocol v1, JSON wire schema and synthetic fixtures. Each event has a stable UUID. Flow IDs survive signed LTI state and encrypted OAuth state. Application attempt IDs remain distinct from flow IDs, HMAC learner identifiers, and Canvas submission attempt numbers. A course-navigation flow can have several assessment attempts. Server-side config admission, just-in-time Canvas session handoff, proof records and exit grants retain correlation. No identity is added to URLs.

Authorized downloads retain existing routes and single-use grants. Opt-in URLs and filenames carry a non-secret attempt UUID marker. The marker connects untrusted native evidence; it is not authentication. Successful delivery does not prove native decryption or quiz rendering. Browser events remain client-reported observations. Missing observations are unknown. Canvas assignment status is not automatically attributed to a launch.

Failures use safe categories for state decryption, LTI binding/token verification, request integrity, Canvas permissions/upstream status, OAuth refresh/decryption, config authorization/encryption, native proof, and database failures. Unexpected failures include sanitized stack frames and fingerprints, never raw error messages or SQL parameter values. Existing platform request logs may contain historical token-bearing URLs; the separate diagnostics importer stores only allowlisted target context and safe operation names.

## Additional APIs

- `POST /api/diagnostics/v1/browser-events`: bounded fixed-schema batches, signed attempt capability, configured Canvas/tool origin, per-instance attempt event budget. No DOM text, answers or arbitrary error messages. Disabled mode collects nothing.
- `GET /api/diagnostics/v1/context?courseId=42&offset=0`: read-only metadata and safe configuration presence flags, at most 25 records per page. Requires a Google-signed OIDC token with exact `DIAGNOSTICS_INTEGRATION_AUDIENCE` and `DIAGNOSTICS_SERVICE_ACCOUNT`. Credentials, access codes, Config Keys and full configurations are excluded.

All original LTI, OAuth and SEB compatibility routes remain unchanged. The existing student OAuth scopes are unchanged; the diagnostics dashboard owns a separate administrator Canvas connection.

## Retention and access

Structured events go to the configured Cloud Logging sink, then authenticated Pub/Sub delivery to the separate diagnostics worker. Identity is an AES-GCM envelope bound to installation and flow; technical events remain pseudonymous. The dashboard stores evidence in its separate `soe_diagnostics` database, restricts access to current collector administrators, and audits identified views, exports, log reads/downloads and associations. Live identity capture should have a documented school-approved investigation window. Do not collect answers, grades, passwords or exam secrets.

The investigation database enforces a 90-day maximum on reads and cleanup. Collector expiry can shorten native evidence retention. Cloud Logging, Pub/Sub and existing SQL backups have separate provider retention; database cleanup cannot erase existing backups. This implementation does not change the shared instance backup policy.

## Live rollout acceptance

After a separately authorized immutable 1.2 release and deployment, enable a short, restricted pilot window and verify actual LTI → OAuth → config → SEB → proof → code → submission observation → exit correlation, including a multi-attempt flow. Confirm native marker extraction against actual SEB logs and retain the distinction between server confirmation and client observation. Until then the dashboard must show **SOE 1.2 telemetry pending deployment**.

## Dependency review for 1.2

`body-parser@2.4.0` and `multer@2.5.0` have narrow three-day release-age exceptions because they fix GHSA-27r3-jxmh-p828 and GHSA-q7qp-rjg7-q26m. Registry integrity, exact pins, signature and audit gates remain in place. The protobufjs postinstall only emits dependency-version warnings; it is explicitly denied and never runs. The unrelated new gaxios 8.3.2 transitive release is held at 8.3.1.
