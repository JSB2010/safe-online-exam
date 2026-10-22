import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

describe.each(["login", "user", "inline"])("%s keychain installer identity matching", (name) => {
  const source = readFileSync(
    name === "inline"
      ? "scripts/generate-jamf-seb-identity-inline-script.mjs"
      : `scripts/install-seb-config-identity-${name}-keychain.sh`,
    "utf8"
  );
  const functionSource = source.match(/identity_exists\(\) \{[\s\S]*?\n\}/u)![0];
  const expected = "A".repeat(40);
  function matches(identity: string) {
    return (
      spawnSync(
        "bash",
        ["-c", `${functionSource}\nrun_as_console_user() { printf '%s\\n' "$IDENTITY_OUTPUT"; }\nidentity_exists`],
        {
          env: { ...process.env, EXPECTED_IDENTITY_SHA1: expected, IDENTITY_OUTPUT: identity }
        }
      ).status === 0
    );
  }
  it("rejects a different identity sharing the certificate name", () => {
    expect(matches(`  1) ${"B".repeat(40)} "Safe Online Exam Configuration Encryption"`)).toBe(false);
  });
  it("accepts the exact private identity among multiple certificates", () => {
    expect(matches(`  1) ${"B".repeat(40)} "Same Name"\n  2) ${expected} "Same Name"`)).toBe(true);
    expect(matches("0 valid identities found")).toBe(false);
  });
});
