import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};

describe("release consistency script", () => {
  it("accepts an unreleased development version while stable examples remain published", () => {
    const output = execFileSync(process.execPath, ["scripts/verify-release.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(output).toContain(`release consistency check passed for v${packageJson.version}`);
  });

  it("rejects tag mode until the intended release has a date and synchronized install examples", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-release.mjs", "--tag", `v${packageJson.version}`], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`README.md quick-start version must be ${packageJson.version}`);
  });

  it("rejects a tag that does not match the package version", () => {
    const result = spawnSync(process.execPath, ["scripts/verify-release.mjs", "--tag", "v99.99.99"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not match package version");
  });
});
