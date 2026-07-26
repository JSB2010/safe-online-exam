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
    expect(compose).toContain("postgres:17-alpine");
    expect(compose).toContain("postgres_data:");
    expect(compose).toContain("${BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-8080}:8080");
    expect(compose).toContain("pg_isready");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("/ready");
    const postgresService = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  migrate:"));
    expect(postgresService).not.toContain("ports:");
    expect(dockerfile).toContain("FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS base");
    expect(dockerfile).toContain("FROM node:24-bookworm-slim AS production-deps");
    expect(dockerfile).toContain("npm ci --omit=dev");
    expect(dockerfile).toContain("COPY --from=base /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("distroless/nodejs24-debian13:nonroot");
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
    expect(override).toContain("secrets: *app-secrets");
    expect(override).not.toContain(":/run/secrets:ro");
    expect(example).not.toMatch(
      /^(DATABASE_PASSWORD|LTI_PRIVATE_KEY|CANVAS_API_CLIENT_SECRET|SESSION_SECRET|STATE_ENCRYPTION_KEY)=/mu
    );
  });

  it("ships an optional Caddy profile without exposing the application or database by default", () => {
    const caddy = source("compose.caddy.yaml");
    const caddyfile = source("Caddyfile");

    expect(caddy).toContain('profiles: ["caddy"]');
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
    expect(bundle).toContain("bootstrap-secrets.sh");
    expect(bundle).toContain("IMAGE_DIGEST");
    expect(bootstrap).toContain("safe-online-exam@sha256");
    expect(bootstrap).toContain("generate-lti-private-key.mjs");
    expect(bootstrap).toContain("seb-client-identity");
    expect(bootstrap).not.toContain("CANVAS_API_CLIENT_SECRET=");
    expect(bundleReadme).toContain("does not contain application source code");
    expect(dockerfile).toContain("scripts/generate-lti-private-key.mjs");
    expect(source("scripts/compose-smoke.sh")).toContain("compose.caddy.yaml --profile caddy config --quiet");
    expect(source("scripts/compose-smoke.sh")).toContain('docker run --rm --entrypoint /nodejs/bin/node "$image"');
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

    for (const path of ["cloudbuild-dev.yaml", "cloudbuild-prod.yaml", "cloudbuild-school.yaml"]) {
      const config = source(path);
      expect(config, path).toContain('entrypoint: "/workspace/scripts/push-image-capture-digest.sh"');
      expect(config, path).toContain('entrypoint: "/workspace/scripts/deploy-cloud-run-digest.sh"');
      expect(config, path).toContain(":$BUILD_ID");
      expect(config, path).toMatch(/\/workspace\/canvas-seb-[a-z]+\.digest/u);
      expect(config, path).toContain("LTI_DEPLOYMENT_ID=");
      expect(config, path).toContain("APP_DEBUG_ENABLED=false");
      expect(config, path).toContain('      - "service"');
    }
  });

  it("can manually promote only a released Safe Online Exam GHCR digest", () => {
    const helper = source("scripts/deploy-cloud-run-digest.sh");
    const writer = source("scripts/write-image-digest.sh");
    const promotion = source("cloudbuild-release-promote.yaml");

    expect(helper).toContain('"ghcr.io/jsb2010/safe-online-exam"');
    expect(writer).toContain("invalid image digest");
    expect(writer).toContain("output must be a direct child of /workspace");
    expect(promotion).toContain("_IMAGE_REPOSITORY: ghcr.io/jsb2010/safe-online-exam");
    expect(promotion).toContain("_IMAGE_DIGEST: sha256:REPLACE_WITH_RELEASE_DIGEST");
    expect(promotion).toContain('entrypoint: "/workspace/scripts/write-image-digest.sh"');
    expect(promotion.match(/entrypoint: "\/workspace\/scripts\/deploy-cloud-run-digest\.sh"/gu)).toHaveLength(3);
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
    expect(workflow).toContain('jq -e ".enabled == true"');
    expect(workflow).toContain("wait-for-required-checks.sh");
    expect(requiredChecks).toContain("Application verification");
    expect(requiredChecks).toContain("PostgreSQL integration");
    expect(requiredChecks).toContain("Production Compose smoke");
    expect(requiredChecks).toContain("Analyze (javascript-typescript)");
    expect(requiredChecks).toContain("Analyze (actions)");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--verify-tag --draft");
    expect(workflow).toContain("bash scripts/compose-smoke.sh");
    expect(workflow).toContain('COMPOSE_SMOKE_SKIP_BUILD: "true"');
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6");
    expect(workflow).toContain("org.opencontainers.image.licenses=PolyForm-Noncommercial-1.0.0");
    expect(workflow).toContain("type=raw,value=latest");
    expect(workflow).not.toContain("scope: ${{ env.IMAGE_NAME }}@push");
    expect(workflow).toContain("cache-to: type=registry");
    expect(workflow).toContain("create-release-bundle.sh");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("docker buildx imagetools create");
    expect(workflow).toContain("gh attestation verify");
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
      expect.arrayContaining(["deletion", "non_fast_forward", "pull_request", "required_status_checks"])
    );
    expect(contexts).toEqual(
      expect.arrayContaining([
        "Application verification",
        "PostgreSQL integration",
        "Production Compose smoke",
        "Analyze (javascript-typescript)",
        "Analyze (actions)"
      ])
    );
    expect(setup).toContain("sha_pinning_required: true");
    expect(setup).toContain("immutable-releases");
  });

  it("tracks GitHub Actions and Docker base-image updates through Dependabot", () => {
    const dependabot = source(".github/dependabot.yml");

    expect(dependabot).toContain("package-ecosystem: github-actions");
    expect(dependabot).toContain("package-ecosystem: docker");
    expect(dependabot.match(/interval: weekly/gu)).toHaveLength(2);
    expect(dependabot).toContain("pinned-actions:");
    expect(dependabot).toContain("container-images:");
    expect(dependabot).toContain("dependency-name: node");
    expect(dependabot).toContain("version-update:semver-major");
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
    const dockerfile = source("Dockerfile");
    expect(dockerfile).toContain("FROM deps AS postgres-tests");
    expect(dockerfile.indexOf("FROM deps AS postgres-tests")).toBeLessThan(dockerfile.indexOf("FROM deps AS verify"));
    expect(dockerfile).toContain('CMD ["npm", "run", "test:postgres"]');

    for (const path of ["cloudbuild-dev.yaml", "cloudbuild-prod.yaml", "cloudbuild-school.yaml"]) {
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
      expect(config, path).toContain("gcr.io/google.com/cloudsdktool/google-cloud-cli:stable");
      expect(config, path).not.toContain(":latest");
      expect(config, path).not.toContain(["FIRE", "STORE"].join(""));
    }
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

    expect(dev).toContain("--service-account=seb-canvas-dev@$PROJECT_ID.iam.gserviceaccount.com");
    expect(prod).toContain("--service-account=seb-canvas-prod@$PROJECT_ID.iam.gserviceaccount.com");
    expect(dev).not.toContain("--allow-unauthenticated");
    expect(prod).not.toContain("--allow-unauthenticated");
    expect(dev).not.toContain("--service-account=seb-canvas@$PROJECT_ID");
    expect(prod).not.toContain("--service-account=seb-canvas@$PROJECT_ID");
    expect(deployment).toContain("Cloud SQL Client access limited to the configured project");
    expect(deployment).toContain("exact secret resources");
    expect(configuration).toContain("DATABASE_HOST");
    expect(configuration).toContain("DATABASE_PASSWORD_FILE");
    expect(configuration).toContain("SEB_CONFIG_ENCRYPTION_CERT_PEM");
    expect(deployment).not.toContain('--role="roles/artifactregistry.reader"');
    expect(deployment).not.toMatch(
      /gcloud projects add-iam-policy-binding "\$\{PROJECT_ID\}"[\s\S]{0,180}--role="roles\/secretmanager\.secretAccessor"/u
    );
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
