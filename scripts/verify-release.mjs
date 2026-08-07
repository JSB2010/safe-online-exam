#!/usr/bin/env node

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function fail(message) {
  console.error(`release consistency check failed: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
}

function readText(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseArguments(argv) {
  const options = {
    tag: undefined,
    notesOutput: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === "--tag" && value) {
      options.tag = value;
      index += 1;
      continue;
    }
    if (argument === "--notes-output" && value) {
      options.notesOutput = value;
      index += 1;
      continue;
    }

    fail(`unknown or incomplete argument: ${argument}`);
  }

  return options;
}

function extractChangelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/u);
  const headingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, "u");
  const start = lines.findIndex((line) => headingPattern.test(line));

  if (start === -1) {
    fail(`CHANGELOG.md is missing a dated [${version}] section`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## \[/u.test(lines[index]) || /^\[[^\]]+\]:/u.test(lines[index])) {
      end = index;
      break;
    }
  }

  const section = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  if (section === "") {
    fail(`CHANGELOG.md has an empty [${version}] section`);
  }

  return section;
}

const options = parseArguments(process.argv.slice(2));
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const version = packageJson.version;
const expectedTag = `v${version}`;
const releaseTag = options.tag ?? expectedTag;

if (!VERSION_PATTERN.test(version)) {
  fail(`package.json version is not supported SemVer: ${version}`);
}
if (releaseTag !== expectedTag) {
  fail(`tag ${releaseTag} does not match package version ${expectedTag}`);
}
if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
  fail("package-lock.json root versions do not match package.json");
}

const packageManagerVersion = packageJson.packageManager?.match(/^npm@(\d+\.\d+\.\d+)\+sha512\.[0-9a-f]{128}$/u)?.[1];
const dockerfilePackageManagerVersions = [
  ...readText("Dockerfile").matchAll(/npm --version \| grep -Fx "(\d+\.\d+\.\d+)"/gu)
].map((match) => match[1]);
if (!packageManagerVersion) {
  fail("package.json must pin npm with an integrity-authenticated packageManager entry");
}
if (
  dockerfilePackageManagerVersions.length !== 2 ||
  dockerfilePackageManagerVersions.some((candidate) => candidate !== packageManagerVersion)
) {
  fail(
    `Both Dockerfile npm versions must match packageManager npm@${packageManagerVersion}, found ${
      dockerfilePackageManagerVersions.length ? dockerfilePackageManagerVersions.join(", ") : "none"
    }`
  );
}

const readme = readText("README.md");
const readmeVersion = readme.match(/^export VERSION=(.+)$/mu)?.[1];
if (readmeVersion !== version) {
  fail(`README.md quick-start version must be ${version}, found ${readmeVersion ?? "none"}`);
}

const composeEnvironment = readText(".env.compose.example");
const composeVersion = composeEnvironment.match(/^APP_IMAGE=ghcr\.io\/jsb2010\/safe-online-exam:([^\s]+)$/mu)?.[1];
if (composeVersion !== version) {
  fail(`.env.compose.example image version must be ${version}, found ${composeVersion ?? "none"}`);
}

const cloudRunEnvironment = readText("deploy/cloudrun.env.example");
const cloudRunVersion = cloudRunEnvironment.match(/^APP_VERSION=(.+)$/mu)?.[1];
if (cloudRunVersion !== version) {
  fail(`deploy/cloudrun.env.example APP_VERSION must be ${version}, found ${cloudRunVersion ?? "none"}`);
}
if (!/^APP_IMAGE=ghcr\.io\/jsb2010\/safe-online-exam@sha256:REPLACE_WITH_RELEASE_DIGEST$/mu.test(cloudRunEnvironment)) {
  fail("deploy/cloudrun.env.example must use the release-digest placeholder");
}

const cloudRunContract = readJson("deploy/cloud-run-contract.json");
const requiredCloudRunEnvironment = new Set(cloudRunContract.requiredEnvironment);
const canvasEndpointEnvironment = new Set(cloudRunContract.canvasEndpointEnvironment);
const requiredCloudRunSecrets = new Set(cloudRunContract.secrets.map((secret) => secret.environment));

function parseCloudRunBindings(config, flag) {
  return [...config.matchAll(new RegExp(`"${escapeRegExp(flag)}=([^"]+)"`, "gu"))].map(
    (match) => new Set(match[1].split(",").map((binding) => binding.split("=")[0]))
  );
}

