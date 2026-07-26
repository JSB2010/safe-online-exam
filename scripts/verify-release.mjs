#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
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
