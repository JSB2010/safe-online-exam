import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body, { mode: 0o755 });
}

function supplyChainFixture(
  outdated: Record<string, unknown> = {},
  imageDigest = DIGEST_A,
  npmEligible: Record<string, string> = {}
): string {
  const directory = temporaryDirectory("safe-online-exam-supply-chain-");
  mkdirSync(join(directory, ".github", "workflows"), { recursive: true });
  mkdirSync(join(directory, "scripts"));
  writeFileSync(
    join(directory, "Dockerfile"),
    [`# syntax=docker/dockerfile:1@${DIGEST_A}`, `FROM node:24-bookworm-slim@${DIGEST_A} AS base`, ""].join("\n")
  );
  writeFileSync(
    join(directory, "cloudbuild-test.yaml"),
    `steps:\n  - name: "gcr.io/cloud-builders/docker@${DIGEST_A}"\n`
  );
  writeFileSync(
    join(directory, "package.json"),
    '{"packageManager":"npm@11.20.0+sha512.745dc40c5c1b60df8de51522a7e6580ded0d79444ae4182a28e72f4f588db546214cc4e5d05c16841b97ad2ecab57c9dbaac93312e5a6906ab7a09c70c0c4d83"}\n'
  );
  writeFileSync(join(directory, ".github", "workflows", "publish-release-image.yml"), "with:\n  version: v0.73.0\n");
  writeFileSync(join(directory, "scripts", "verify-github-release-attestation.sh"), 'GH_CLI_VERSION="2.102.0"\n');
  writeFileSync(
    join(directory, "fixtures.json"),
    JSON.stringify({
      images: {
        "docker/dockerfile:1": imageDigest,
        "node:24-bookworm-slim": imageDigest,
        "gcr.io/cloud-builders/docker:latest": imageDigest
      },
      tools: { npm: "11.20.0", trivy: "v0.73.0", githubCli: "v2.102.0" },
      npmEligible,
      outdated
    })
  );
  return directory;
}

interface MaintenanceIssueCall {
  args: string[];
  body: string;
}

