# Documentation

This directory is the public operating manual for Safe Online Exam. Start with
the path that matches your responsibility; no single person needs every guide.

## Choose A Path

### I am evaluating the project

1. Read the [project overview](../README.md).
2. Review [architecture and security boundaries](architecture.md).
3. Confirm that your institution can operate a supported
   [deployment](deployment.md), PostgreSQL, backups, public HTTPS, and managed
   SEB clients.
4. Review the [license](../LICENSE) and
   [commercial-use summary](../COMMERCIAL-LICENSE.md).

### I am deploying the service

1. Choose Docker Compose or Google Cloud Run in [deployment](deployment.md).
2. Prepare the values and secrets in the
   [configuration reference](configuration.md).
3. Create and distribute the client identity using
   [certificate management](certificate-management.md), unless the deployment
   has explicitly accepted plaintext configuration compatibility mode.
4. Complete the two registrations and theme loader in
   [Canvas setup](canvas-setup.md).
5. Run the role-based [acceptance sequence](testing.md#canvas-and-seb-acceptance).

### I administer Canvas

1. Follow [Canvas setup](canvas-setup.md).
2. Read the [administrator section of the user guide](user-guide.md#canvas-administrators).
3. Keep [troubleshooting](troubleshooting.md) available during a pilot.

### I teach with Safe Online Exam

Read [Instructor workflow](user-guide.md#instructors). Deployment, LTI
registration, OAuth keys, the Canvas theme, and managed client certificates
must already be in place.

### I support students

Read [Student workflow](user-guide.md#students) and
[Student and device troubleshooting](troubleshooting.md#student-and-device-problems).
Never ask a student to send an access code, session URL, `.p12`, or private
key.

### I contribute or maintain releases

1. Read [Contributing](../CONTRIBUTING.md) and the repository
   [agent guidance](../AGENTS.md).
2. Use [Testing](testing.md) for local and real-environment gates.
3. Use [Releasing](releasing.md) only after the release metadata is merged to
   `main`.

## Guide Map

| Guide                                               | Owns                                                                                                | Does not duplicate                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [Architecture](architecture.md)                     | Components, trust boundaries, identifiers, persistence, lifecycle, and stable routes                | Step-by-step installation             |
| [Canvas setup](canvas-setup.md)                     | API OAuth key, LTI registration, app installation, theme loader, and Canvas verification            | Infrastructure provisioning           |
| [User guide](user-guide.md)                         | Administrator, instructor, student, and support workflows                                           | Secret or database administration     |
| [Configuration](configuration.md)                   | Runtime variables, validation, file secrets, database settings, and rotation effects                | Provider-specific creation commands   |
| [Deployment](deployment.md)                         | Supported topologies, release selection, source builds, operations, upgrades, backups, and rollback | Full release-bundle command reference |
| [Certificate management](certificate-management.md) | SEB configuration-encryption identity lifecycle                                                     | General TLS or Canvas Developer Keys  |
| [Testing](testing.md)                               | Automated gates and real Canvas/SEB acceptance                                                      | Incident diagnosis                    |
| [Troubleshooting](troubleshooting.md)               | Symptom-driven diagnosis and safe evidence collection                                               | Routine setup                         |
| [Releasing](releasing.md)                           | Maintainer-only versioning and tag-driven publication                                               | Deployment of a published release     |

The release archives intentionally contain self-contained READMEs:

- [`deploy/compose-README.md`](../deploy/compose-README.md) becomes the README
  inside the Compose release bundle.
- [`deploy/cloud-run-README.md`](../deploy/cloud-run-README.md) becomes the
  README inside the Cloud Run release bundle.

Those manuals repeat a small amount of safety context because they must remain
usable after the archive is downloaded without this repository. The main
[deployment guide](deployment.md) explains how to choose and operate a mode;
the extracted bundle README is the exact command reference for that release.

## Documentation Conventions

- `${TOOL_URL}` means the final public HTTPS origin of one deployment, with no
  path or trailing slash.
- `${CANVAS_DOMAIN}` means the Canvas origin connected to that deployment.
- `X.Y.Z` means an exact released version.
- `sha256:...` means the immutable image digest published with that release.
- **Must** and **required** identify a runtime, protocol, or safety condition.
- **Recommended** identifies the maintained default; another choice needs an
  institution-specific review.

Commands containing placeholders are examples, not copy-and-run production
credentials. Never put secrets directly in shell arguments, screenshots,
issues, logs, or shared transcripts.

## Source Of Truth

Documentation is checked against the implementation, but these files define
the executable contract:

- runtime parsing and production validation:
  `src/server/config/app-config.ts`;
- public routes: `src/server/controllers/`;
- data schema: `src/server/data/migrations/`;
- Canvas OAuth scopes and content IDs: `src/shared/models/` through the stable `src/shared/models.ts` barrel;
- generated SEB policy: `src/server/services/seb-configuration.service.ts` and `seb-configuration-policy.ts`;
- Canvas detector source and assembly: `src/server/assets/detector/` and `src/server/services/detector-source.ts`;
- client route loading and static delivery: `vite.config.ts`,
  `src/client/app.tsx`, `src/server/http/app-shell.ts`,
  `src/server/http/static-assets.ts`, and `src/server/main.ts`;
- maintained deployment behavior: `Dockerfile`, `compose*.yaml`,
  `cloudbuild*.yaml`, `deploy/`, and `scripts/`;
- verification: `package.json`, `test/`, and `.github/workflows/`.

When code changes one of these contracts, update the owning guide in the same
pull request. Add a new guide only when the material has a distinct audience
or lifecycle; otherwise extend the existing owner.
