import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("school Canvas commit testbed deployment", () => {
  it("is locked to the development project and cannot address production targets", () => {
    const config = source("cloudbuild-testbed.yaml");
    const scripts = [
      "scripts/validate-school-testbed-target.sh",
      "scripts/deploy-school-testbed-runtime.sh",
      "scripts/deploy-gcloud-school-testbed.sh",
      "scripts/rollback-gcloud-school-testbed.sh",
      "scripts/reset-gcloud-school-testbed-database.sh"
    ].map(source);

    for (const artifact of [config, ...scripts]) {
      expect(artifact).not.toContain("canvas-seb-prod");
      expect(artifact).not.toContain("cloudbuild-prod.yaml");
    }
    expect(scripts.every((artifact) => artifact.includes("seb-for-canvas"))).toBe(true);
    expect(scripts.every((artifact) => artifact.includes("school-canvas-seb"))).toBe(true);
    expect(config).toContain('args: ["$PROJECT_ID"]');
    expect(config).not.toContain("_SERVICE:");
  });

  it("uses dev-only diagnostics and a no-traffic candidate before explicit cutover", () => {
    const deploy = source("scripts/deploy-school-testbed-runtime.sh");

    expect(deploy).toContain("APP_ENV=dev");
    expect(deploy).toContain("DEV_TESTBED_ENABLED=true");
    expect(deploy).toContain("APP_DEBUG_ENABLED=true");
    expect(deploy).toContain("APP_DETECTOR_DIAGNOSTICS_ENABLED=true");
    expect(deploy).toContain("--no-traffic");
    expect(deploy).toContain('--tag="$CANDIDATE_TAG"');
    expect(deploy.indexOf('verify_url "$candidate_url"')).toBeLessThan(
      deploy.indexOf("gcloud run services update-traffic")
    );
    expect(deploy).toContain("rollback_on_error");
    expect(deploy).toContain("https://seb.jacobbarkin.com");
    expect(deploy).toContain("/workspace/scripts/probe-school-testbed.py");
    expect(deploy).toContain("/usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3.14");
    expect(deploy).not.toContain("curl ");
  });

  it("keeps every testbed operator script executable", () => {
    for (const path of [
      "scripts/validate-school-testbed-target.sh",
      "scripts/create-school-testbed-backup.sh",
      "scripts/deploy-school-testbed-runtime.sh",
      "scripts/deploy-gcloud-school-testbed.sh",
      "scripts/rollback-gcloud-school-testbed.sh",
      "scripts/reset-gcloud-school-testbed-database.sh"
    ]) {
      expect(statSync(resolve(process.cwd(), path)).mode & 0o111, path).not.toBe(0);
    }
  });
});