function maintainSupplyChainIssue(
  monitorStatus: string,
  auditResult: string,
  imageScanResult: string,
  findingsResult: string,
  options: { reportAvailable?: boolean; issueNumber?: string } = {}
) {
  const directory = temporaryDirectory("safe-online-exam-maintenance-issue-");
  const fakeBin = join(directory, "bin");
  const log = join(directory, "gh.log");
  mkdirSync(fakeBin);
  if (options.reportAvailable !== false) {
    writeFileSync(join(directory, "supply-chain-report.md"), "# Weekly supply-chain maintenance\n\nPin report.\n");
  }
  writeExecutable(
    join(fakeBin, "gh"),
    `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] !== "issue" || !["list", "edit", "create", "comment", "close"].includes(args[1])) process.exit(99);
const bodyIndex = args.indexOf("--body-file");
const body = bodyIndex < 0 ? "" : readFileSync(args[bodyIndex + 1], "utf8");
appendFileSync(process.env.GH_TEST_LOG, JSON.stringify({ args, body }) + "\\n");
if (args[1] === "list") process.stdout.write(process.env.GH_TEST_ISSUE_NUMBER + "\\n");
`
  );
  const workflow = readFileSync(join(ROOT, ".github/workflows/supply-chain-maintenance.yml"), "utf8");
  const issueJob = workflow.slice(workflow.indexOf("  maintenance-issue:"));
  const runBlock = issueJob.match(/ {8}run: \|\n([\s\S]+)$/u)?.[1];
  if (!runBlock) throw new Error("Maintenance issue command is missing.");
  const script = runBlock.replace(/^ {10}/gmu, "");
  const result = spawnSync("bash", ["-c", script], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      GH_TOKEN: "test-only-token",
      GH_TEST_LOG: log,
      GH_TEST_ISSUE_NUMBER: options.issueNumber ?? "123",
      MONITOR_STATUS: monitorStatus,
      AUDIT_RESULT: auditResult,
      IMAGE_SCAN_RESULT: imageScanResult,
      IMAGE_SCAN_FINDINGS_RESULT: findingsResult,
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "JSB2010/safe-online-exam",
      GITHUB_RUN_ID: "42"
    }
  });
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as MaintenanceIssueCall);
  return { result, calls };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("weekly supply-chain maintenance", () => {
  it("reports clean pins and treats major migrations as informational", () => {
    const directory = supplyChainFixture({ typescript: { current: "5.9.3", latest: "6.0.0" } });
    const report = join(directory, "report.md");

    execFileSync(
      process.execPath,
      [
        "scripts/check-supply-chain-pins.mjs",
        "--root",
        directory,
        "--report",
        report,
        "--fixtures",
        join(directory, "fixtures.json")
      ],
      { cwd: ROOT }
    );

    const contents = readFileSync(report, "utf8");
    expect(contents).toContain("No actionable dependency or immutable-pin drift was detected.");
    expect(contents).toContain("Major migrations (informational)");
  });

  it("returns a distinct drift status for stale pins and same-major npm updates", () => {
    const directory = supplyChainFixture(
      {
        vite: { current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" },
        typescript: { current: "5.9.3", wanted: "5.9.3", latest: "6.0.0" }
      },
      DIGEST_B
    );
    const report = join(directory, "report.md");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-supply-chain-pins.mjs",
        "--root",
        directory,
        "--report",
        report,
        "--fixtures",
        join(directory, "fixtures.json")
      ],
      { cwd: ROOT, encoding: "utf8" }
    );

    expect(result.status).toBe(2);
    expect(readFileSync(report, "utf8")).toContain("Actionable drift");
    expect(readFileSync(report, "utf8")).toContain("npm vite");
    expect(readFileSync(report, "utf8")).toContain("Major migrations (informational)");
  });

  it("uses the wanted version when npm outdated runs before dependencies are installed", () => {
    const directory = supplyChainFixture({ vite: { wanted: "8.0.0", latest: "8.1.0" } });
    const report = join(directory, "report.md");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-supply-chain-pins.mjs",
        "--root",
        directory,
        "--report",
        report,
        "--fixtures",
        join(directory, "fixtures.json")
      ],
      { cwd: ROOT, encoding: "utf8" }
    );

    expect(result.status).toBe(2);
    expect(readFileSync(report, "utf8")).toContain("npm vite");
  });

  it("reports newly published npm updates without treating them as actionable drift", () => {
    const directory = supplyChainFixture({ vite: { current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" } }, DIGEST_A, {
      vite: "8.0.0"
    });
    const report = join(directory, "report.md");

    execFileSync(
      process.execPath,
      [
        "scripts/check-supply-chain-pins.mjs",
        "--root",
        directory,
        "--report",
        report,
        "--fixtures",
        join(directory, "fixtures.json")
      ],
      { cwd: ROOT }
    );

    const contents = readFileSync(report, "utf8");
    expect(contents).toContain("Cooldown-deferred npm updates (informational)");
    expect(contents).not.toContain("## Actionable drift");
  });

  it("renders a monitor error instead of crashing on incomplete npm outdated data", () => {
    const directory = supplyChainFixture({ vite: { latest: "8.1.0" } });
    const report = join(directory, "report.md");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-supply-chain-pins.mjs",
        "--root",
        directory,
        "--report",
        report,
        "--fixtures",
        join(directory, "fixtures.json")
      ],
      { cwd: ROOT, encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(readFileSync(report, "utf8")).toContain("incomplete or invalid version data for vite");
  });

  it("verifies the immutable GitHub release attestation with a checksum-pinned CLI", () => {
    const directory = temporaryDirectory("safe-online-exam-gh-attestation-");
    const fakeBin = join(directory, "bin");
    const log = join(directory, "gh.log");
    mkdirSync(fakeBin);
    writeExecutable(
      join(fakeBin, "curl"),
      '#!/usr/bin/env bash\nwhile [[ $# -gt 0 ]]; do if [[ "$1" == "--output" ]]; then : >"$2"; exit 0; fi; shift; done\nexit 1\n'
    );
    writeExecutable(join(fakeBin, "sha256sum"), "#!/usr/bin/env bash\ncat >/dev/null\nexit 0\n");
    writeExecutable(
      join(fakeBin, "tar"),
      `#!/usr/bin/env bash
set -eu
destination=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-C" ]]; then destination="$2"; break; fi
  shift
done
mkdir -p "$destination/gh_2.102.0_linux_amd64/bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >>"$GH_TEST_LOG"' \
  'if [[ "\${1:-}" == "api" ]]; then printf "%b\\n" "$GH_TEST_RELEASE_STATE"; fi' \
  >"$destination/gh_2.102.0_linux_amd64/bin/gh"
chmod +x "$destination/gh_2.102.0_linux_amd64/bin/gh"
`
    );

    const image = `ghcr.io/jsb2010/safe-online-exam@sha256:${"c".repeat(64)}`;
    const sourceDigest = "d".repeat(40);
    execFileSync(
      "bash",
      [
        "scripts/verify-github-release-attestation.sh",
        image,
        "JSB2010/safe-online-exam",
        "JSB2010/safe-online-exam/.github/workflows/publish-release-image.yml",
        sourceDigest,
        "v1.2.3"
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          GH_TOKEN: "test-only-token",
          GH_TEST_LOG: log,
          GH_TEST_RELEASE_STATE: "v1.2.3\tfalse\tfalse\ttrue\t2026-08-06T12:00:00Z"
        }
      }
    );

    const invocation = readFileSync(log, "utf8");
    expect(invocation).toContain("api --method GET repos/JSB2010/safe-online-exam/releases/tags/v1.2.3");
    expect(invocation).toContain(`attestation verify oci://${image}`);
    expect(invocation).toContain(
      "--signer-workflow JSB2010/safe-online-exam/.github/workflows/publish-release-image.yml"
    );
    expect(invocation).toContain(`--source-digest ${sourceDigest}`);
    expect(invocation).toContain("--source-ref refs/tags/v1.2.3");

    const draftResult = spawnSync(
      "bash",
      [
        "scripts/verify-github-release-attestation.sh",
        image,
        "JSB2010/safe-online-exam",
        "JSB2010/safe-online-exam/.github/workflows/publish-release-image.yml",
        sourceDigest,
        "v1.2.3"
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          GH_TOKEN: "test-only-token",
          GH_TEST_LOG: log,
          GH_TEST_RELEASE_STATE: "v1.2.3\ttrue\tfalse\tfalse\t"
        }
      }
    );
    expect(draftResult.status).toBe(1);
    expect(draftResult.stderr).toContain("must be published, stable, and immutable");
  });

  it("stages OAuth encryption enforcement through compatibility mode for existing Cloud Run services", () => {
    const directory = temporaryDirectory("safe-online-exam-oauth-rollout-");
    const fakeBin = join(directory, "bin");
    mkdirSync(fakeBin);
    writeExecutable(
      join(fakeBin, "gcloud"),
      `#!/usr/bin/env bash
if [[ "$*" == *"services list"* ]]; then
  printf '%s\n' "$GCLOUD_EXISTING_SERVICE"
  exit 0
fi
if [[ "$*" == *"services describe"* ]]; then
  printf '%s\t%s\n' "$GCLOUD_SERVING_REVISION" "$GCLOUD_SERVING_PERCENT"
  exit 0
fi
if [[ "$*" == *"revisions describe"* ]]; then
  printf 'OAUTH_TOKEN_ENCRYPTION_MODE\t%s\n' "$GCLOUD_CURRENT_MODE"
  exit 0
fi
exit 99
`
    );

    const args = [
      "scripts/validate-oauth-encryption-rollout.sh",
      "sample-project",
      "canvas-seb-prod",
      "us-central1",
      "enforce"
    ];
    const baseEnvironment = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      GCLOUD_EXISTING_SERVICE: "canvas-seb-prod",
      GCLOUD_SERVING_PERCENT: "100"
    };
    const unstaged = spawnSync("bash", args, {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...baseEnvironment,
        GCLOUD_SERVING_REVISION: "revision-old",
        GCLOUD_CURRENT_MODE: ""
      }
    });
    expect(unstaged.status).toBe(1);
    expect(unstaged.stderr).toContain("has not completed a compat-mode deployment");

    const staged = spawnSync("bash", args, {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...baseEnvironment,
        GCLOUD_SERVING_REVISION: "revision-compat",
        GCLOUD_CURRENT_MODE: "compat"
      }
    });
    expect(staged.status).toBe(0);
    expect(staged.stderr).toContain("enforce deployment is rollback-staged");

    const fresh = spawnSync("bash", args, {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...baseEnvironment,
        GCLOUD_EXISTING_SERVICE: "",
        GCLOUD_SERVING_REVISION: "",
        GCLOUD_CURRENT_MODE: ""
      }
    });
    expect(fresh.status).toBe(0);
    expect(fresh.stderr).toContain("fresh installation may start in enforce mode");
  });

  it("rejects enforce for a first Compose upgrade before backup or mutation", () => {
    const directory = temporaryDirectory("safe-online-exam-compose-rollout-");
    const fakeBin = join(directory, "bin");
    const environmentFile = join(directory, ".env.secrets");
    mkdirSync(fakeBin);
    writeExecutable(join(fakeBin, "curl"), "#!/usr/bin/env bash\nexit 99\n");
    writeExecutable(
      join(fakeBin, "docker"),
      `#!/usr/bin/env bash
if [[ "$1" == "ps" ]]; then
  printf '%s\n' 'old-app-container'
  exit 0
fi
if [[ "$1" == "inspect" && "$*" == *com.docker.compose.project* ]]; then
  printf '%s\n' 'legacy-compose-project'
  exit 0
fi
if [[ "$1" == "inspect" ]]; then
  printf '%s\n' 'NODE_ENV=production' 'TOOL_URL=https://legacy.school.edu'
  exit 0
fi
exit 99
`
    );
    writeFileSync(
      environmentFile,
      [
        `APP_IMAGE=ghcr.io/jsb2010/safe-online-exam@${DIGEST_A}`,
        "TOOL_URL=https://legacy.school.edu",
        "OAUTH_TOKEN_ENCRYPTION_MODE=enforce"
      ].join("\n")
    );

    const result = spawnSync("bash", ["scripts/upgrade-compose.sh", environmentFile], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` }
    });

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("set OAUTH_TOKEN_ENCRYPTION_MODE=compat for the first upgrade");
  });

  it("creates a validated KMS Binary Authorization attestation for the exact digest", () => {
    const directory = temporaryDirectory("safe-online-exam-binauthz-");
    const fakeBin = join(directory, "bin");
    const log = join(directory, "gcloud.log");
    mkdirSync(fakeBin);
    writeExecutable(
      join(fakeBin, "gcloud"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >>"$GCLOUD_TEST_LOG"\nif [[ "$*" == *"attestations list"* ]]; then exit 0; fi\n'
    );
    const image = `ghcr.io/jsb2010/safe-online-exam@sha256:${"e".repeat(64)}`;

    execFileSync(
      "bash",
      [
        "scripts/create-binary-authorization-attestation.sh",
        "sample-project",
        image,
        "safe-online-exam-release",
        "sample-project",
        "global",
        "safe-online-exam",
        "release-attestor",
        "1"
      ],
      {
        cwd: ROOT,
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, GCLOUD_TEST_LOG: log }
      }
    );

    const invocation = readFileSync(log, "utf8");
    expect(invocation).toContain("beta container binauthz attestations sign-and-create");
    expect(invocation).toContain(`--artifact-url=${image}`);
    expect(invocation).toContain("--keyversion-key=release-attestor");
    expect(invocation).toContain("--validate");
  });

  it("reuses an existing Binary Authorization attestation for the exact image and attestor", () => {
    const directory = temporaryDirectory("safe-online-exam-existing-binauthz-");
    const fakeBin = join(directory, "bin");
    const log = join(directory, "gcloud.log");
    mkdirSync(fakeBin);
    writeExecutable(
      join(fakeBin, "gcloud"),
      `#!/usr/bin/env bash
printf '%s\n' "$*" >>"$GCLOUD_TEST_LOG"
if [[ "$*" == *"attestations list"* ]]; then
  printf '%s\n' 'projects/sample-project/occurrences/existing'
  exit 0
fi
exit 99
`
    );
    const image = `ghcr.io/jsb2010/safe-online-exam@sha256:${"f".repeat(64)}`;

    execFileSync(
      "bash",
      [
        "scripts/create-binary-authorization-attestation.sh",
        "sample-project",
        image,
        "safe-online-exam-release",
        "sample-project",
        "global",
        "safe-online-exam",
        "release-attestor",
        "1"
      ],
      {
        cwd: ROOT,
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, GCLOUD_TEST_LOG: log }
      }
    );

    const invocations = readFileSync(log, "utf8");
    expect(invocations).toContain("beta container binauthz attestations list");
    expect(invocations).not.toContain("sign-and-create");
  });

  it("bounds external monitor calls and fails the scheduled workflow closed", () => {
    const monitor = readFileSync(join(ROOT, "scripts/check-supply-chain-pins.mjs"), "utf8");
    const workflow = readFileSync(join(ROOT, ".github/workflows/supply-chain-maintenance.yml"), "utf8");

    expect(monitor.match(/AbortSignal\.timeout\(EXTERNAL_CHECK_TIMEOUT_MS\)/gu)).toHaveLength(3);
    expect(monitor.match(/timeout: EXTERNAL_CHECK_TIMEOUT_MS/gu)).toHaveLength(2);
    expect(monitor.match(/if \(result\.error\)/gu)).toHaveLength(2);
    expect(workflow).toContain('elif [[ "$pin_status" -ne 0 ]]; then');
    expect(workflow).not.toContain('[[ "$pin_status" -eq 1 ||');
  });

  it("requires an explicit apply flag before changing Binary Authorization resources", () => {
    const result = spawnSync("bash", ["scripts/configure-binary-authorization.sh", "enforce", "sample-project"], {
      cwd: ROOT,
      encoding: "utf8"
    });
    const policy = readFileSync(join(ROOT, "deploy", "binary-authorization-policy.yaml"), "utf8");

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("rerun with --apply");
    expect(policy).toContain("evaluationMode: REQUIRE_ATTESTATION");
    expect(policy).toContain("enforcementMode: ENFORCED_BLOCK_AND_AUDIT_LOG");
  });
});

describe("supply-chain maintenance issue lifecycle", () => {
  it("closes an existing issue only after clean pins and a complete clean image scan", () => {
    const { result, calls } = maintainSupplyChainIssue("clean", "success", "success", "success");

    expect(result.status).toBe(0);
    expect(calls.filter((call) => call.args[1] === "close")).toHaveLength(1);
    expect(calls.find((call) => call.args[1] === "close")?.args).toContain("123");
    expect(calls.some((call) => call.args[1] === "edit" || call.args[1] === "create")).toBe(false);
  });

  it.each([
    ["clean", "success", "failure", "failure"],
    ["clean", "success", "success", "failure"],
    ["clean", "success", "cancelled", ""],
    ["clean", "success", "skipped", ""],
    ["clean", "success", "success", ""],
    ["clean", "success", "success", "skipped"],
    ["clean", "failure", "success", "success"],
    ["", "failure", "success", "success"],
    ["clean", "cancelled", "success", "success"],
    ["clean", "skipped", "success", "success"],
    ["drift", "success", "success", "success"],
    ["error", "failure", "success", "success"]
  ])("keeps the issue open for audit %s/%s and image %s/%s", (monitor, audit, image, findings) => {
    const { result, calls } = maintainSupplyChainIssue(monitor, audit, image, findings);

    expect(result.status).toBe(0);
    expect(calls.some((call) => call.args[1] === "close")).toBe(false);
    const update = calls.find((call) => call.args[1] === "edit");
    expect(update?.args).toContain("123");
    expect(update?.body).toContain("Pin report.");
    expect(update?.body).toContain("## Workflow results");
    expect(update?.body).toContain("https://github.com/JSB2010/safe-online-exam/actions/runs/42");
    expect(update?.body).toContain("Source updates do not replace the published image.");
  });

  it("keeps an issue open when the report cannot be downloaded despite successful jobs", () => {
    const { result, calls } = maintainSupplyChainIssue("clean", "success", "success", "success", {
      reportAvailable: false
    });

    expect(result.status).toBe(0);
    expect(calls.some((call) => call.args[1] === "close")).toBe(false);
    expect(calls.find((call) => call.args[1] === "edit")?.body).toContain("dependency monitor report is unavailable");
  });

  it("creates an issue for image findings even when there is no pin drift or existing issue", () => {
    const { result, calls } = maintainSupplyChainIssue("clean", "success", "success", "failure", { issueNumber: "" });

    expect(result.status).toBe(0);
    expect(calls.some((call) => call.args[1] === "close")).toBe(false);
    expect(calls.find((call) => call.args[1] === "create")?.body).toContain(
      "All HIGH/CRITICAL findings check: `failure`"
    );
  });

  it("waits for both jobs and uses the scan's original outcome while retaining the fixable-finding gate", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/supply-chain-maintenance.yml"), "utf8");
    const issueJob = workflow.slice(workflow.indexOf("  maintenance-issue:"));
    const imageJob = workflow.slice(workflow.indexOf("  image-scan:"), workflow.indexOf("  maintenance-issue:"));
    const fixableGate = imageJob.slice(imageJob.indexOf("      - name: Reject fixable high or critical findings"));

    expect(issueJob).toContain("needs: [audit, image-scan]");
    expect(issueJob).toContain("if: always()");
    expect(issueJob).not.toContain("if: always() && needs.audit.outputs.status != ''");
    expect(issueJob).toContain("IMAGE_SCAN_RESULT: ${{ needs.image-scan.result }}");
    expect(issueJob).toContain("IMAGE_SCAN_FINDINGS_RESULT: ${{ needs.image-scan.outputs.findings-result }}");
    expect(imageJob).toContain("findings-result: ${{ steps.findings.outcome }}");
    expect(imageJob).not.toContain("steps.findings.conclusion");
    expect(imageJob).toContain("id: findings\n        continue-on-error: true");
    expect(imageJob).toContain("ignore-unfixed: false");
    expect(fixableGate).toContain('exit-code: "1"');
    expect(fixableGate).toContain("ignore-unfixed: true");
    expect(fixableGate).not.toContain("continue-on-error");
  });
});
