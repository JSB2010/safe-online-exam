import { describe, expect, it } from "vitest";
import {
  loadConfigFromEnv,
  resolveProfile,
  sanitizeToolUrl,
  validateRuntimeConfig
} from "../../src/server/config/app-config.js";

describe("AppConfig", () => {
  it("honors Spring profile compatibility and Firestore database defaults", () => {
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "dev" })).toBe("dev");
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "prod" })).toBe("prod");
    expect(loadConfigFromEnv({ SPRING_PROFILES_ACTIVE: "prod" }).firestoreDatabaseId).toBe("seb-canvaslti-prod");
    expect(loadConfigFromEnv({ SPRING_PROFILES_ACTIVE: "dev" }).firestoreDatabaseId).toBe("seb-canvaslti-dev");
  });

  it("uses a school-neutral local Canvas placeholder outside Cloud Run", () => {
    const config = loadConfigFromEnv({});
    expect(config.canvas.domain).toBe("https://canvas.example.test");
  });

  it("uses the reset Firestore collection names", () => {
    expect(loadConfigFromEnv({}).firestoreCollections).toEqual({
      assessments: "assessments",
      courses: "courses",
      oauthTokens: "canvasOAuthTokens",
      sessions: "sessions",
      transientStates: "transientStates",
      operationLocks: "operationLocks"
    });
    expect(
      loadConfigFromEnv({
        FIRESTORE_ASSESSMENTS_COLLECTION: "testAssessments",
        FIRESTORE_COURSES_COLLECTION: "testCourses",
        FIRESTORE_OAUTH_TOKENS_COLLECTION: "testTokens",
        FIRESTORE_SESSIONS_COLLECTION: "testSessions",
        FIRESTORE_TRANSIENT_STATES_COLLECTION: "testTransient",
        FIRESTORE_OPERATION_LOCKS_COLLECTION: "testLocks"
      }).firestoreCollections
    ).toEqual({
      assessments: "testAssessments",
      courses: "testCourses",
      oauthTokens: "testTokens",
      sessions: "testSessions",
      transientStates: "testTransient",
      operationLocks: "testLocks"
    });
  });

  it("sanitizes tool and Canvas URLs for Cloud Run", () => {
    expect(sanitizeToolUrl("tool.example.com/")).toBe("https://tool.example.com");
    const config = loadConfigFromEnv({
      TOOL_URL: "canvas-seb-dev.run.app/",
      CANVAS_BASE_URL: "school.instructure.com/api/v1"
    });
    expect(config.lti.toolUrl).toBe("https://canvas-seb-dev.run.app");
    expect(config.canvas.domain).toBe("https://school.instructure.com");
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

  it("requires school-specific runtime config in Cloud Run", () => {
    expect(validateRuntimeConfig(loadConfigFromEnv({ K_SERVICE: "canvas-seb" }), { K_SERVICE: "canvas-seb" })).toEqual(
      expect.arrayContaining([
        "TOOL_URL is required in Cloud Run",
        "CANVAS_DOMAIN is required in Cloud Run",
        "LTI_CLIENT_ID is required in Cloud Run",
        "LTI_PRIVATE_KEY is required in Cloud Run",
        "SESSION_SECRET is required in Cloud Run",
        "STATE_ENCRYPTION_KEY is required in Cloud Run",
        "CANVAS_API_CLIENT_ID is required in Cloud Run",
        "CANVAS_API_CLIENT_SECRET is required in Cloud Run",
        "GCP_PROJECT_ID is required in Cloud Run",
        "FIRESTORE_DATABASE_ID is required in Cloud Run"
      ])
    );

    const env = {
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://tool.example.edu",
      CANVAS_DOMAIN: "https://school.instructure.com",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      SESSION_SECRET: "session-secret",
      STATE_ENCRYPTION_KEY: "state-key",
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      GCP_PROJECT_ID: "project-id",
      FIRESTORE_DATABASE_ID: "school-firestore",
      SEB_CONFIG_ENCRYPTION_ENABLED: "false"
    };

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual([]);
  });
});
