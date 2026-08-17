import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_PACKAGE_MANAGER =
  "npm@11.19.0+sha512.48377f8478372aa1c4e47b763475b135836da82436a5700f2e5e8eb5084fc840f93c7b117eb3ad3b5f7d3194c81b6710a10d59448f6ddbcb21ac3fb672bdc003";
const EXPECTED_NPM_ENGINE = ">=11.19.0 <12";
const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const DEFAULT_MIN_RELEASE_AGE_DAYS = 3;
const REGISTRY_CONCURRENCY = 8;
const REGISTRY_REQUEST_TIMEOUT_MS = 15_000;
const REGISTRY_REQUEST_ATTEMPTS = 3;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const APPROVED_LIFECYCLE_ENTRIES = new Map([
  [
    "node_modules/esbuild",
    {
      version: "0.28.2",
      resolved: "https://registry.npmjs.org/esbuild/-/esbuild-0.28.2.tgz",
      integrity: "sha512-HKVLS8dvII+xoKW9kmqxbRKrnWEXfJJr/FZhhJmiqIB0e053QNYFqOBouTMO/k5sID4MvCiUCvv8b9M4h32wIA=="
    }
  ]
]);
const EXPLICITLY_DENIED_LIFECYCLE_PACKAGES = new Set(["fsevents"]);
const EXPECTED_SCRIPT_POLICY = {
  "esbuild@0.28.2": true,
  fsevents: false
};
const EXPECTED_NPM_CONFIG = new Map([
  ["engine-strict", "true"],
  ["fund", "false"],
  ["ignore-scripts", "true"],
  ["strict-allow-scripts", "true"],
  ["allow-git", "none"],
  ["allow-remote", "none"],
  ["allow-file", "none"],
  ["allow-directory", "none"],
  ["registry", "https://registry.npmjs.org/"],
  ["save-exact", "true"]
]);

function assertNoEqualsForm(name) {
  if (process.argv.some((argument) => argument.startsWith(`${name}=`))) {
    throw new Error(`${name} must be passed as "${name} <value>", not "${name}=<value>"`);
  }
}

function argumentValue(name, fallback) {
  assertNoEqualsForm(name);
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return resolve(value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function numericArgument(name, fallback) {
  assertNoEqualsForm(name);
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const rawValue = process.argv[index + 1];
  if (rawValue === undefined || rawValue.startsWith("--")) {
    throw new Error(`${name} requires a non-negative number`);
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} requires a non-negative number`);
  }
  return value;
}

function packageNameFromPath(path) {
  const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u);
  return match?.[1] || null;
}

function isRegistryTarball(resolved) {
  if (typeof resolved !== "string") return false;
  try {
    const url = new URL(resolved);
    return url.origin === REGISTRY_ORIGIN && url.pathname.endsWith(".tgz");
  } catch {
    return false;
  }
}

function verifyExactVersions(value, path, failures) {
  if (typeof value === "string") {
    if (!EXACT_VERSION.test(value)) {
      failures.push(`${path} must use an exact registry version, found ${JSON.stringify(value)}`);
    }
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${path} must use an exact registry version or nested override object`);
    return;
  }
  for (const [name, nestedValue] of Object.entries(value)) {
    verifyExactVersions(nestedValue, `${path}.${name}`, failures);
  }
}

function verifyNpmConfig(path, failures) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const seen = new Set();
  for (const [index, sourceLine] of contents.split(/\r?\n/u).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      failures.push(`Invalid .npmrc entry on line ${index + 1}: ${JSON.stringify(sourceLine)}`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (seen.has(key)) {
      failures.push(`Duplicate .npmrc setting: ${key}`);
      continue;
    }
    seen.add(key);
    if (!EXPECTED_NPM_CONFIG.has(key)) {
      failures.push(`Unknown .npmrc setting: ${key}`);
      continue;
    }
    const expected = EXPECTED_NPM_CONFIG.get(key);
    if (value !== expected) {
      failures.push(`.npmrc setting ${key} must be ${expected}, found ${JSON.stringify(value)}`);
    }
  }

  for (const [key, value] of EXPECTED_NPM_CONFIG) {
    if (!seen.has(key)) failures.push(`Missing required .npmrc setting: ${key}=${value}`);
  }
}

