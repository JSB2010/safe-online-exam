import { describe, expect, it } from "vitest";
import {
  effectiveSebQuitPassword,
  hasEffectiveSebQuitPassword,
  requireSebQuitPassword
} from "../../src/server/services/seb-quit-password.js";

describe("SEB quit-password policy", () => {
  it("resolves a trimmed assessment password before the managed server default", () => {
    expect(effectiveSebQuitPassword("  quiz-exit-secret  ", "server-exit-secret")).toBe("quiz-exit-secret");
    expect(effectiveSebQuitPassword("  ", "  server-exit-secret  ")).toBe("server-exit-secret");
    expect(effectiveSebQuitPassword("", "   ")).toBeNull();
    expect(hasEffectiveSebQuitPassword(null, "server-exit-secret")).toBe(true);
    expect(hasEffectiveSebQuitPassword("exit", "server-exit-secret")).toBe(false);
  });

  it("fails active assessments closed but permits disabled records without a password", () => {
    expect(() =>
      requireSebQuitPassword({ sebRequired: false, enabled: false, quitPassword: null }, null)
    ).not.toThrow();
    expect(() => requireSebQuitPassword({ sebRequired: true, enabled: true, quitPassword: "  " }, null)).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ error_code: "SEB_QUIT_PASSWORD_REQUIRED" }),
        status: 400
      })
    );
    expect(() =>
      requireSebQuitPassword({ sebRequired: false, enabled: true, quitPassword: "\t\n" }, null)
    ).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() =>
      requireSebQuitPassword({ sebRequired: true, enabled: true, quitPassword: null }, "server-exit-secret")
    ).not.toThrow();
    expect(() =>
      requireSebQuitPassword({ sebRequired: true, enabled: true, quitPassword: "password1234" }, null)
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ error_code: "SEB_QUIT_PASSWORD_WEAK" }),
        status: 400
      })
    );
  });
});
