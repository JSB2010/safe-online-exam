import { describe, expect, it } from "vitest";
import { loadConfigFromEnv, resolveProfile, sanitizeToolUrl } from "../../src/server/config/app-config.js";

describe("AppConfig", () => {
  it("honors Spring profile compatibility and Firestore database defaults", () => {
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "dev" })).toBe("dev");
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "prod" })).toBe("prod");
    expect(loadConfigFromEnv({ SPRING_PROFILES_ACTIVE: "prod" }).firestoreDatabaseId).toBe("seb-canvaslti-prod");
    expect(loadConfigFromEnv({ SPRING_PROFILES_ACTIVE: "dev" }).firestoreDatabaseId).toBe("seb-canvaslti-dev");
  });

  it("sanitizes tool and Canvas URLs for Cloud Run", () => {
    expect(sanitizeToolUrl("tool.example.com/")).toBe("https://tool.example.com");
    const config = loadConfigFromEnv({
      TOOL_URL: "canvas-seb-dev.run.app/",
      CANVAS_BASE_URL: "kentdenver.instructure.com/api/v1"
    });
    expect(config.lti.toolUrl).toBe("https://canvas-seb-dev.run.app");
    expect(config.canvas.domain).toBe("https://kentdenver.instructure.com");
  });
});