const portableCloudRunConfig = readText("deploy/cloud-run-config.sh");
for (const configuredName of [...requiredCloudRunEnvironment, ...canvasEndpointEnvironment]) {
  if (!portableCloudRunConfig.includes(`${configuredName}=`)) {
    fail(`portable Cloud Run environment renderer is missing ${configuredName}`);
  }
}

for (const configPath of ["cloudbuild-dev.yaml", "cloudbuild-prod.yaml", "cloudbuild-school.yaml"]) {
  const config = readText(configPath);
  const rawEnvironmentBindings = [...config.matchAll(/"--set-env-vars=([^"]+)"/gu)].map((match) => match[1]);
  const rawSecretBindings = [...config.matchAll(/"--set-secrets=([^"]+)"/gu)].map((match) => match[1]);
  const environmentBindings = parseCloudRunBindings(config, "--set-env-vars");
  const secretBindings = parseCloudRunBindings(config, "--set-secrets");
  if (environmentBindings.length !== 3 || secretBindings.length !== 3) {
    fail(`${configPath} must configure the migrate job, cleanup job, and service`);
  }
  if (new Set(rawEnvironmentBindings).size !== 1 || new Set(rawSecretBindings).size !== 1) {
    fail(`${configPath} must give the migrate job, cleanup job, and service identical configuration`);
  }

  for (const binding of environmentBindings) {
    for (const requiredName of requiredCloudRunEnvironment) {
      if (!binding.has(requiredName)) {
        fail(`${configPath} Cloud Run environment is missing ${requiredName}`);
      }
    }
    const configuredCanvasEndpoints = [...canvasEndpointEnvironment].filter((name) => binding.has(name));
    if (configuredCanvasEndpoints.length !== 0 && configuredCanvasEndpoints.length !== canvasEndpointEnvironment.size) {
      fail(`${configPath} must configure all Canvas endpoint overrides together`);
    }
  }
  for (const binding of secretBindings) {
    if (
      binding.size !== requiredCloudRunSecrets.size ||
      [...requiredCloudRunSecrets].some((requiredName) => !binding.has(requiredName))
    ) {
      fail(`${configPath} Secret Manager bindings have drifted from deploy/cloud-run-contract.json`);
    }
  }
}

for (const scriptPath of [
  "scripts/bootstrap-cloud-run-secrets.sh",
  "scripts/doctor-cloud-run.sh",
  "scripts/prepare-cloud-run.sh",
  "scripts/render-canvas-theme-loader.sh",
  "scripts/map-cloud-run-domain.sh",
  "scripts/install-cloud-run.sh",
  "scripts/finalize-cloud-run-lti.sh",
  "scripts/upgrade-cloud-run.sh",
  "scripts/rollback-cloud-run.sh",
  "scripts/backup-compose.sh",
  "scripts/upgrade-compose.sh",
  "scripts/install-seb-config-identity-user-keychain.sh",
  "scripts/install-seb-config-identity-login-keychain.sh",
  "scripts/build-jamf-seb-identity-package.sh",
  "scripts/generate-jamf-seb-identity-inline-script.mjs",
  "scripts/create-cloud-run-bundle.sh",
  "scripts/render-release-deployment-notes.sh"
]) {
  if ((statSync(resolve(ROOT, scriptPath)).mode & 0o111) === 0) {
    fail(`${scriptPath} must be executable`);
  }
}

const jamfDaemon = readText("deploy/jamf/org.safeonlineexam.seb-identity-installer.plist");
if (!jamfDaemon.includes("org.safeonlineexam.seb-identity-installer")) {
  fail("deploy/jamf must include the SEB identity installer LaunchDaemon manifest");
}

const changelog = readText("CHANGELOG.md");
const changelogSection = extractChangelogSection(changelog, version);
const changelogLink = `[${version}]: https://github.com/JSB2010/safe-online-exam/releases/tag/${expectedTag}`;
if (!changelog.includes(changelogLink)) {
  fail(`CHANGELOG.md is missing the canonical ${version} release link`);
}

if (options.notesOutput) {
  const notes = `${changelogSection}

See the [${expectedTag} changelog](https://github.com/JSB2010/safe-online-exam/blob/${expectedTag}/CHANGELOG.md) for the canonical release record.
`;
  writeFileSync(resolve(ROOT, options.notesOutput), notes, { encoding: "utf8", mode: 0o600 });
}

console.log(`release consistency check passed for ${expectedTag}`);
