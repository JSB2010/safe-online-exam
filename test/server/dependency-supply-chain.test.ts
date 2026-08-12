import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const verifier = join(repositoryRoot, "scripts/verify-install-scripts.mjs");
const canonicalPackage = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const canonicalLockfile = JSON.parse(readFileSync(join(repositoryRoot, "package-lock.json"), "utf8"));
const canonicalNpmrc = readFileSync(join(repositoryRoot, ".npmrc"), "utf8");
const temporaryDirectories: string[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function verify(
  packageJson = canonicalPackage,
  lockfile = canonicalLockfile,
  npmrc = canonicalNpmrc,
  additionalArguments: string[] = []
) {
  const directory = mkdtempSync(join(tmpdir(), "seb-dependency-policy-"));
  temporaryDirectories.push(directory);
  const packagePath = join(directory, "package.json");
  const lockfilePath = join(directory, "package-lock.json");
  const npmrcPath = join(directory, ".npmrc");
  writeFileSync(packagePath, `${JSON.stringify(packageJson)}\n`);
  writeFileSync(lockfilePath, `${JSON.stringify(lockfile)}\n`);
  writeFileSync(npmrcPath, npmrc);
  return spawnSync(
    process.execPath,
    [
      verifier,
      "--package",
      packagePath,
      "--lockfile",
      lockfilePath,
      "--npmrc",
      npmrcPath,
      "--skip-release-age",
      ...additionalArguments
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8"
    }
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("dependency supply-chain policy", () => {
  it("accepts the reviewed registry-only lockfile and exact script policy", () => {
    const result = verify();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("sha512 integrity metadata");
    expect(result.stdout).toContain("release-age lookup skipped for the post-install offline recheck");
  });

  it("rejects unknown npm configuration instead of silently accepting a typo", () => {
    const result = verify(canonicalPackage, canonicalLockfile, `${canonicalNpmrc}ignore-script=true\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown .npmrc setting: ignore-script");
  });

  it("rejects a missing required npm configuration control", () => {
    const npmrc = canonicalNpmrc.replace("ignore-scripts=true\n", "");
    const result = verify(canonicalPackage, canonicalLockfile, npmrc);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required .npmrc setting: ignore-scripts=true");
  });

  it.each(["--package=./package.json", "--min-release-age-days=7", "--skip-release-age=true"])(
    "rejects the ambiguous equals form for policy option %s",
    (argument) => {
      const result = verify(canonicalPackage, canonicalLockfile, canonicalNpmrc, [argument]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("must be passed as");
    }
  );

  it("rejects a newly introduced lifecycle script", () => {
    const lockfile = clone(canonicalLockfile);
    lockfile.packages["node_modules/unreviewed-installer"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/unreviewed-installer/-/unreviewed-installer-1.0.0.tgz",
      integrity: "sha512-QUFBQQ==",
      hasInstallScript: true
    };
    const result = verify(canonicalPackage, lockfile);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unapproved dependency lifecycle script");
  });

  it("rejects non-registry dependency sources", () => {
    const lockfile = clone(canonicalLockfile);
    lockfile.packages["node_modules/clsx"].resolved = "https://packages.example.invalid/clsx.tgz";
    const result = verify(canonicalPackage, lockfile);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Dependency must resolve from https://registry.npmjs.org");
  });

  it("rejects missing integrity metadata", () => {
    const lockfile = clone(canonicalLockfile);
    delete lockfile.packages["node_modules/clsx"].integrity;
    const result = verify(canonicalPackage, lockfile);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Dependency must have sha512 integrity metadata");
  });

  it("rejects changed bytes for the approved esbuild lifecycle package", () => {
    const lockfile = clone(canonicalLockfile);
    lockfile.packages["node_modules/esbuild"].integrity = "sha512-QUFBQQ==";
    const result = verify(canonicalPackage, lockfile);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Approved lifecycle dependency node_modules/esbuild changed integrity");
  });

  it("rejects floating direct dependency ranges", () => {
    const packageJson = clone(canonicalPackage);
    packageJson.dependencies.clsx = "^2.1.1";
    const result = verify(packageJson, canonicalLockfile);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dependencies.clsx must use an exact registry version");
  });

  it("rejects floating dependency override ranges", () => {
    const packageJson = clone(canonicalPackage);
    packageJson.overrides.multer = "^2.2.0";
    const result = verify(packageJson, canonicalLockfile);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("overrides.multer must use an exact registry version");
  });

  it("verifies policy before executing the sole trusted rebuild", () => {
    expect(canonicalPackage.scripts["install:trusted"]).toBe(
      "npm run verify:dependency-policy:offline && npm rebuild esbuild --ignore-scripts=false && node scripts/verify-esbuild.mjs"
    );
    expect(canonicalPackage.allowScripts).toEqual({
      "esbuild@0.28.1": true,
      fsevents: false
    });
  });
});
