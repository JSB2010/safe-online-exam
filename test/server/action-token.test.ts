import { describe, expect, it, vi } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { createActionToken, verifyActionToken } from "../../src/server/http/action-token.js";

describe("action tokens", () => {
  it("signs and verifies dashboard action context", () => {
    process.env.SESSION_SECRET = "test-session-secret";
    const config = new AppConfig();
    const token = createActionToken(config, "user-1", "course-7");

    expect(verifyActionToken(config, token)).toMatchObject({
      userId: "user-1",
      courseId: "course-7"
    });
    expect(verifyActionToken(config, `${token}tampered`)).toBeNull();
  });

  it("rejects expired tokens", () => {
    process.env.SESSION_SECRET = "test-session-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const config = new AppConfig();
    const token = createActionToken(config, "user-1", "course-7");

    vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
    expect(verifyActionToken(config, token)).toBeNull();
    vi.useRealTimers();
  });
});
