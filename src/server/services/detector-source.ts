import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readDetectorSource(directory: string): Promise<string> {
  const fragmentNames = await readDetectorFragmentNames(directory);
  return (await Promise.all(fragmentNames.map((fragmentName) => readFile(join(directory, fragmentName), "utf8")))).join(
    ""
  );
}

export function readDetectorSourceSync(directory: string): string {
  const fragmentNames = parseDetectorFragmentNames(readFileSync(join(directory, "manifest.json"), "utf8"));
  return fragmentNames.map((fragmentName) => readFileSync(join(directory, fragmentName), "utf8")).join("");
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
