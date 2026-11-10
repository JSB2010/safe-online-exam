import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("reviewed minimatch security override", () => {
  it("resolves the patched matcher through each lint consumer", () => {
    for (const consumer of ["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree"]) {
      const consumerRequire = createRequire(require.resolve(consumer));
      expect(consumerRequire("minimatch/package.json").version).toBe("11.0.5");
      const { minimatch, Minimatch } = consumerRequire("minimatch");
      // The consumers use the function, match(), partial matching and pattern.
      // They do not use makeRe or AST, which were removed in minimatch 11.
      expect(minimatch("src/.hidden.ts", "**/*.ts", { dot: true })).toBe(true);
      expect(minimatch("src/main.tsx", "**/*.{ts,tsx}", { dot: true })).toBe(true);
      expect(minimatch("src/main.js", "**/*.{ts,tsx}", { dot: true })).toBe(false);
      expect(minimatch("test/a.test.ts", "**/!(*.spec).ts", { dot: true })).toBe(true);
      const matcher = new Minimatch("src/**/*.ts", { dot: true });
      expect(matcher.pattern).toBe("src/**/*.ts");
      expect(matcher.match("src/server", true)).toBe(true);
      expect(matcher.match("src/server/main.ts")).toBe(true);
      expect(matcher.match("test/server/main.ts")).toBe(false);
    }
  });

  it("preserves actual ESLint source selection and ignored paths", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    for (const file of ["src/server/main.ts", "test/server/dependency-supply-chain.test.ts"]) {
      expect(await eslint.isPathIgnored(file)).toBe(false);
      expect((await eslint.calculateConfigForFile(file)).rules["@typescript-eslint/no-unused-vars"][0]).toBe(2);
    }
    for (const file of ["dist/server/main.js", "scripts/verify-install-scripts.mjs", "node_modules/example/index.js"]) {
      expect(await eslint.isPathIgnored(file)).toBe(true);
    }
  });

  it("rejects globparts amplification within a bounded subprocess", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import { Minimatch } from 'minimatch';
      const pattern = Array(30).fill('**/../a/b').join('/');
      assert.throws(() => new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 }), RangeError);
      const ordinary = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
      assert.equal(ordinary.match('../a/b/../c/d'), true);
      assert.equal(ordinary.match('x/a/b/y/c/d'), true);
    `
      ],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 5_000 }
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});
