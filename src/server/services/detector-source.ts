import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DETECTOR_PREFIX =
  "/**\n * Safe Online Exam browser detection and redirection script\n *\n * Injected by a Canvas theme loader. Keep this file dependency-free because it\n * runs inside Canvas and Safe Exam Browser.\n */\n(function () {\n";
const DETECTOR_SUFFIX = "})();\n";

function assembleDetectorSource(fragments: string[]): string {
  return `${DETECTOR_PREFIX}${fragments.join("")}${DETECTOR_SUFFIX}`;
}

export async function readDetectorSource(directory: string): Promise<string> {
  const fragmentNames = await readDetectorFragmentNames(directory);
  return assembleDetectorSource(
    await Promise.all(fragmentNames.map((fragmentName) => readFile(join(directory, fragmentName), "utf8")))
  );
}

export function readDetectorSourceSync(directory: string): string {
  const fragmentNames = parseDetectorFragmentNames(readFileSync(join(directory, "manifest.json"), "utf8"));
  return assembleDetectorSource(
    fragmentNames.map((fragmentName) => readFileSync(join(directory, fragmentName), "utf8"))
  );
}

async function readDetectorFragmentNames(directory: string): Promise<string[]> {
  return parseDetectorFragmentNames(await readFile(join(directory, "manifest.json"), "utf8"));
}

function parseDetectorFragmentNames(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((entry) => typeof entry !== "string" || !/^[a-z0-9-]+\.js$/u.test(entry))
  ) {
    throw new Error("Canvas detector fragment manifest is invalid");
  }
  return parsed;
}
