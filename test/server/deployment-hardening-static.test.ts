import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("deployment hardening artifacts", () => {
  it("keeps local private-key artifacts out of version control and build contexts", () => {
    const requiredPatterns = [".local/", "*.p12", "*.pfx", "*.key", "*.key.pem", "*.private.pem"];

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
    }
  });

  it("isolates maintained runtime identities and documents resource-scoped IAM", () => {
    const dev = source("cloudbuild-dev.yaml");
    const prod = source("cloudbuild-prod.yaml");
    const deployment = source("docs/deployment.md");
    const school = source("docs/school-deployment.md");

    expect(dev).toContain("--service-account=seb-canvas-dev@$PROJECT_ID.iam.gserviceaccount.com");
    expect(prod).toContain("--service-account=seb-canvas-prod@$PROJECT_ID.iam.gserviceaccount.com");
    expect(dev).toContain('      - "--allow-unauthenticated"');
    expect(prod).toContain('      - "--allow-unauthenticated"');
    expect(dev).not.toContain("--service-account=seb-canvas@$PROJECT_ID");
    expect(prod).not.toContain("--service-account=seb-canvas@$PROJECT_ID");
    expect(deployment).toContain("Firestore access conditioned on its configured database resource");
    expect(deployment).toContain("exact secret resources");
    expect(school).toContain("resource.name == 'projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}'");
    expect(school).toContain('gcloud secrets add-iam-policy-binding "${SECRET_NAME}"');
    expect(school).not.toContain('--role="roles/artifactregistry.reader"');
    expect(school).not.toMatch(
      /gcloud projects add-iam-policy-binding "\$\{PROJECT_ID\}"[\s\S]{0,180}--role="roles\/secretmanager\.secretAccessor"/u
    );
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
