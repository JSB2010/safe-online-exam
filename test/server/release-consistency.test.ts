import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  version: string;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release consistency script", () => {
  it("accepts the synchronized repository version and emits canonical notes", () => {
    const directory = mkdtempSync(join(tmpdir(), "safe-online-exam-release-check-"));
    temporaryDirectories.push(directory);
    const notes = join(directory, "notes.md");

    const output = execFileSync(
      process.execPath,
      ["scripts/verify-release.mjs", "--tag", `v${packageJson.version}`, "--notes-output", notes],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(output).toContain(`release consistency check passed for v${packageJson.version}`);
    expect(readFileSync(notes, "utf8")).toContain(`v${packageJson.version} changelog`);
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
