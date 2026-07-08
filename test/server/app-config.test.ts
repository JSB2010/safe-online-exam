import { describe, expect, it } from "vitest";
import { loadConfigFromEnv, resolveProfile, sanitizeToolUrl } from "../../src/server/config/app-config.js";

describe("AppConfig", () => {
  it("honors Spring profile compatibility and Firestore database defaults", () => {
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "dev" })).toBe("dev");
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "prod" })).toBe("prod");
    expect(loadConfigFromEnv({ SPRING_PROFILES_ACTIVE: "prod" }).firestoreDatabaseId).toBe("seb-canvaslti-prod");
    expect(loadConfigFromEnv({ SPRING_PROFILES_ACTIVE: "dev" }).firestoreDatabaseId).toBe("seb-canvaslti-dev");
  });

  it("uses the reset Firestore collection names", () => {
    expect(loadConfigFromEnv({}).firestoreCollections).toEqual({
      assessments: "assessments",
      courses: "courses",
      oauthTokens: "canvasOAuthTokens"
    });
    expect(
      loadConfigFromEnv({
        FIRESTORE_ASSESSMENTS_COLLECTION: "testAssessments",
        FIRESTORE_COURSES_COLLECTION: "testCourses",
        FIRESTORE_OAUTH_TOKENS_COLLECTION: "testTokens"
      }).firestoreCollections
    ).toEqual({
      assessments: "testAssessments",
      courses: "testCourses",
      oauthTokens: "testTokens"
    });
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

  it("uses the app debug flag as the single debug/development toggle", () => {
    expect(loadConfigFromEnv({ APP_ENV: "dev" }).security.debugEnabled).toBe(true);
    expect(loadConfigFromEnv({ APP_ENV: "prod" }).security.debugEnabled).toBe(false);
    expect(loadConfigFromEnv({ APP_ENV: "dev", APP_DEBUG_ENABLED: "false" }).security.debugEnabled).toBe(false);
    expect(loadConfigFromEnv({ APP_ENV: "prod", APP_DEBUG_ENABLED: "true" }).security.debugEnabled).toBe(true);
  });

  it("enables SEB config certificate encryption by default with an env kill switch", () => {
    expect(loadConfigFromEnv({}).seb.configEncryption.enabled).toBe(true);
    expect(loadConfigFromEnv({ SEB_CONFIG_ENCRYPTION_ENABLED: "false" }).seb.configEncryption.enabled).toBe(false);
    expect(
      loadConfigFromEnv({ SEB_CONFIG_ENCRYPTION_CERT_PEM: "-----BEGIN CERTIFICATE-----\\n..." }).seb.configEncryption
        .certificatePem
    ).toBe("-----BEGIN CERTIFICATE-----\n...");
  });
});
