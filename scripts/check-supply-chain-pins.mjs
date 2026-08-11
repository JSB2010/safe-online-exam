import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u;
const EXTERNAL_CHECK_TIMEOUT_MS = 30_000;
const NPM_PATCH_RELEASE_AGE_DAYS = 3;
const NPM_MINOR_RELEASE_AGE_DAYS = 7;

function argumentValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function read(path) {
  return readFileSync(path, "utf8");
}

function parseVersion(version) {
  if (typeof version !== "string") return null;
  const match = version.match(SEMVER);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function collectImagePins(root) {
  const pins = new Map();
  const addPin = (reference, digest, source) => {
    const tagReference = reference.slice(reference.lastIndexOf("/") + 1).includes(":")
      ? reference
      : `${reference}:latest`;
    const existing = pins.get(tagReference);
    if (existing && existing !== digest) {
      throw new Error(`${tagReference} has inconsistent digests (${existing} and ${digest}) including ${source}`);
    }
    pins.set(tagReference, digest);
  };
  const dockerfile = read(resolve(root, "Dockerfile"));
  const syntax = dockerfile.match(/^# syntax=([^\s@]+)@(sha256:[0-9a-f]{64})$/mu);
  if (!syntax) throw new Error("Dockerfile frontend must be pinned by tag and sha256 digest");
  addPin(syntax[1], syntax[2], "Dockerfile frontend");

  const dockerReferences = dockerfile.matchAll(/(?:^|\s)([A-Za-z0-9._/-]+:[^@\s]+)@(sha256:[0-9a-f]{64})(?=\s|$)/gmu);
  for (const match of dockerReferences) addPin(match[1], match[2], "Dockerfile");

  for (const name of readdirSync(root)) {
    if (!/^(?:cloudbuild-.+|compose(?:\..+)?)\.ya?ml$/u.test(name)) continue;
    const source = read(resolve(root, name));
    const references = source.matchAll(
      /(?:image|name):\s*["']?([A-Za-z0-9._/-]+(?::[^@"'\s]+)?)@(sha256:[0-9a-f]{64})/gmu
    );
    for (const match of references) addPin(match[1], match[2], name);
  }
  return pins;
}

function inspectDigest(reference, fixtures) {
  if (fixtures) return fixtures.images?.[reference] || null;
  const result = spawnSync("docker", ["buildx", "imagetools", "inspect", reference, "--format", "{{json .Manifest}}"], {
    encoding: "utf8",
    timeout: EXTERNAL_CHECK_TIMEOUT_MS
  });
  if (result.error) throw new Error(`Unable to inspect ${reference}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Unable to inspect ${reference}: ${result.stderr.trim()}`);
  const digest = JSON.parse(result.stdout).digest;
  if (!DIGEST.test(digest)) throw new Error(`Registry returned an invalid digest for ${reference}`);
  return digest;
}

async function latestNpmWithinMajor(current, fixtures) {
  if (fixtures) return fixtures.tools?.npm || null;
  const currentParts = parseVersion(current);
  if (!currentParts) throw new Error(`Invalid npm version ${current}`);
  const response = await fetch("https://registry.npmjs.org/npm", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(EXTERNAL_CHECK_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  const packument = await response.json();
  return Object.keys(packument.versions || {})
    .filter((version) => parseVersion(version)?.[0] === currentParts[0] && !version.includes("-"))
    .sort(compareVersions)
    .at(-1);
}

async function latestGithubRelease(repository, fixtures, fixtureKey) {
  if (fixtures) return fixtures.tools?.[fixtureKey] || null;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "safe-online-exam-supply-chain-monitor" },
    signal: AbortSignal.timeout(EXTERNAL_CHECK_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`GitHub release API returned HTTP ${response.status} for ${repository}`);
  return (await response.json()).tag_name;
}

function npmOutdated(root, fixtures) {
  if (fixtures) return fixtures.outdated || {};
  const result = spawnSync("npm", ["outdated", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || "/tmp/seb-npm-maintenance-cache" },
    timeout: EXTERNAL_CHECK_TIMEOUT_MS
  });
  if (result.error) throw new Error(`npm outdated failed: ${result.error.message}`);
  if (![0, 1].includes(result.status)) throw new Error(`npm outdated failed: ${result.stderr.trim()}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

async function latestEligibleNpmWithinMajor(packageName, currentVersion, latestVersion, fixtures) {
  const currentMajor = parseVersion(currentVersion)?.[0];
  if (currentMajor === undefined)
    throw new Error(`Invalid installed npm version for ${packageName}: ${currentVersion}`);
  if (fixtures) {
    const candidate = fixtures.npmEligible?.[packageName] || latestVersion;
    return parseVersion(candidate)?.[0] === currentMajor ? candidate : null;
  }
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
    headers: { accept: "application/json", "user-agent": "safe-online-exam-supply-chain-monitor" },
    redirect: "error",
    signal: AbortSignal.timeout(EXTERNAL_CHECK_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status} for ${packageName}`);
  if (new URL(response.url).origin !== "https://registry.npmjs.org") {
    throw new Error(`npm registry returned an unexpected origin for ${packageName}`);
  }
  const packument = await response.json();
  return Object.keys(packument.versions || {})
    .filter((version) => {
      const publishedAt = packument.time?.[version];
      const parsed = parseVersion(version);
      const minimumAgeDays =
        parsed?.[1] === parseVersion(currentVersion)?.[1] ? NPM_PATCH_RELEASE_AGE_DAYS : NPM_MINOR_RELEASE_AGE_DAYS;
      const cutoff = Date.now() - minimumAgeDays * 24 * 60 * 60 * 1000;
      return (
        parsed?.[0] === currentMajor &&
        !version.includes("-") &&
        typeof publishedAt === "string" &&
        Date.parse(publishedAt) <= cutoff
      );
    })
    .sort(compareVersions)
    .at(-1);
}

const root = resolve(argumentValue("--root", "."));
const reportPath = resolve(argumentValue("--report", "supply-chain-report.md"));
const fixturePath = argumentValue("--fixtures");
const fixtures = fixturePath ? JSON.parse(read(resolve(fixturePath))) : null;
const drift = [];
const errors = [];
const current = [];

for (const [reference, pinnedDigest] of collectImagePins(root)) {
  try {
    const latestDigest = inspectDigest(reference, fixtures);
    if (!latestDigest) throw new Error(`No fixture or registry digest available for ${reference}`);
    if (latestDigest === pinnedDigest) current.push([reference, pinnedDigest]);
    else drift.push([reference, pinnedDigest, latestDigest]);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

const packageJson = JSON.parse(read(resolve(root, "package.json")));
const npmVersion = packageJson.packageManager?.match(/^npm@(\d+\.\d+\.\d+)\+sha512\.[0-9a-f]{128}$/u)?.[1];
if (!npmVersion) errors.push("packageManager must contain an exact npm version and SHA-512 integrity hash");
else {
  try {
    const latest = await latestNpmWithinMajor(npmVersion, fixtures);
    if (!latest) throw new Error("No current npm version was returned");
    if (latest !== npmVersion) drift.push(["npm CLI", npmVersion, latest]);
    else current.push(["npm CLI", npmVersion]);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

const releaseWorkflow = read(resolve(root, ".github/workflows/publish-release-image.yml"));
const trivyVersion = releaseWorkflow.match(/version:\s*(v\d+\.\d+\.\d+)/u)?.[1];
try {
  const latest = await latestGithubRelease("aquasecurity/trivy", fixtures, "trivy");
  if (!trivyVersion || !latest) throw new Error("Unable to resolve the pinned or current Trivy version");
  if (latest !== trivyVersion) drift.push(["Trivy", trivyVersion, latest]);
  else current.push(["Trivy", trivyVersion]);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

const attestationVerifier = read(resolve(root, "scripts/verify-github-release-attestation.sh"));
const githubCliVersion = attestationVerifier.match(/^GH_CLI_VERSION="(\d+\.\d+\.\d+)"$/mu)?.[1];
try {
  const latest = (await latestGithubRelease("cli/cli", fixtures, "githubCli"))?.replace(/^v/u, "");
  if (!githubCliVersion || !latest) throw new Error("Unable to resolve the pinned or current GitHub CLI version");
  if (latest !== githubCliVersion) drift.push(["GitHub CLI verifier", githubCliVersion, latest]);
  else current.push(["GitHub CLI verifier", githubCliVersion]);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

let outdated = {};
try {
  outdated = npmOutdated(root, fixtures);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}
const routineUpdates = [];
const majorMigrations = [];
const deferredUpdates = [];
await Promise.all(
  Object.entries(outdated).map(async ([name, details]) => {
    const manifestVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
    const currentVersion = details?.current || manifestVersion || details?.wanted;
    const latestVersion = details?.latest;
    const currentMajor = parseVersion(currentVersion)?.[0];
    const latestMajor = parseVersion(latestVersion)?.[0];
    if (currentMajor === undefined || latestMajor === undefined) {
      errors.push(`npm outdated returned incomplete or invalid version data for ${name}`);
      return;
    }
    if (currentMajor !== latestMajor) majorMigrations.push([name, currentVersion, latestVersion]);
    try {
      const eligibleVersion = await latestEligibleNpmWithinMajor(name, currentVersion, latestVersion, fixtures);
      if (eligibleVersion && compareVersions(eligibleVersion, currentVersion) > 0) {
        routineUpdates.push([name, currentVersion, eligibleVersion]);
      }
      if (currentMajor === latestMajor && compareVersions(latestVersion, eligibleVersion || currentVersion) > 0) {
        deferredUpdates.push([name, eligibleVersion || currentVersion, latestVersion]);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  })
);
routineUpdates.sort(([left], [right]) => left.localeCompare(right));
deferredUpdates.sort(([left], [right]) => left.localeCompare(right));
errors.sort();
drift.push(...routineUpdates.map(([name, from, to]) => [`npm ${name}`, from, to]));

const lines = ["# Weekly supply-chain maintenance", "", `Generated: ${new Date().toISOString()}`, ""];
if (!drift.length && !errors.length) lines.push("No actionable dependency or immutable-pin drift was detected.", "");
if (drift.length) {
  lines.push("## Actionable drift", "", "| Dependency or tool | Pinned | Current |", "| --- | --- | --- |");
  for (const [name, from, to] of drift) lines.push(`| ${name} | \`${from}\` | \`${to}\` |`);
  lines.push("");
}
if (majorMigrations.length) {
  lines.push("## Major migrations (informational)", "", "| Dependency | Current | Latest |", "| --- | --- | --- |");
  for (const [name, from, to] of majorMigrations) lines.push(`| ${name} | \`${from}\` | \`${to}\` |`);
  lines.push("", "Major upgrades remain deliberate migration work and do not by themselves open the drift issue.", "");
}
if (deferredUpdates.length) {
  lines.push(
    "## Cooldown-deferred npm updates (informational)",
    "",
    `These releases are still inside the configured ${NPM_PATCH_RELEASE_AGE_DAYS}-day patch or ${NPM_MINOR_RELEASE_AGE_DAYS}-day minor cooldown and are not actionable yet.`,
    "",
    "| Dependency | Eligible | Latest |",
    "| --- | --- | --- |"
  );
  for (const [name, from, to] of deferredUpdates) lines.push(`| ${name} | \`${from}\` | \`${to}\` |`);
  lines.push("");
}
if (errors.length) {
  lines.push("## Monitor errors", "");
  for (const error of errors) lines.push(`- ${error.replaceAll("\n", " ")}`);
  lines.push("");
}
lines.push(
  `Checked ${current.length + drift.length + majorMigrations.length + deferredUpdates.length} pinned dependency, tool, and image references.`
);
writeFileSync(reportPath, `${lines.join("\n")}\n`);

if (errors.length) process.exitCode = 1;
else if (drift.length) process.exitCode = 2;
