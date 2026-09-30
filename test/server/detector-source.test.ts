import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { readDetectorSource, readDetectorSourceSync } from "../../src/server/services/detector-source.js";

const DIRECTORY = join(process.cwd(), "src/server/assets/detector");
const FRAGMENTS: string[] = JSON.parse(readFileSync(join(DIRECTORY, "manifest.json"), "utf8"));

describe("Canvas detector source assembly", () => {
  it.each(FRAGMENTS)("keeps %s independently parseable for security scanning", (fragment) => {
    expect(() => new Script(readFileSync(join(DIRECTORY, fragment), "utf8"), { filename: fragment })).not.toThrow();
  });

  it("assembles identical valid JavaScript through synchronous and asynchronous readers", async () => {
    const source = readDetectorSourceSync(DIRECTORY);
    expect(await readDetectorSource(DIRECTORY)).toBe(source);
    expect(() => new Script(source)).not.toThrow();
    expect(source).toContain("(function () {\n    'use strict';");
    expect(source.endsWith("    initializeScript();\n})();\n")).toBe(true);
  });
});