async function fetchRegistryMetadata(packageName) {
  const requestUrl = `${REGISTRY_ORIGIN}/${encodeURIComponent(packageName)}`;
  let lastError;

  for (let attempt = 1; attempt <= REGISTRY_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(requestUrl, {
        headers: {
          accept: "application/json",
          "user-agent": "safe-online-exam-dependency-policy"
        },
        redirect: "error",
        signal: AbortSignal.timeout(REGISTRY_REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (new URL(response.url).origin !== REGISTRY_ORIGIN) {
        throw new Error(`unexpected response origin ${new URL(response.url).origin}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < REGISTRY_REQUEST_ATTEMPTS) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 250));
      }
    }
  }

  throw new Error(
    `Unable to fetch npm publication metadata for ${packageName}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

async function verifyPublicationAges(packages, minimumAgeDays, failures) {
  const versionsByPackage = new Map();
  for (const [path, metadata] of packages) {
    if (path === "" || metadata?.link === true) continue;
    const packageName = packageNameFromPath(path);
    if (!packageName || typeof metadata?.version !== "string") {
      failures.push(`Unable to identify registry package and version for release-age check: ${path}`);
      continue;
    }
    const versions = versionsByPackage.get(packageName) || new Set();
    versions.add(metadata.version);
    versionsByPackage.set(packageName, versions);
  }

  const entries = [...versionsByPackage.entries()];
  const cutoff = Date.now() - minimumAgeDays * 24 * 60 * 60 * 1000;
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < entries.length) {
      const entry = entries[nextIndex];
      nextIndex += 1;
      const [packageName, versions] = entry;
      try {
        const metadata = await fetchRegistryMetadata(packageName);
        for (const version of versions) {
          const publishedAt = metadata?.time?.[version];
          const publishedTimestamp = Date.parse(publishedAt);
          if (typeof publishedAt !== "string" || !Number.isFinite(publishedTimestamp)) {
            failures.push(`npm registry did not provide a publication time for ${packageName}@${version}`);
            continue;
          }
          if (publishedTimestamp > cutoff) {
            const packageVersion = `${packageName}@${version}`;
            failures.push(`${packageVersion} was published ${publishedAt}, less than ${minimumAgeDays} days ago`);
          }
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(REGISTRY_CONCURRENCY, entries.length) }, () => worker()));
  return {
    checkedCount: entries.reduce((count, [, versions]) => count + versions.size, 0)
  };
}

const packagePath = argumentValue("--package", resolve("package.json"));
const lockfilePath = argumentValue("--lockfile", resolve("package-lock.json"));
const npmrcPath = argumentValue("--npmrc", resolve(".npmrc"));
assertNoEqualsForm("--skip-release-age");
const skipReleaseAge = process.argv.includes("--skip-release-age");
const minimumReleaseAgeDays = numericArgument("--min-release-age-days", DEFAULT_MIN_RELEASE_AGE_DAYS);
if (skipReleaseAge && process.argv.includes("--min-release-age-days")) {
  throw new Error("--skip-release-age cannot be combined with --min-release-age-days");
}
const packageJson = readJson(packagePath);
const lockfile = readJson(lockfilePath);
const failures = [];

verifyNpmConfig(npmrcPath, failures);

if (packageJson.packageManager !== EXPECTED_PACKAGE_MANAGER) {
  failures.push(`packageManager must be ${EXPECTED_PACKAGE_MANAGER}`);
}
if (packageJson.engines?.npm !== EXPECTED_NPM_ENGINE) {
  failures.push(`engines.npm must be ${EXPECTED_NPM_ENGINE}`);
}
if (lockfile.lockfileVersion !== 3) {
  failures.push(`package-lock.json must use lockfileVersion 3, found ${String(lockfile.lockfileVersion)}`);
}

const actualPolicy = packageJson.allowScripts || {};
if (JSON.stringify(actualPolicy) !== JSON.stringify(EXPECTED_SCRIPT_POLICY)) {
  failures.push("package.json allowScripts must approve only esbuild@0.28.2 and explicitly deny fsevents");
}

for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, specifier] of Object.entries(packageJson[section] || {})) {
    if (typeof specifier !== "string" || !EXACT_VERSION.test(specifier)) {
      failures.push(`${section}.${name} must use an exact registry version, found ${JSON.stringify(specifier)}`);
    }
  }
}
for (const [name, override] of Object.entries(packageJson.overrides || {})) {
  verifyExactVersions(override, `overrides.${name}`, failures);
}

const packages = Object.entries(lockfile.packages || {});
if (!packages.length || !lockfile.packages?.[""]) {
  failures.push("package-lock.json must contain a root packages entry");
}

for (const [path, metadata] of packages) {
  if (path === "") continue;
  if (metadata?.link === true) {
    failures.push(`Linked dependency is not allowed: ${path}`);
    continue;
  }
  if (!isRegistryTarball(metadata?.resolved)) {
    failures.push(`Dependency must resolve from ${REGISTRY_ORIGIN}: ${path}`);
  }
  if (typeof metadata?.integrity !== "string" || !SHA512_INTEGRITY.test(metadata.integrity)) {
    failures.push(`Dependency must have sha512 integrity metadata: ${path}`);
  }

  if (metadata?.hasInstallScript !== true) continue;
  const packageName = packageNameFromPath(path);
  const approved = APPROVED_LIFECYCLE_ENTRIES.get(path);
  if (approved) {
    for (const field of ["version", "resolved", "integrity"]) {
      if (metadata[field] !== approved[field]) {
        failures.push(`Approved lifecycle dependency ${path} changed ${field}`);
      }
    }
    continue;
  }
  if (packageName && EXPLICITLY_DENIED_LIFECYCLE_PACKAGES.has(packageName)) continue;
  failures.push(`Unapproved dependency lifecycle script: ${path}@${metadata?.version || "unknown"}`);
}

for (const [path, approved] of APPROVED_LIFECYCLE_ENTRIES) {
  if (lockfile.packages?.[path]?.hasInstallScript !== true) {
    failures.push(`Approved lifecycle dependency changed or disappeared: ${path}@${approved.version}`);
  }
}

let publicationResult = { checkedCount: 0 };
if (!failures.length && !skipReleaseAge && minimumReleaseAgeDays > 0) {
  publicationResult = await verifyPublicationAges(packages, minimumReleaseAgeDays, failures);
}

if (failures.length) {
  for (const failure of failures.sort()) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  const lifecycleCount = packages.filter(([, metadata]) => metadata?.hasInstallScript === true).length;
  const publicationSummary = skipReleaseAge
    ? "release-age lookup skipped for the post-install offline recheck"
    : minimumReleaseAgeDays === 0
      ? "release-age gate disabled by explicit command-line override"
      : `${publicationResult.checkedCount} locked package versions checked against the ${minimumReleaseAgeDays}-day minimum`;
  process.stdout.write(
    `Verified strict npm configuration, ${packages.length - 1} registry dependencies, sha512 integrity metadata, exact direct and override versions, ${lifecycleCount} lifecycle-script entries, and ${publicationSummary}.\n`
  );
}
