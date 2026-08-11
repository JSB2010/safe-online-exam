import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("deployment hardening artifacts", () => {
  it("ships a portable, persistent Compose topology from the non-root application image", () => {
    const compose = source("compose.yaml");
    const dockerfile = source("Dockerfile");

    expect(compose).toContain("${APP_IMAGE:?");
    expect(compose).toMatch(/postgres:17-alpine@sha256:[0-9a-f]{64}/u);
    expect(compose).toContain("postgres_data:");
    expect(compose).toContain("${BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-8080}:8080");
    expect(compose).toContain("pg_isready");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("/ready");
    const postgresService = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  migrate:"));
    expect(postgresService).not.toContain("ports:");
    expect(dockerfile).toMatch(/^# syntax=docker\/dockerfile:1@sha256:[0-9a-f]{64}$/mu);
    expect(dockerfile).toMatch(/FROM --platform=\$BUILDPLATFORM node:24-bookworm-slim@sha256:[0-9a-f]{64} AS base/u);
    expect(dockerfile).toMatch(/FROM node:24-bookworm-slim@sha256:[0-9a-f]{64} AS production-deps/u);
    expect(dockerfile).toContain("npm ci --omit=dev");
    expect(dockerfile).toContain("npm ci --ignore-scripts");
    expect(dockerfile).toContain("npm audit signatures");
    expect(dockerfile.indexOf("npm ci --ignore-scripts")).toBeLessThan(dockerfile.indexOf("npm audit signatures"));
    expect(dockerfile.indexOf("npm audit signatures")).toBeLessThan(dockerfile.indexOf("npm run install:trusted"));
    expect(dockerfile).toContain("npm run install:trusted");
    expect(dockerfile.match(/corepack enable npm --install-directory \/opt\/corepack-shims/gu)).toHaveLength(2);
    expect(dockerfile.match(/npm --version \| grep -Fx "11\.19\.0"/gu)).toHaveLength(2);
    expect(dockerfile).not.toContain("npm install -g npm@");
    expect(dockerfile).toContain("RUN --network=none npm run typecheck");
    expect(dockerfile).toContain("RUN --network=none npm run build");
    expect(dockerfile).toMatch(/distroless\/nodejs24-debian13:nonroot@sha256:[0-9a-f]{64}/u);
    expect(dockerfile).not.toMatch(/apt-get[\s\S]{0,100}postgres/iu);
  });

  it("ships a hardened Compose override using mounted secret files", () => {
    const override = source("compose.secrets.yaml");
    const example = source(".env.compose.secrets.example");

    expect(override).toContain("POSTGRES_PASSWORD_FILE: /run/secrets/database_password");
    expect(override).toContain("DATABASE_PASSWORD_FILE: /run/secrets/database_password");
    expect(override).toContain("LTI_PRIVATE_KEY_FILE: /run/secrets/lti_private_key");
    expect(override).toContain("CANVAS_API_CLIENT_SECRET_FILE: /run/secrets/canvas_api_client_secret");
    expect(override).toContain("SESSION_SECRET_FILE: /run/secrets/session_secret");
    expect(override).toContain("STATE_ENCRYPTION_KEY_FILE: /run/secrets/state_encryption_key");
    expect(override).toContain("OAUTH_TOKEN_ENCRYPTION_KEYRING_FILE: /run/secrets/oauth_token_encryption_keyring");
    expect(override).toContain("secrets: *app-secrets");
    expect(override).not.toContain(":/run/secrets:ro");
    expect(source(".env.example")).toContain(
      'OAUTH_TOKEN_ENCRYPTION_KEYRING={"local-v1":"replace-with-a-32-byte-base64url-key"}'
    );
    expect(example).not.toMatch(
      /^(DATABASE_PASSWORD|LTI_PRIVATE_KEY|CANVAS_API_CLIENT_SECRET|SESSION_SECRET|STATE_ENCRYPTION_KEY|OAUTH_TOKEN_ENCRYPTION_KEYRING)=/mu
    );
  });

  it("blocks dependency lifecycle scripts except the exact reviewed rebuild path", () => {
    const npmConfig = source(".npmrc");
    const packageJson = source("package.json");
    const verifier = source("scripts/verify-install-scripts.mjs");
    const workflow = source(".github/workflows/ci.yml");

    expect(npmConfig).toContain("ignore-scripts=true");
    expect(npmConfig).toContain("strict-allow-scripts=true");
    expect(npmConfig).toContain("allow-git=none");
    expect(npmConfig).toContain("allow-remote=none");
    expect(npmConfig).toContain("allow-file=none");
    expect(npmConfig).toContain("allow-directory=none");
    expect(npmConfig).not.toContain("min-release-age");
    expect(packageJson).toMatch(/"packageManager": "npm@11\.19\.0\+sha512\.[0-9a-f]{128}"/u);
    expect(npmConfig).not.toContain("strict-npmrc");
    expect(packageJson).toContain(
      '"install:trusted": "npm run verify:dependency-policy:offline && npm rebuild esbuild --ignore-scripts=false'
    );
    expect(packageJson).toContain('"fsevents": false');
    expect(verifier).toContain("hasInstallScript !== true");
    expect(verifier).toContain("REGISTRY_ORIGIN");
    expect(verifier).toContain("SHA512_INTEGRITY");
    expect(verifier).toContain("DEFAULT_MIN_RELEASE_AGE_DAYS = 3");
    expect(verifier).toContain("verifyPublicationAges");
    expect(verifier).toContain("metadata?.time?.[version]");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow.match(/corepack enable npm --install-directory/gu)).toHaveLength(3);
    expect(workflow).not.toContain("npm install --global npm@");
    expect(workflow).toContain("name: Dependency integrity");
    expect(workflow).toContain("npm audit signatures");
    expect(workflow).toContain("npm audit --omit=dev --audit-level=high");
    const integrityJob = workflow.slice(workflow.indexOf("  dependency-integrity:"), workflow.indexOf("  compose:"));
    expect(integrityJob.indexOf("npm ci --ignore-scripts")).toBeLessThan(integrityJob.indexOf("npm audit signatures"));
    expect(integrityJob.indexOf("npm audit signatures")).toBeLessThan(integrityJob.indexOf("npm run install:trusted"));
    expect(workflow.match(/needs: dependency-integrity/gu)).toHaveLength(3);
    expect(() => source(".github/workflows/dependabot-automerge.yml")).toThrow();
  });

  it("keeps maintainer documentation aligned with dependency and OAuth policy", () => {
    for (const path of ["README.md", "AGENTS.md", "CONTRIBUTING.md", "docs/testing.md"]) {
      expect(source(path), path).toMatch(
        /npm run verify:dependency-policy\s+npm ci --ignore-scripts\s+npm run install:trusted/u
      );
    }

    const architecture = source("docs/architecture.md");
    const configuration = source("docs/configuration.md");
    expect(architecture).toContain("One durable per-user grant");
    expect(configuration).toContain("One durable Canvas OAuth grant per user");
    expect(`${architecture}\n${configuration}`).not.toMatch(/purpose-scoped Canvas OAuth/iu);

    const ruleset = JSON.parse(source(".github/rulesets/protect-main.json"));
    const pullRequestRule = ruleset.rules.find((rule: { type?: string }) => rule.type === "pull_request");
    expect(pullRequestRule?.parameters).toMatchObject({
      require_code_owner_review: false,
      required_approving_review_count: 0
    });
    expect(source(".github/CODEOWNERS")).toContain("does not require a separate approval");
    expect(source("docs/testing.md")).toContain("manually merge each Dependabot pull request");
    expect(source("docs/releasing.md")).toContain("dependency-review, dependency-integrity");
  });

  it("ships an optional Caddy profile without exposing the application or database by default", () => {
    const caddy = source("compose.caddy.yaml");
    const caddyfile = source("Caddyfile");

    expect(caddy).toContain('profiles: ["caddy"]');
    expect(caddy).toMatch(/caddy:2\.[0-9]+-alpine@sha256:[0-9a-f]{64}/u);
    expect(caddy).toContain("PUBLIC_HOST: ${PUBLIC_HOST:-}");
    expect(caddy).toContain('"80:80"');
    expect(caddy).toContain('"443:443"');
    expect(caddyfile).toContain("{$PUBLIC_HOST}");
    expect(caddyfile).toContain("reverse_proxy app:8080");
    expect(source("compose.yaml")).toContain("127.0.0.1");
  });

  it("packages a digest-pinned self-hosted release bundle without source checkout", () => {
    const bundle = source("scripts/create-release-bundle.sh");
    const bootstrap = source("scripts/bootstrap-compose-secrets.sh");
    const bundleReadme = source("deploy/compose-README.md");
    const dockerfile = source("Dockerfile");

    expect(bundle).toContain("safe-online-exam-${version}");
    expect(bundle).toContain("compose.caddy.yaml");
    expect(bundle).toContain("setup-compose.sh");
    expect(bundle).toContain("compose-deployment.sh");
    expect(bundle).toContain("setup-common.sh");
    expect(bundle).toContain("bootstrap-secrets.sh");
    expect(bundle).toContain("backup.sh");
    expect(bundle).toContain("upgrade.sh");
    expect(bundle).toContain("IMAGE_DIGEST");
    expect(bootstrap).toContain("safe-online-exam@sha256");
    expect(bootstrap).toContain("generate-lti-private-key.mjs");
    expect(bootstrap).toContain("seb-client-identity");
    expect(bootstrap).not.toContain("CANVAS_API_CLIENT_SECRET=");
    expect(bundleReadme).toContain("does not contain application source code");
    expect(bundleReadme).toContain("./setup.sh");
    expect(bundleReadme).toContain("--non-interactive");
    expect(dockerfile).toContain("scripts/generate-lti-private-key.mjs");
    expect(source("scripts/compose-smoke.sh")).toContain("compose.caddy.yaml --profile caddy config --quiet");
    expect(source("scripts/compose-smoke.sh")).toContain('docker run --rm --entrypoint /nodejs/bin/node "$image"');
    expect(source("scripts/compose-smoke.sh")).toContain("scripts/upgrade-compose.sh");
    expect(source("scripts/compose-smoke.sh")).toContain("COMPOSE_SMOKE_ACTIVE=true");
    expect(source(".env.compose.secrets.example")).toContain("COMPOSE_PROJECT_NAME=");
    expect(source("scripts/compose-smoke.sh")).toContain("--local-smoke-image");
    expect(source("scripts/upgrade-compose.sh")).toContain(
      "--local-smoke-image is reserved for the isolated Compose smoke test"
    );
    expect(source("scripts/upgrade-compose.sh")).toContain("^ghcr\\.io/jsb2010/safe-online-exam@sha256:[0-9a-f]{64}$");
    expect(source("scripts/upgrade-compose.sh")).toContain("docker inspect --format");
    expect(source("scripts/upgrade-compose.sh")).toContain("has not completed a compat-mode deployment");
    expect(source("scripts/compose-smoke.sh")).not.toContain("node scripts/generate-lti-private-key.mjs compose-smoke");
  });

  it("contains no retired document-database runtime dependency or provider", () => {
    const production = [source("package.json"), ...sourceTree("src"), ...sourceTree("scripts")].join("\n");
    for (const forbidden of [
      ["@google-cloud/", "firestore"].join(""),
      ["Firebase", "Fire", "store"].join(""),
      ["FIRE", "STORE_"].join(""),
      ["Fire", "storeCollectionStore"].join("")
    ]) {
      expect(production).not.toContain(forbidden);
    }
  });

  it("keeps local private-key artifacts out of version control and build contexts", () => {
    const requiredPatterns = [".local/", ".worktrees/", "*.p12", "*.pfx", "*.key", "*.key.pem", "*.private.pem"];

    for (const path of [".gitignore", ".dockerignore", ".gcloudignore"]) {
      const patterns = new Set(
        source(path)
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line !== "" && !line.startsWith("#"))
      );

      for (const pattern of requiredPatterns) {
        expect(patterns.has(pattern), `${path} must ignore ${pattern}`).toBe(true);
      }

      // Public certificate chains may legitimately be part of documentation or
      // test fixtures, so keep this rule scoped to private-key filename forms.
      expect(patterns.has("*.pem"), `${path} must not blanket-ignore all PEM files`).toBe(false);
    }

    expect(source("eslint.config.js")).toContain('".local/**"');
  });

  it("includes release consistency inputs in every build context", () => {
    for (const path of [".dockerignore", ".gcloudignore"]) {
      const patterns = new Set(
        source(path)
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line !== "" && !line.startsWith("#"))
      );

      expect(patterns.has("!.env.compose.example"), `${path} must include .env.compose.example`).toBe(true);
    }
  });

  it("does not publish production client source maps", () => {
    expect(source("vite.config.ts")).toContain("sourcemap: false");
    expect(source("vite.config.ts")).toContain('".worktrees/**"');
  });

  it("deploys every Cloud Run target by an immutable registry digest", () => {
    const pusher = source("scripts/push-image-capture-digest.sh");
    const helper = source("scripts/deploy-cloud-run-digest.sh");

    expect(pusher).toContain('docker push "$image_tag"');
    expect(pusher).toContain("[Dd]igest:");
    expect(pusher).toContain("printf '%s\\n' \"$digest\"");
    expect(helper).not.toContain("gcloud artifacts docker images describe");
    expect(helper).toContain("sha256:[0-9a-f]{64}");
    expect(helper).toContain('"--image=${repository}@${digest}"');

    for (const path of ["cloudbuild-dev.yaml", "cloudbuild-school.yaml"]) {
      const config = source(path);
      expect(config, path).toContain("_OAUTH_TOKEN_ENCRYPTION_MODE: REPLACE_WITH_COMPAT_OR_ENFORCE");
      expect(config, path).toContain('entrypoint: "/workspace/scripts/validate-oauth-encryption-rollout.sh"');
      expect(config, path).toContain('entrypoint: "/workspace/scripts/push-image-capture-digest.sh"');
      expect(config, path).toContain('entrypoint: "/workspace/scripts/deploy-cloud-run-digest.sh"');
      expect(config, path).toContain(":$BUILD_ID");
      expect(config, path).toMatch(/\/workspace\/canvas-seb-[a-z]+\.digest/u);
      expect(config, path).toContain("LTI_DEPLOYMENT_ID=");
      expect(config, path).toContain("APP_DEBUG_ENABLED=false");
      expect(config, path).toContain('      - "service"');
    }

    const production = source("cloudbuild-prod.yaml");
    const releaseVerifier = source("scripts/verify-github-release-attestation.sh");
    expect(production).toContain("_IMAGE_DIGEST: sha256:REPLACE_WITH_RELEASE_DIGEST");
    expect(production).toContain("_OAUTH_TOKEN_ENCRYPTION_MODE: REPLACE_WITH_COMPAT_OR_ENFORCE");
    expect(source("AGENTS.md")).toContain(
      "_GITHUB_ATTESTATION_TOKEN_SECRET_VERSION=SECRET_VERSION,_OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION=KEYRING_VERSION,_OAUTH_TOKEN_ENCRYPTION_MODE=compat"
    );
    expect(production).toContain('entrypoint: "/workspace/scripts/validate-oauth-encryption-rollout.sh"');
    expect(production).toContain('entrypoint: "/workspace/scripts/write-image-digest.sh"');
    expect(production).toContain('entrypoint: "/workspace/scripts/deploy-cloud-run-digest.sh"');
    expect(production).toContain('entrypoint: "/workspace/scripts/verify-github-release-attestation.sh"');
    expect(production).toContain('entrypoint: "/workspace/scripts/create-binary-authorization-attestation.sh"');
    expect(production.match(/--binary-authorization=default/gu)).toHaveLength(3);
    expect(production).toContain("availableSecrets:");
    expect(production).not.toContain("docker build");
    expect(production).not.toContain("npm ");
    expect(releaseVerifier).toContain("releases/tags/$release_tag");
    expect(releaseVerifier).toContain('"$immutable" == "true"');
  });

  it("can manually promote only a released Safe Online Exam GHCR digest", () => {
    const helper = source("scripts/deploy-cloud-run-digest.sh");
    const writer = source("scripts/write-image-digest.sh");
    const promotion = source("cloudbuild-prod.yaml");

    expect(helper).toContain('"ghcr.io/jsb2010/safe-online-exam"');
    expect(writer).toContain("invalid image digest");
    expect(writer).toContain("output must be a direct child of /workspace");
    expect(promotion).toContain("_IMAGE_REPOSITORY: ghcr.io/jsb2010/safe-online-exam");
    expect(promotion).toContain("_IMAGE_DIGEST: sha256:REPLACE_WITH_RELEASE_DIGEST");
    expect(promotion).toContain('entrypoint: "/workspace/scripts/write-image-digest.sh"');
    expect(promotion).toContain('entrypoint: "/workspace/scripts/verify-github-release-attestation.sh"');
    expect(promotion).toContain('      - "JSB2010/safe-online-exam"');
    expect(promotion).toContain('      - "JSB2010/safe-online-exam/.github/workflows/publish-release-image.yml"');
    expect(promotion).not.toContain("JSB2010/SEB-CanvasLTI");
    expect(promotion).toContain('entrypoint: "/workspace/scripts/create-binary-authorization-attestation.sh"');
    expect(promotion.match(/entrypoint: "\/workspace\/scripts\/deploy-cloud-run-digest\.sh"/gu)).toHaveLength(3);
    expect(promotion.match(/--binary-authorization=default/gu)).toHaveLength(3);
    expect(promotion).toContain("-migrate");
    expect(promotion).toContain("-cleanup");
    expect(promotion).toContain('"--wait"');
    expect(promotion).not.toContain("docker build");
  });

  it("publishes an immutable release from one verified tag push", () => {
    const workflow = source(".github/workflows/publish-release-image.yml");
    const requiredChecks = source("scripts/wait-for-required-checks.sh");
    const imageVerifier = source("scripts/verify-release-image.sh");

    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).not.toContain("types: [published]");
    expect(workflow).toContain("node scripts/verify-release.mjs");
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain(
      "verify-release:\n    name: Verify release source\n    runs-on: ubuntu-24.04\n    # The required-check waiter polls for up to 30 minutes. Leave enough\n    # headroom for checkout, metadata validation, and GitHub API latency.\n    timeout-minutes: 40"
    );
    expect(workflow).toContain("publish:\n    name: Publish verified release\n    needs: verify-release");
    expect(workflow.indexOf("git merge-base --is-ancestor")).toBeLessThan(
      workflow.indexOf("node scripts/verify-release.mjs")
    );
    expect(workflow).toContain("ref: ${{ needs.verify-release.outputs.verified_sha }}");
    expect(workflow).not.toContain("repos/$GITHUB_REPOSITORY/immutable-releases");
    expect(workflow).toContain("VERIFIED_SHA: ${{ steps.source.outputs.verified_sha }}");
    expect(workflow).toContain('wait-for-required-checks.sh "$VERIFIED_SHA"');
    expect(workflow).not.toContain('wait-for-required-checks.sh "${{ steps.source.outputs.verified_sha }}"');
    expect(requiredChecks).toContain("Application verification");
    expect(requiredChecks).toContain("PostgreSQL integration");
    expect(requiredChecks).toContain("Production Compose smoke");
    expect(requiredChecks).toContain("Dependency integrity");
    expect(requiredChecks).toContain("Analyze (javascript-typescript)");
    expect(requiredChecks).toContain("Analyze (actions)");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--verify-tag --draft");
    expect(workflow).toContain("bash scripts/compose-smoke.sh");
    expect(workflow).toContain('COMPOSE_SMOKE_SKIP_BUILD: "true"');
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toMatch(/uses: actions\/attest@[0-9a-f]{40} # v\d+\.\d+\.\d+/u);
    expect(workflow).toContain("org.opencontainers.image.licenses=PolyForm-Noncommercial-1.0.0");
    expect(workflow).toContain("type=raw,value=latest");
    expect(workflow).not.toContain("scope: ${{ env.IMAGE_NAME }}@push");
    expect(workflow).toContain("cache-to: type=registry");
    expect(workflow).toContain("create-release-bundle.sh");
    expect(workflow).toContain("create-cloud-run-bundle.sh");
    expect(workflow).toContain("render-release-deployment-notes.sh");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("docker buildx imagetools create");
    expect(workflow).toContain("gh attestation verify");
    expect(workflow).toContain("--signer-workflow");
    expect(workflow).toContain("--source-digest");
    expect(workflow).toContain("--source-ref");
    expect(workflow).toContain("--draft=false");
    expect(workflow).toContain(".isImmutable");
    expect(imageVerifier).toContain("linux/amd64");
    expect(imageVerifier).toContain("linux/arm64");
    expect(imageVerifier).toContain("org.opencontainers.image.revision");
  });

  it("runs the deploy-equivalent verification layers for pull requests and main pushes without credentials", () => {
    const workflow = source(".github/workflows/ci.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain("npm run verify:postgres");
    expect(workflow).toContain("Dependency review");
    expect(workflow).toContain("actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294");
    expect(workflow).toContain("bash scripts/compose-smoke.sh");
    expect(workflow).toContain("docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a");
    expect(workflow).toContain('COMPOSE_SMOKE_SKIP_BUILD: "true"');
    expect(workflow).not.toMatch(/gcloud|google-github-actions|packages: write|id-token: write/iu);
  });

  it("pins every external workflow action to an immutable commit", () => {
    const workflows = sourceTree(".github/workflows").join("\n");
    const references = [...workflows.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu)].map((match) => match[1]);

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference).toMatch(/^[0-9a-f]{40}$/u);
    }
  });

  it("checks in the enforced main rules and repository hardening setup", () => {
    const ruleset = JSON.parse(source(".github/rulesets/protect-main.json")) as {
      enforcement: string;
      rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }>;
    };
    const setup = source("scripts/configure-github-repository.sh");
    const requiredStatusRule = ruleset.rules.find((rule) => rule.type === "required_status_checks");
    const contexts = requiredStatusRule?.parameters?.required_status_checks?.map((check) => check.context);

    expect(ruleset.enforcement).toBe("active");
    expect(ruleset.rules.map((rule) => rule.type)).toEqual(
      expect.arrayContaining([
        "deletion",
        "non_fast_forward",
        "required_signatures",
        "pull_request",
        "required_status_checks"
      ])
    );
    expect(contexts).toEqual([
      "Application verification",
      "PostgreSQL integration",
      "Production Compose smoke",
      "Dependency review",
      "Dependency integrity",
      "CodeQL"
    ]);
    expect(setup).toContain("allow_auto_merge: true");
    expect(setup).toContain("allow_rebase_merge: false");
    expect(setup).toContain("delete_branch_on_merge: true");
    expect(setup).toContain("sha_pinning_required: true");
    expect(setup).toContain("automated-security-fixes");
    expect(setup).toContain("private-vulnerability-reporting");
    expect(setup).toContain("immutable-releases");
  });

  it("tracks application, workflow, and container updates through Dependabot", () => {
    const dependabot = source(".github/dependabot.yml");
    const docker = dependabot.slice(
      dependabot.indexOf("package-ecosystem: docker\n"),
      dependabot.indexOf("package-ecosystem: docker-compose")
    );
    const dockerCompose = dependabot.slice(dependabot.indexOf("package-ecosystem: docker-compose"));

    expect(dependabot).toContain("package-ecosystem: npm");
    expect(dependabot).toContain("package-ecosystem: github-actions");
    expect(dependabot).toContain("package-ecosystem: docker");
    expect(dependabot).toContain("package-ecosystem: docker-compose");
    expect(dependabot.match(/interval: weekly/gu)).toHaveLength(4);
    expect(dependabot).toContain("versioning-strategy: increase-if-necessary");
    expect(dependabot).toContain("applies-to: security-updates");
    expect(dependabot).toContain("cooldown:");
    expect(dependabot).toContain("pinned-actions:");
    expect(dependabot).toContain("production-minor-and-patch:");
    expect(dependabot).toContain("docker-minor-and-patch:");
    expect(dependabot).toContain("compose-minor-and-patch:");
    expect(dependabot).toContain("dependency-name: node");
    expect(dependabot).toContain("dependency-name: postgres");
    expect(dependabot).toContain("dependency-name: typescript");
    expect(dependabot).toContain('dependency-name: "@types/node"');
    expect(dependabot).toContain("version-update:semver-major");
    for (const containerEcosystem of [docker, dockerCompose]) {
      expect(containerEcosystem).toContain("default-days: 7");
      expect(containerEcosystem).not.toMatch(/semver-(major|minor|patch)-days/u);
    }
  });

  it("supplements Dependabot with weekly hidden-pin and published-image maintenance", () => {
    const workflow = source(".github/workflows/supply-chain-maintenance.yml");
    const monitor = source("scripts/check-supply-chain-pins.mjs");

    expect(workflow).toContain('cron: "30 14 * * 1"');
    expect(workflow).toContain("npm audit signatures");
    expect(workflow).toContain("npm audit --omit=dev --audit-level=high");
    expect(workflow).toContain("node scripts/check-supply-chain-pins.mjs");
    expect(workflow).toContain("docker/setup-buildx-action@");
    expect(workflow).toContain("issues: write");
    expect(workflow.indexOf("issues: write")).toBeGreaterThan(workflow.indexOf("maintenance-issue:"));
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("ghcr.io/jsb2010/safe-online-exam:latest");
    expect(workflow).toContain("ignore-unfixed: false");
    expect(workflow).toContain("ignore-unfixed: true");
    expect(monitor).toContain('"imagetools", "inspect"');
    expect(monitor).toContain("npm outdated");
    expect(monitor).toContain("Dockerfile frontend must be pinned");
    expect(monitor).toContain("GitHub CLI verifier");
  });

  it("keeps the pinned npm toolchain synchronized across local and container builds", () => {
    const packageJson = JSON.parse(source("package.json")) as { packageManager?: string };
    const dockerfile = source("Dockerfile");
    const releaseVerifier = source("scripts/verify-release.mjs");
    const npmVersion = packageJson.packageManager?.match(/^npm@(\d+\.\d+\.\d+)\+sha512\.[0-9a-f]{128}$/u)?.[1];

    expect(npmVersion).toBeTruthy();
    expect(dockerfile.match(new RegExp(`npm --version \\| grep -Fx "${npmVersion}"`, "gu"))).toHaveLength(2);
    expect(releaseVerifier).toContain("matchAll");
    expect(releaseVerifier).toContain("dockerfilePackageManagerVersions.length !== 2");
  });

  it("allows a school deployment to configure its own Canvas LTI platform endpoints", () => {
    const config = source("cloudbuild-school.yaml");

    expect(config).toContain("_LTI_ISSUER: https://canvas.instructure.com");
    expect(config).toContain("_LTI_KEY_SET_URL: https://sso.canvaslms.com/api/lti/security/jwks");
    expect(config).toContain("_LTI_AUTH_URL: https://sso.canvaslms.com/api/lti/authorize_redirect");
    expect(config.match(/LTI_ISSUER=\$\{_LTI_ISSUER\}/gu)).toHaveLength(3);
    expect(config.match(/LTI_KEY_SET_URL=\$\{_LTI_KEY_SET_URL\}/gu)).toHaveLength(3);
    expect(config.match(/LTI_AUTH_URL=\$\{_LTI_AUTH_URL\}/gu)).toHaveLength(3);
  });

  it("gates Cloud Run deployments on PostgreSQL integration tests and Cloud SQL migrations", () => {
    const integration = source("scripts/cloud-build-postgres-integration.sh");

    expect(integration).toContain("--target postgres-tests");
    expect(integration).toContain("compose.postgres-test.yaml");
    expect(integration).toContain("postgres:17-alpine@sha256:");
    expect(integration).not.toMatch(/\n\s*postgres:17-alpine\s/u);
    const dockerfile = source("Dockerfile");
    expect(dockerfile).toContain("FROM deps AS postgres-tests");
    expect(dockerfile.indexOf("FROM deps AS postgres-tests")).toBeLessThan(dockerfile.indexOf("FROM deps AS verify"));
    expect(dockerfile).toContain('CMD ["npm", "run", "test:postgres"]');

    for (const path of ["cloudbuild-dev.yaml", "cloudbuild-school.yaml"]) {
      const config = source(path);
      expect(config, path).toContain('entrypoint: "/workspace/scripts/cloud-build-postgres-integration.sh"');
      expect(config, path).toContain("--set-cloudsql-instances=");
      expect(config, path).toContain("--add-cloudsql-instances=");
      expect(config, path).toContain("DATABASE_HOST=/cloudsql/");
      expect(config, path).toContain("DATABASE_PASSWORD=");
      expect(config, path).toContain('      - "job"');
      expect(config, path).toContain("-migrate");
      expect(config, path).toContain("-cleanup");
      expect(config, path).toContain("--command=/nodejs/bin/node");
      expect(config, path).not.toContain("--command=node");
      expect(config, path).toMatch(/\bexecute\b/u);
      expect(config, path).toContain("--wait");
      expect(config, path).toContain("DOCKER_BUILDKIT=1");
      expect(config, path).toContain("BUILDKIT_INLINE_CACHE=1");
      expect(config, path).toMatch(/gcr\.io\/google\.com\/cloudsdktool\/google-cloud-cli:stable@sha256:[0-9a-f]{64}/u);
      expect(config, path).toMatch(/gcr\.io\/cloud-builders\/docker:latest@sha256:[0-9a-f]{64}/u);
      expect(config, path).not.toMatch(/:latest(?!@sha256)/u);
      expect(config, path).not.toContain(["FIRE", "STORE"].join(""));
    }

    const production = source("cloudbuild-prod.yaml");
    expect(production).toContain("ghcr.io/jsb2010/safe-online-exam");
    expect(production).toContain("-migrate");
    expect(production).toContain("-cleanup");
    expect(production).toContain("--wait");
    expect(production).toMatch(/gcr\.io\/google\.com\/cloudsdktool\/google-cloud-cli:stable@sha256:[0-9a-f]{64}/u);
    expect(production).not.toContain("cloud-build-postgres-integration.sh");
    expect(production).not.toContain("cloud-builders/docker");
  });

  it("scans the exact staged release image before smoke and publication", () => {
    const workflow = source(".github/workflows/publish-release-image.yml");
    const reportScan = workflow.indexOf("name: Report every high or critical finding in the exact staged image");
    const blockingScan = workflow.indexOf("name: Reject fixable high or critical findings in the exact staged image");
    const smoke = workflow.indexOf("name: Smoke the exact staged image and Compose topology");

    expect(workflow).toMatch(/aquasecurity\/trivy-action@[0-9a-f]{40}/u);
    expect(workflow).toContain("severity: HIGH,CRITICAL");
    expect(reportScan).toBeGreaterThan(0);
    expect(reportScan).toBeLessThan(blockingScan);
    expect(blockingScan).toBeLessThan(smoke);
    expect(workflow.slice(reportScan, blockingScan)).toContain("ignore-unfixed: false");
    expect(workflow.slice(blockingScan, smoke)).toContain("ignore-unfixed: true");
  });

  it("ships an interactive, dev-only Cloud SQL reset with migration and readiness recovery", () => {
    const packageJson = source("package.json");
    const reset = source("scripts/reset-gcloud-dev-database.sh");

    expect(packageJson).toContain('"db:reset:gcloud:dev": "bash scripts/reset-gcloud-dev-database.sh"');
    expect(reset).toContain('readonly REGION="us-central1"');
    expect(reset).toContain('readonly INSTANCE="canvas-seb-dev"');
    expect(reset).toContain('readonly DATABASE="canvas_seb"');
    expect(reset).toContain('readonly MIGRATION_JOB="canvas-seb-dev-migrate"');
    expect(reset).toContain("requires an interactive terminal");
    expect(reset).toContain('confirmation="RESET $PROJECT_ID $REGION $INSTANCE $DATABASE"');
    expect(reset).toContain('gcloud sql databases delete "$DATABASE"');
    expect(reset).toContain('gcloud sql databases create "$DATABASE"');
    expect(reset).toContain('gcloud run jobs execute "$MIGRATION_JOB"');
    expect(reset).toContain('"$service_url/ready"');
    expect(reset).not.toMatch(/canvas-seb-prod|secretmanager|password/iu);
  });

  it("isolates maintained runtime identities and documents resource-scoped IAM", () => {
    const dev = source("cloudbuild-dev.yaml");
    const prod = source("cloudbuild-prod.yaml");
    const deployment = source("docs/deployment.md");
    const configuration = source("docs/configuration.md");
    const binaryAuthorization = source("scripts/configure-binary-authorization.sh");

    expect(dev).toContain("--service-account=seb-canvas-dev@$PROJECT_ID.iam.gserviceaccount.com");
    expect(prod).toContain("_SERVICE_ACCOUNT: seb-canvas-prod");
    expect(prod).toContain("--service-account=${_SERVICE_ACCOUNT}@$PROJECT_ID.iam.gserviceaccount.com");
    expect(dev).not.toContain("--allow-unauthenticated");
    expect(prod).not.toContain("--allow-unauthenticated");
    expect(dev).not.toContain("--service-account=seb-canvas@$PROJECT_ID");
    expect(prod).not.toContain("--service-account=seb-canvas@$PROJECT_ID");
    expect(deployment).toContain("Cloud SQL Client access limited to the configured project");
    expect(deployment).toContain("exact secret resources");
    expect(configuration).toContain("DATABASE_HOST");
    expect(configuration).toContain("DATABASE_PASSWORD_FILE");
    expect(configuration).toContain("SEB_CONFIG_ENCRYPTION_CERT_PEM");
    expect(binaryAuthorization).toContain('"$script_directory/../deploy/binary-authorization-policy.yaml"');
    expect(binaryAuthorization).toContain('gcloud kms keys add-iam-policy-binding "$kms_key"');
    expect(binaryAuthorization).toContain('gcloud container binauthz attestors add-iam-policy-binding "$attestor"');
    expect(binaryAuthorization).not.toMatch(
      /gcloud projects add-iam-policy-binding[^\n]+roles\/(?:cloudkms\.signerVerifier|binaryauthorization\.attestorsViewer)/u
    );
    expect(deployment).toContain("`defaultAdmissionRule` is project-wide");
    expect(deployment).toContain("safe_online_exam_oauth_token_encryption_keyring");
    expect(deployment).not.toContain('--role="roles/artifactregistry.reader"');
    expect(deployment).not.toMatch(
      /gcloud projects add-iam-policy-binding "\$\{PROJECT_ID\}"[\s\S]{0,180}--role="roles\/secretmanager\.secretAccessor"/u
    );
  });

  it("requires explicit non-local encryption keys before rewriting OAuth tokens", () => {
    const rewrite = source("src/server/data/encrypt-oauth-tokens.ts");
    const explicitConfig = rewrite.indexOf("const config = explicitEncryptionConfig();");
    const databaseConstruction = rewrite.indexOf("new PostgresDatabase(config)");

    expect(rewrite).toContain("OAUTH_TOKEN_ENCRYPTION_KEYRING_FILE");
    expect(rewrite).toContain("OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID are required for token rewriting");
    expect(rewrite).toContain("The source-known local OAuth encryption key cannot be used for token rewriting");
    expect(explicitConfig).toBeGreaterThan(0);
    expect(explicitConfig).toBeLessThan(databaseConstruction);
  });

  it("carries the instance certificate-encryption setting through Cloud Run deployments", () => {
    for (const config of [
      source("cloudbuild-dev.yaml"),
      source("cloudbuild-prod.yaml"),
      source("cloudbuild-school.yaml")
    ]) {
      expect(config).toContain('_SEB_CONFIG_ENCRYPTION_ENABLED: "true"');
      expect(config).toContain("SEB_CONFIG_ENCRYPTION_ENABLED=${_SEB_CONFIG_ENCRYPTION_ENABLED}");
    }
  });

  it("pins each dev secret to its independently verified version", () => {
    const dev = source("cloudbuild-dev.yaml");

    expect(dev).not.toMatch(/^\s+_SECRET_VERSION:/mu);
    expect(dev).toContain('_TOOL_URL_SECRET_VERSION: "13"');
    expect(dev).toContain('_LTI_CLIENT_ID_SECRET_VERSION: "3"');
    expect(dev).toContain('_LTI_PRIVATE_KEY_SECRET_VERSION: "3"');
    expect(dev).toContain("dev_tool_url:${_TOOL_URL_SECRET_VERSION}");
    expect(dev).toContain("dev_lti_client_id:${_LTI_CLIENT_ID_SECRET_VERSION}");
    expect(dev).toContain("dev_lti_private_key:${_LTI_PRIVATE_KEY_SECRET_VERSION}");
  });

  it("pins the OAuth token keyring independently in every Cloud Build environment", () => {
    for (const path of ["cloudbuild-dev.yaml", "cloudbuild-prod.yaml", "cloudbuild-school.yaml"]) {
      const config = source(path);
      expect(config, path).toContain('_OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION: "1"');
      expect(
        config.match(/OAUTH_TOKEN_ENCRYPTION_KEYRING=[^,\n]+:\$\{_OAUTH_TOKEN_ENCRYPTION_KEYRING_SECRET_VERSION\}/gu),
        path
      ).toHaveLength(3);
      expect(config, path).not.toMatch(/OAUTH_TOKEN_ENCRYPTION_KEYRING=[^,\n]+:\$\{_SECRET_VERSION\}/u);
    }
  });

  it("documents portable PostgreSQL deployment and recovery operations", () => {
    const readme = source("README.md");
    const architecture = source("docs/architecture.md");
    const configuration = source("docs/configuration.md");
    const deployment = source("docs/deployment.md");
    const testing = source("docs/testing.md");
    const primaryDocs = [readme, architecture, configuration, deployment, testing, source("AGENTS.md")].join("\n");

    expect(readme).toContain("PostgreSQL 17");
    expect(readme).toContain("Google Cloud Run with Cloud SQL is the recommended managed deployment");
    expect(readme).toContain("Docker Compose");
    expect(architecture).toContain("PostgreSQL transactions and row locks");
    expect(architecture).toContain("FOR UPDATE SKIP LOCKED");
    expect(configuration).toContain("DATABASE_SSL_MODE");
    expect(configuration).toContain("File-Based Secrets");
    expect(configuration).toContain("Secret Rotation");
    expect(deployment).toContain("chmod 600 .env");
    expect(deployment).toContain("TLS Reverse Proxy");
    expect(deployment).toContain("Budget VM Alternative");
    expect(deployment).toContain("Pool Sizing");
    expect(deployment).toContain("pg_dump");
    expect(deployment).toContain("restore drill");
    expect(deployment).toContain("Schema And Application Rollback");
    expect(deployment).toContain("Google Cloud Run With Cloud SQL");
    expect(deployment).toContain("Release Smoke Checks");
    expect(testing).toContain("npm run verify:postgres");
    expect(testing).toContain("scripts/compose-smoke.sh");
    expect(primaryDocs).not.toContain(["Fire", "store"].join(""));
    expect(primaryDocs).not.toContain(["FIRE", "STORE"].join(""));
    expect(primaryDocs).not.toContain("GCP_PROJECT_ID");
  });

  it("does not accept certificate identities or passwords through the retired installer", () => {
    const installerPath = join(ROOT, "scripts/install-seb-config-cert-login-keychain.sh");
    const installer = readFileSync(installerPath, "utf8");
    const generator = source("scripts/generate-seb-config-cert.sh");

    expect(statSync(installerPath).mode & 0o111).toBe(0);
    expect(installer).toContain("secret-bearing installer has been retired");
    expect(installer).not.toMatch(/security\s+import|P12_BASE64|P12_PASSWORD|LOGIN_KEYCHAIN_PASSWORD|\$\{?[456]\}?/u);
    expect(generator).toContain('P12_PASSWORD_FILE="${SEB_CERT_P12_PASSWORD_FILE:-${2:-}}"');
    expect(generator).toContain('-passout "file:$P12_PASSWORD_FILE"');
    expect(generator).not.toMatch(/SEB_CERT_P12_PASSWORD(?:=|:-)|-passout\s+"pass:/u);
  });

  it("uses a root-only package fallback that imports through the console user's security session", () => {
    const installer = source("scripts/install-seb-config-identity-login-keychain.sh");
    const builder = source("scripts/build-jamf-seb-identity-package.sh");
    const inlineGenerator = source("scripts/generate-jamf-seb-identity-inline-script.mjs");
    const genericInstallerPath = join(ROOT, "scripts/install-seb-config-identity-user-keychain.sh");
    const genericInstaller = readFileSync(genericInstallerPath, "utf8");

    expect(installer).toContain("-x");
    expect(installer).toContain('-T "$SEB_BINARY"');
    expect(installer).toContain('-passin "file:$P12_PASSWORD_PATH"');
    expect(installer).toContain("run_as_console_user()");
    expect(installer).toContain('/bin/launchctl asuser "$USER_UID" /usr/bin/sudo -u "$CONSOLE_USER" "$@"');
    expect(installer).toContain("security import /dev/stdin");
    expect(installer).toContain("/usr/bin/sed -n 's/^Identifier=//p'");
    expect(installer).not.toContain("ACTUAL_CERT_SHA256^^");
    expect(installer).not.toContain('security import "$P12_PATH"');
    expect(installer).not.toContain('chown -R "$CONSOLE_USER"');
    expect(installer).not.toMatch(/security import \/dev\/stdin[\s\S]{0,300}\s-P(?:\s|$)/u);
    expect(installer).not.toMatch(/security import \/dev\/stdin[\s\S]{0,300}\s-A(?:\s|$)/u);
    expect(inlineGenerator).toContain("security import /dev/stdin");
    expect(inlineGenerator).toContain('/bin/launchctl asuser "$USER_UID" /usr/bin/sudo -u "$CONSOLE_USER" "$@"');
    expect(inlineGenerator).toContain("/usr/bin/sed -n 's/^Identifier=//p'");
    expect(inlineGenerator).not.toContain("ACTUAL_CERT_SHA256^^");
    expect(inlineGenerator).not.toContain('security import "$P12_PATH"');
    expect(inlineGenerator).not.toMatch(/security import[\s\S]{0,300}\s-P(?:\s|$)/u);
    expect(genericInstaller).toContain("--p12");
    expect(genericInstaller).toContain("--password-file");
    expect(genericInstaller).toContain("--fingerprint");
    expect(genericInstaller).toContain("run_as_console_user()");
    expect(genericInstaller).toContain("security import /dev/stdin");
    expect(genericInstaller).toContain("Required file is not owned by root:wheel");
    expect(genericInstaller).not.toContain("P12_BASE64");
    expect(genericInstaller).not.toMatch(/security import[\s\S]{0,300}\s-P(?:\s|$)/u);
    expect(statSync(genericInstallerPath).mode & 0o111).not.toBe(0);
    expect(builder).not.toMatch(/\$\{?[456]\}?|P12_BASE64|LOGIN_KEYCHAIN_PASSWORD/u);
    expect(builder).toContain("SCRIPT_DIRECTORY");
    expect(builder).not.toContain("git rev-parse");
    const composeBundle = source("scripts/create-release-bundle.sh");
    const cloudRunBundle = source("scripts/create-cloud-run-bundle.sh");
    for (const helper of [
      "install-seb-config-identity-user-keychain.sh",
      "install-seb-config-identity-login-keychain.sh",
      "build-jamf-seb-identity-package.sh",
      "generate-jamf-seb-identity-inline-script.mjs",
      "org.safeonlineexam.seb-identity-installer.plist"
    ]) {
      expect(composeBundle, helper).toContain(helper);
      expect(cloudRunBundle, helper).toContain(helper);
    }
  });
});

function sourceTree(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceTree(path);
    }
    return entry.isFile() ? [source(path)] : [];
  });
}
