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
