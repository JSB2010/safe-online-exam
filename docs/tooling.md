# Tooling Decisions

## Package Manager

Use npm.

This repo is one deployable TypeScript application. npm is already included with the Node 22 base image, `npm ci` gives deterministic frozen installs from `package-lock.json`, and Cloud Build/Docker support stays simple.

Do not migrate to pnpm, Bun, or Turborepo right now.

When to reconsider:

- Move to pnpm workspaces if the repo splits into multiple packages, for example `apps/web`, `apps/api`, and shared packages.
- Add Turborepo if there are repeated workspace tasks that benefit from task graph scheduling and remote cache.
- Consider Bun only in a separate validation branch after checking NestJS, Firestore, jose, Playwright, Cloud Run, and production debugging behavior under Bun.

## Build Optimization

Cloud Build now delegates install, verification, build, and production dependency pruning to Docker stages:

1. `deps`: `npm ci`
2. `verify`: typecheck, lint, Prettier check, coverage tests, build
3. `production-deps`: `npm prune --omit=dev`
4. `runtime`: copy only `dist`, production `node_modules`, and package metadata

This removes the previous duplicate work where Cloud Build installed and built outside Docker, then the Dockerfile installed and built again.

The Cloud Build configs also pull the previous image and pass `--cache-from` to Docker. This lets Docker reuse layers when dependency files or source files have not changed.

## CI Policy

Deploy Cloud Builds should run:

- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run test:coverage`
- `npm run build`

These commands currently run inside Docker during image build.

Playwright e2e tests are kept as a separate command:

```bash
npm run test:e2e
```

They install/use browser binaries and are better suited for local verification, a pull-request workflow, or a scheduled CI job than every Cloud Run deployment.

## Formatting and Linting

ESLint handles code-quality rules. Prettier handles formatting.

Commands:

```bash
npm run lint
npm run lint:fix
npm run format:check
npm run format
```

The detector script at `src/server/assets/canvas-seb-detector.js` is excluded from Prettier because it is a compatibility asset copied from the previous implementation.

## Environment Management

Use environment variables, not Java `.properties` files.

- `.env.example` documents local values.
- Real `.env` files are ignored.
- Cloud Run values come from `--set-env-vars` and `--set-secrets` in Cloud Build.

No dotenv package is used at runtime. For local runs, export variables in the shell or use the inline command examples in `README.md` and `docs/testing.md`.

## Repository Hygiene

Ignored generated/local artifacts:

- `node_modules`
- `dist`
- `coverage`
- `test-results`
- `playwright-report`
- `.turbo`
- local `.env` files
- IDE metadata

Cloud Build upload ignores the same high-cost local artifacts through `.gcloudignore`.
