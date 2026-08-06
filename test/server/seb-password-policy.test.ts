import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  assertNewSebPassword,
  assertDistinctSebPasswords,
  assertSebPassword,
  evaluateSebPasswordRequirements,
  normalizeSebPassword,
  requireSebPasswordForConfiguration,
  requireDistinctSebPasswordsForConfiguration,
  resolveSebPasswordUpdate,
  sebPasswordPolicyViolation
} from "../../src/server/services/seb-password-policy.js";

describe("SEB password strength policy", () => {
  it("exposes the same individual requirements for real-time client feedback", () => {
    expect(evaluateSebPasswordRequirements("short")).toMatchObject({
      hasAllowedLength: false,
      hasNoControlCharacters: true,
      hasEnoughDistinctCharacters: true,
      avoidsPredictablePatterns: true,
      valid: false
    });
    expect(evaluateSebPasswordRequirements("password1234")).toMatchObject({
      hasAllowedLength: true,
      hasEnoughDistinctCharacters: true,
      avoidsPredictablePatterns: false,
      valid: false
    });
    expect(evaluateSebPasswordRequirements("cobalt lantern 4829", "cobalt lantern 4829")).toMatchObject({
      differsFromOtherPassword: false,
      valid: false
    });
    expect(evaluateSebPasswordRequirements("cobalt lantern 4829", "different start 7301")).toMatchObject({
      valid: true
    });
  });

  it("accepts memorable letters-only and numbers-only values as well as passphrases", () => {
    for (const candidate of [
      "T7!mQ2#vL9@pR4",
      "correct horse cobalt lantern",
      "blueheron",
      "80419372",
      "安全な試験用パスフレーズです"
    ]) {
      expect(sebPasswordPolicyViolation(candidate), candidate).toBeNull();
      expect(requireSebPasswordForConfiguration(candidate, "exit"), candidate).toBe(candidate);
    }
  });

  it("rejects short, oversized, common, sequential, repetitive, and control-character values", () => {
    const rejected = [
      "short",
      "x".repeat(129),
      "password1234",
      "12345678",
      "abcdefghijkl",
      "ExamExamExam!",
      "aaaaaaaaaaab",
      "strong-enough\nvalue",
      "cobalt\u0085lantern4829",
      "\u2028cobalt-lantern-4829",
      "cobalt-lantern-4829\u2029"
    ];
    for (const candidate of rejected) {
      expect(sebPasswordPolicyViolation(candidate), candidate).not.toBeNull();
      expect(() => requireSebPasswordForConfiguration(candidate, "start"), candidate).toThrow();
    }
  });

  it("reports the exact unmet rule without reflecting the submitted value", () => {
    expect(() => assertSebPassword("short", "start")).toThrow("Start password must be at least 8 characters.");
    expect(() => assertSebPassword("x".repeat(129), "exit")).toThrow(
      "Exit password must be no more than 128 characters."
    );
    expect(() => assertSebPassword("strong-enough\nvalue", "start")).toThrow(
      "Start password cannot contain control characters or line breaks."
    );
    expect(() => assertSebPassword("cobalt\u0085lantern4829", "start")).toThrow(
      "Start password cannot contain control characters or line breaks."
    );
    expect(() => assertSebPassword("\u2028cobalt-lantern-4829", "exit")).toThrow(
      "Exit password cannot contain control characters or line breaks."
    );
    expect(() => assertSebPassword("cobalt-lantern-4829\u2029", "exit")).toThrow(
      "Exit password cannot contain control characters or line breaks."
    );
    expect(() => assertSebPassword("12345678", "exit")).toThrow("Letters-only and numbers-only passwords are allowed.");
  });

  it("returns a sanitized API error that never includes the submitted password", () => {
    const submitted = "password1234";
    try {
      assertSebPassword(submitted, "exit");
      throw new Error("expected password rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse();
      expect(response).toMatchObject({ error_code: "SEB_PASSWORD_POLICY_VIOLATION", statusCode: 400 });
      expect(JSON.stringify(response)).not.toContain(submitted);
    }
  });

  it("preserves blank-as-no-change and allows an unchanged legacy value to be edited elsewhere", () => {
    expect(normalizeSebPassword("  strong replacement phrase  ")).toBe("strong replacement phrase");
    expect(resolveSebPasswordUpdate("existing-secret", "   ")).toBe("existing-secret");
    expect(resolveSebPasswordUpdate("existing-secret", null)).toBeNull();
    expect(() => assertNewSebPassword("existing-secret", "   ", "start")).not.toThrow();
    expect(() => assertNewSebPassword("legacy-short", "legacy-short", "exit")).not.toThrow();
    expect(() => assertNewSebPassword("legacy-short", "password1234", "exit")).toThrowError(
      expect.objectContaining({ status: 400 })
    );
    expect(normalizeSebPassword("cobalt\u0085lantern4829")).toBeNull();
    expect(evaluateSebPasswordRequirements("cobalt\u0085lantern4829")).toMatchObject({
      hasNoControlCharacters: false,
      valid: false
    });
    expect(resolveSebPasswordUpdate("existing-secret", "cobalt\u0085lantern4829")).not.toBe("existing-secret");
    expect(() => assertNewSebPassword("existing-secret", "cobalt\u0085lantern4829", "exit")).toThrow(
      "Exit password cannot contain control characters or line breaks."
    );
  });

  it("rejects start and exit password reuse without reflecting the shared secret", () => {
    const shared = "shared-secret-passphrase";
    try {
      assertDistinctSebPasswords(` ${shared} `, shared);
      throw new Error("expected password-reuse rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse();
      expect(response).toMatchObject({ error_code: "SEB_PASSWORD_REUSE", statusCode: 400 });
      expect(JSON.stringify(response)).not.toContain(shared);
    }
    expect(() => requireDistinctSebPasswordsForConfiguration(shared, shared)).toThrow(
      "Start and exit passwords must be different unique values"
    );
    expect(() =>
      requireDistinctSebPasswordsForConfiguration("different-start-passphrase", "different-exit-passphrase")
    ).not.toThrow();
  });
});
