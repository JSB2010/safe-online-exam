import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSecretValue } from "../../src/server/config/secret-value.js";

describe("resolveSecretValue", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns a direct secret value", () => {
    expect(resolveSecretValue("SESSION_SECRET", { SESSION_SECRET: "direct-secret" })).toBe("direct-secret");
  });

  it("reads a file secret while preserving internal newlines and removing one trailing line ending", () => {
    const directory = mkdtempSync(join(tmpdir(), "canvas-seb-secret-"));
    tempDirectories.push(directory);
    const secretPath = join(directory, "lti-private-key");
    writeFileSync(secretPath, "line-one\nline-two\r\n", { mode: 0o600 });

    expect(resolveSecretValue("LTI_PRIVATE_KEY", { LTI_PRIVATE_KEY_FILE: secretPath })).toBe("line-one\nline-two");
  });

  it("rejects ambiguous direct and file inputs", () => {
    expect(() =>
      resolveSecretValue("SESSION_SECRET", {
        SESSION_SECRET: "direct-secret",
        SESSION_SECRET_FILE: "/run/secrets/session-secret"
      })
    ).toThrow("SESSION_SECRET and SESSION_SECRET_FILE cannot both be set");
  });

  it("reports unreadable files without exposing another secret value", () => {
    const exposedValue = "must-not-appear";
    expect(() =>
      resolveSecretValue("STATE_ENCRYPTION_KEY", {
        STATE_ENCRYPTION_KEY: undefined,
        STATE_ENCRYPTION_KEY_FILE: `/missing/${exposedValue}`
      })
    ).toThrow("Unable to read STATE_ENCRYPTION_KEY from STATE_ENCRYPTION_KEY_FILE");

    try {
      resolveSecretValue("STATE_ENCRYPTION_KEY", {
        STATE_ENCRYPTION_KEY_FILE: `/missing/${exposedValue}`
      });
    } catch (error) {
      expect(String(error)).not.toContain(exposedValue);
    }
  });

  it("treats blank direct and file settings as unset", () => {
    expect(resolveSecretValue("SESSION_SECRET", { SESSION_SECRET: "   " })).toBeUndefined();
    expect(resolveSecretValue("SESSION_SECRET", { SESSION_SECRET_FILE: "   " })).toBeUndefined();
  });
});
