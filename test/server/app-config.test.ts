import { describe, expect, it } from "vitest";
import {
  AppConfig,
  loadConfigFromEnv,
  requiresHardenedRuntimeValidation,
  resolveProfile,
  sanitizeToolUrl,
  usesSourceKnownLocalOAuthTokenKey,
  validateRuntimeConfig
} from "../../src/server/config/app-config.js";

describe("AppConfig", () => {
  it("honors Spring profile compatibility and PostgreSQL defaults", () => {
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "dev" })).toBe("dev");
    expect(resolveProfile({ SPRING_PROFILES_ACTIVE: "prod" })).toBe("prod");
    expect(loadConfigFromEnv({ SPRING_PROFILES_ACTIVE: "prod" }).database).toMatchObject({
      host: "127.0.0.1",
      port: 5432,
      name: "canvas_seb",
      user: "canvas_seb",
      sslMode: "disable",
      poolMax: 5
    });
  });

  it("uses a school-neutral local Canvas placeholder outside Cloud Run", () => {
    const config = loadConfigFromEnv({});
    expect(config.canvas.domain).toBe("https://canvas.example.test");
    expect(config.lti.deploymentIdCheckingEnabled).toBe(true);
    expect(config.lti.courseNavigationVisibleToStudents).toBe(true);
    expect(usesSourceKnownLocalOAuthTokenKey(config.security.oauthTokenEncryption)).toBe(true);
    expect(
      usesSourceKnownLocalOAuthTokenKey(
        loadConfigFromEnv(oauthTokenEncryptionRuntimeEnv()).security.oauthTokenEncryption
      )
    ).toBe(false);
  });

  it("hides course navigation from students only for an explicit false value", () => {
    expect(
      loadConfigFromEnv({ LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS: "false" }).lti.courseNavigationVisibleToStudents
    ).toBe(false);
    expect(
      loadConfigFromEnv({ LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS: " FALSE " }).lti.courseNavigationVisibleToStudents
    ).toBe(false);

    for (const value of [undefined, "", "0", "off", "no", "unexpected"]) {
      expect(
        loadConfigFromEnv({ LTI_COURSE_NAVIGATION_VISIBLE_TO_STUDENTS: value }).lti.courseNavigationVisibleToStudents
      ).toBe(true);
    }
  });

  it("permits a hardened runtime without a deployment allowlist only when checking is explicitly disabled", () => {
    const env = productionRuntimeEnv({
      LTI_DEPLOYMENT_ID: undefined,
      LTI_DEPLOYMENT_ID_CHECKING_ENABLED: "false"
    });
    const config = loadConfigFromEnv(env);

    expect(config.lti.deploymentIdCheckingEnabled).toBe(false);
    expect(validateRuntimeConfig(config, env)).not.toContain("LTI_DEPLOYMENT_ID is required in production");
  });

  it("does not synthesize development secrets and validates missing config in non-Cloud production", () => {
    const env = { APP_ENV: "prod" };
    const config = loadConfigFromEnv(env);

    expect(config.security.sessionSecret).toBe("");
    expect(config.security.stateEncryptionKey).toBe("");
    expect(requiresHardenedRuntimeValidation(config, env)).toBe(true);
    expect(validateRuntimeConfig(config, env)).toEqual(
      expect.arrayContaining([
        "TOOL_URL is required in production",
        "CANVAS_DOMAIN is required in production",
        "LTI_CLIENT_ID is required in production",
        "LTI_PRIVATE_KEY is required in production",
        "LTI_DEPLOYMENT_ID is required in production",
        "SESSION_SECRET is required in production",
        "STATE_ENCRYPTION_KEY is required in production",
        "OAUTH_TOKEN_ENCRYPTION_KEYRING is required in production",
        "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID is required in production",
        "CANVAS_API_CLIENT_ID is required in production",
        "CANVAS_API_CLIENT_SECRET is required in production",
        "DATABASE_HOST is required in production",
        "DATABASE_NAME is required in production",
        "DATABASE_USER is required in production",
        "DATABASE_PASSWORD is required in production"
      ])
    );

    const devConfig = loadConfigFromEnv({ APP_ENV: "dev" });
    expect(devConfig.security.sessionSecret).toBe("seb-canvas-session-dev-secret");
    expect(devConfig.security.stateEncryptionKey).toBe("seb-canvas-dev-state-key");
    expect(requiresHardenedRuntimeValidation(devConfig, { APP_ENV: "dev" })).toBe(false);
  });

  it("rejects hostile config in non-Cloud production", () => {
    const env = productionRuntimeEnv({
      TOOL_URL: "https://user:password@tool.example.edu/path",
      CANVAS_DOMAIN: "http://school.instructure.com/courses/1",
      CANVAS_API_BASE_URL: "https://attacker.example/api/v1",
      CANVAS_REDIRECT_URI: "https://attacker.example/api/oauth2callback",
      SESSION_SECRET: "short",
      STATE_ENCRYPTION_KEY: "also-short",
      APP_DEBUG_ENABLED: "true",
      SEB_CONFIG_ENCRYPTION_ENABLED: "false"
    });

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual(
      expect.arrayContaining([
        "TOOL_URL must be an HTTPS origin without credentials, path, query, or fragment in production",
        "CANVAS_DOMAIN must be an HTTPS origin without credentials, path, query, or fragment in production",
        "CANVAS_API_BASE_URL must be the configured Canvas HTTPS origin followed by /api/v1 in production",
        "CANVAS_REDIRECT_URI must equal TOOL_URL followed by /api/oauth2callback in production",
        "SESSION_SECRET must contain at least 32 characters in production",
        "STATE_ENCRYPTION_KEY must contain at least 32 characters in production",
        "APP_DEBUG_ENABLED must be false in production"
      ])
    );
  });

  it("activates hardened validation for production and every Cloud Run revision", () => {
    const prodEnv = productionRuntimeEnv({ APP_DETECTOR_DIAGNOSTICS_ENABLED: "true" });
    expect(loadConfigFromEnv(prodEnv).security.detectorDiagnosticsEnabled).toBe(true);
    expect(validateRuntimeConfig(loadConfigFromEnv(prodEnv), prodEnv)).toEqual(
      expect.arrayContaining(["APP_DETECTOR_DIAGNOSTICS_ENABLED must be false in production"])
    );

    const devCloudRunEnv = productionRuntimeEnv({
      APP_ENV: "dev",
      K_SERVICE: "canvas-seb-dev",
      APP_DETECTOR_DIAGNOSTICS_ENABLED: "true"
    });
    const devConfig = loadConfigFromEnv(devCloudRunEnv);
    expect(requiresHardenedRuntimeValidation(devConfig, devCloudRunEnv)).toBe(true);
    expect(validateRuntimeConfig(devConfig, devCloudRunEnv)).toEqual(
      expect.arrayContaining(["APP_DETECTOR_DIAGNOSTICS_ENABLED must be false in Cloud Run"])
    );
  });

  it("allows bounded diagnostics only for an explicit, fully identified development testbed", () => {
    const env = productionRuntimeEnv({
      APP_ENV: "dev",
      K_SERVICE: "school-canvas-seb",
      DEV_TESTBED_ENABLED: "true",
      APP_DEBUG_ENABLED: "true",
      APP_DETECTOR_DIAGNOSTICS_ENABLED: "true",
      SOURCE_COMMIT_SHA: "a".repeat(40),
      SOURCE_REF: "feature/testbed",
      SOURCE_WORKTREE_STATE: "dirty",
      SOURCE_DIFF_SHA: "b".repeat(64),
      CLOUD_BUILD_ID: "12345678-abcd-1234-abcd-123456789abc",
      APP_IMAGE_DIGEST: `sha256:${"c".repeat(64)}`
    });

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual([]);

    const production = { ...env, APP_ENV: "prod" };
    expect(validateRuntimeConfig(loadConfigFromEnv(production), production)).toEqual(
      expect.arrayContaining([
        "APP_DEBUG_ENABLED must be false in Cloud Run",
        "APP_DETECTOR_DIAGNOSTICS_ENABLED must be false in Cloud Run",
        "DEV_TESTBED_ENABLED may only be true when APP_ENV is dev in Cloud Run"
      ])
    );
  });

  it("requires immutable provenance for Cloud Run development testbeds", () => {
    const env = productionRuntimeEnv({
      APP_ENV: "dev",
      K_SERVICE: "school-canvas-seb",
      DEV_TESTBED_ENABLED: "true",
      SOURCE_WORKTREE_STATE: "dirty"
    });

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual(
      expect.arrayContaining([
        "SOURCE_COMMIT_SHA must be a full lowercase Git commit SHA in Cloud Run testbeds",
        "SOURCE_REF must be a safe Git ref label in Cloud Run testbeds",
        "SOURCE_DIFF_SHA must be a lowercase SHA-256 digest for dirty Cloud Run testbeds",
        "CLOUD_BUILD_ID must identify the build in Cloud Run testbeds",
        "APP_IMAGE_DIGEST must be an immutable sha256 digest in Cloud Run testbeds"
      ])
    );
  });

  it("preserves a fully configured non-Cloud production runtime", () => {
    const env = productionRuntimeEnv();
    const config = loadConfigFromEnv(env);

    expect(requiresHardenedRuntimeValidation(config, env)).toBe(true);
    expect(validateRuntimeConfig(config, env)).toEqual([]);
  });

  it("requires a valid OAuth token encryption keyring in hardened runtimes", () => {
    const missing = productionRuntimeEnv({
      OAUTH_TOKEN_ENCRYPTION_KEYRING: undefined,
      OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID: undefined
    });
    expect(validateRuntimeConfig(loadConfigFromEnv(missing), missing)).toEqual(
      expect.arrayContaining([
        "OAUTH_TOKEN_ENCRYPTION_KEYRING is required in production",
        "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID is required in production"
      ])
    );

    const malformed = productionRuntimeEnv({ OAUTH_TOKEN_ENCRYPTION_KEYRING: '{"primary":"short"}' });
    expect(validateRuntimeConfig(loadConfigFromEnv(malformed), malformed)).toContain(
      "Every OAUTH_TOKEN_ENCRYPTION_KEYRING value must be a 32-byte base64url key in production"
    );
  });

  it("rejects the in-memory repository and legacy session-secret alias in hardened runtimes", () => {
    const env = productionRuntimeEnv({
      SESSION_SECRET: undefined,
      ADMIN_PASSWORD: "a".repeat(48),
      USE_IN_MEMORY_STORE: "true"
    });

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual(
      expect.arrayContaining([
        "SESSION_SECRET is required in production",
        "USE_IN_MEMORY_STORE must be false in production"
      ])
    );

    const localEnv = {
      APP_ENV: "dev",
      ADMIN_PASSWORD: "legacy-local-secret",
      USE_IN_MEMORY_STORE: "true"
    };
    expect(loadConfigFromEnv(localEnv).security.sessionSecret).toBe("legacy-local-secret");
    expect(validateRuntimeConfig(loadConfigFromEnv(localEnv), localEnv)).toEqual([]);
  });

  it("rejects a weak managed SEB quit password without reflecting it", () => {
    const env = productionRuntimeEnv({ SEB_QUIT_PASSWORD: "password1234" });
    const errors = validateRuntimeConfig(loadConfigFromEnv(env), env);

    expect(errors).toContain(
      "SEB_QUIT_PASSWORD must be 8-128 characters, use at least 5 different letters or numbers, and avoid common, sequential, or repetitive values in production"
    );
    expect(errors.join("\n")).not.toContain("password1234");
  });

  it("validates LTI trust-root URLs while preserving Canvas cloud and self-hosted endpoints", () => {
    const invalidValues: Array<[string, string, string]> = [
      [
        "LTI_ISSUER",
        "http://canvas.school.example/lti/platform",
        "LTI_ISSUER must be an HTTPS issuer URL without credentials, query, or fragment in production"
      ],
      [
        "LTI_ISSUER",
        "https://user:secret@canvas.school.example/lti/platform",
        "LTI_ISSUER must be an HTTPS issuer URL without credentials, query, or fragment in production"
      ],
      [
        "LTI_ISSUER",
        "https://canvas.school.example/lti/platform?tenant=school",
        "LTI_ISSUER must be an HTTPS issuer URL without credentials, query, or fragment in production"
      ],
      [
        "LTI_KEY_SET_URL",
        "https://user:secret@canvas.school.example/api/lti/security/jwks",
        "LTI_KEY_SET_URL must be an HTTPS endpoint without credentials or fragment in production"
      ],
      [
        "LTI_KEY_SET_URL",
        "https://canvas.school.example/api/lti/security/jwks#keys",
        "LTI_KEY_SET_URL must be an HTTPS endpoint without credentials or fragment in production"
      ],
      [
        "LTI_AUTH_URL",
        "http://canvas.school.example/api/lti/authorize_redirect",
        "LTI_AUTH_URL must be an HTTPS endpoint without credentials or fragment in production"
      ],
      [
        "LTI_AUTH_URL",
        "https://canvas.school.example/api/lti/authorize_redirect#login",
        "LTI_AUTH_URL must be an HTTPS endpoint without credentials or fragment in production"
      ]
    ];

    for (const [name, value, expectedError] of invalidValues) {
      const env = productionRuntimeEnv({ [name]: value });
      expect(validateRuntimeConfig(loadConfigFromEnv(env), env), `${name}=${value}`).toContain(expectedError);
    }

    const selfHostedEnv = productionRuntimeEnv({
      CANVAS_DOMAIN: "https://canvas.school.example",
      LTI_ISSUER: "https://canvas.school.example/lti/platform",
      LTI_KEY_SET_URL: "https://canvas.school.example/api/lti/security/jwks?tenant=school",
      LTI_AUTH_URL: "https://canvas.school.example/api/lti/authorize_redirect?tenant=school"
    });
    expect(validateRuntimeConfig(loadConfigFromEnv(selfHostedEnv), selfHostedEnv)).toEqual([]);
  });

  it("pins hardened application URLs to TOOL_URL and rejects conflicting legacy aliases", () => {
    const conflictingEnv = productionRuntimeEnv({
      APP_BASE_URL: "https://attacker.example",
      BASE_URL: "https://another-attacker.example"
    });
    expect(validateRuntimeConfig(loadConfigFromEnv(conflictingEnv), conflictingEnv)).toContain(
      "APP_BASE_URL and BASE_URL must match TOOL_URL when set in production"
    );

    withProcessEnv(
      productionRuntimeEnv({
        APP_BASE_URL: "https://tool.example.edu",
        BASE_URL: "https://tool.example.edu"
      }),
      () => {
        const config = new AppConfig();
        process.env.APP_BASE_URL = "https://attacker.example";
        process.env.BASE_URL = "https://attacker.example";
        expect(config.getApplicationBaseUrl()).toBe("https://tool.example.edu");
      }
    );

    withProcessEnv(productionRuntimeEnv({ APP_ENV: "dev", K_SERVICE: "canvas-seb-dev" }), () => {
      const config = new AppConfig();
      delete process.env.K_SERVICE;
      process.env.APP_BASE_URL = "https://attacker.example";
      expect(config.getApplicationBaseUrl()).toBe("https://tool.example.edu");
    });
  });

  it("parses bounded PostgreSQL connection settings", () => {
    expect(
      loadConfigFromEnv({
        DATABASE_HOST: "/cloudsql/project:region:instance",
        DATABASE_PORT: "5433",
        DATABASE_NAME: "canvas_prod",
        DATABASE_USER: "canvas_runtime",
        DATABASE_PASSWORD: "database-secret",
        DATABASE_SSL_MODE: "require",
        DATABASE_POOL_MAX: "7",
        DATABASE_CONNECTION_TIMEOUT_MS: "12000",
        DATABASE_STATEMENT_TIMEOUT_MS: "45000"
      }).database
    ).toEqual({
      host: "/cloudsql/project:region:instance",
      port: 5433,
      name: "canvas_prod",
      user: "canvas_runtime",
      password: "database-secret",
      sslMode: "require",
      poolMax: 7,
      connectionTimeoutMs: 12000,
      statementTimeoutMs: 45000
    });
  });

  it("rejects malformed and out-of-range PostgreSQL connection settings", () => {
    const env = productionRuntimeEnv({
      DATABASE_PORT: "not-a-port",
      DATABASE_POOL_MAX: "101",
      DATABASE_CONNECTION_TIMEOUT_MS: "99",
      DATABASE_STATEMENT_TIMEOUT_MS: "600001",
      DATABASE_SSL_MODE: "prefer"
    });

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual(
      expect.arrayContaining([
        "DATABASE_PORT must be an integer between 1 and 65535 in production",
        "DATABASE_POOL_MAX must be an integer between 1 and 100 in production",
        "DATABASE_CONNECTION_TIMEOUT_MS must be an integer between 100 and 120000 in production",
        "DATABASE_STATEMENT_TIMEOUT_MS must be an integer between 100 and 600000 in production",
        "DATABASE_SSL_MODE must be disable, require, verify-ca, or verify-full in production"
      ])
    );
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

  it("keeps debug endpoints off by default and uses the explicit app debug flag", () => {
    expect(loadConfigFromEnv({ APP_ENV: "dev" }).security.debugEnabled).toBe(false);
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

  it("requires school-specific runtime config in production Cloud Run", () => {
    const emptyCloudRunEnv = { APP_ENV: "prod", K_SERVICE: "canvas-seb" };
    expect(validateRuntimeConfig(loadConfigFromEnv(emptyCloudRunEnv), emptyCloudRunEnv)).toEqual(
      expect.arrayContaining([
        "TOOL_URL is required in Cloud Run",
        "CANVAS_DOMAIN is required in Cloud Run",
        "LTI_CLIENT_ID is required in Cloud Run",
        "LTI_PRIVATE_KEY is required in Cloud Run",
        "LTI_DEPLOYMENT_ID is required in Cloud Run",
        "SESSION_SECRET is required in Cloud Run",
        "STATE_ENCRYPTION_KEY is required in Cloud Run",
        "OAUTH_TOKEN_ENCRYPTION_KEYRING is required in Cloud Run",
        "OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID is required in Cloud Run",
        "CANVAS_API_CLIENT_ID is required in Cloud Run",
        "CANVAS_API_CLIENT_SECRET is required in Cloud Run",
        "DATABASE_HOST is required in Cloud Run",
        "DATABASE_NAME is required in Cloud Run",
        "DATABASE_USER is required in Cloud Run",
        "DATABASE_PASSWORD is required in Cloud Run"
      ])
    );

    const env = {
      APP_ENV: "prod",
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://tool.example.edu",
      CANVAS_DOMAIN: "https://school.instructure.com",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      LTI_DEPLOYMENT_ID: "deployment-1",
      SESSION_SECRET: "s".repeat(48),
      STATE_ENCRYPTION_KEY: "k".repeat(48),
      ...oauthTokenEncryptionRuntimeEnv(),
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      ...databaseRuntimeEnv(),
      SEB_CONFIG_ENCRYPTION_CERT_PEM: "test-certificate"
    };

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual([]);
  });

  it("rejects weak runtime secrets and non-origin production URLs", () => {
    const env = {
      APP_ENV: "prod",
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://user:password@tool.example.edu/path",
      CANVAS_DOMAIN: "http://school.instructure.com/courses/1",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      LTI_DEPLOYMENT_ID: "deployment-1",
      SESSION_SECRET: "short",
      STATE_ENCRYPTION_KEY: "also-short",
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      ...databaseRuntimeEnv(),
      SEB_CONFIG_ENCRYPTION_CERT_PEM: "test-certificate"
    };

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual(
      expect.arrayContaining([
        "TOOL_URL must be an HTTPS origin without credentials, path, query, or fragment in Cloud Run",
        "CANVAS_DOMAIN must be an HTTPS origin without credentials, path, query, or fragment in Cloud Run",
        "SESSION_SECRET must contain at least 32 characters in Cloud Run",
        "STATE_ENCRYPTION_KEY must contain at least 32 characters in Cloud Run"
      ])
    );
  });

  it("rejects Canvas API bases that could receive bearer tokens on another origin", () => {
    const baseEnv = {
      APP_ENV: "prod",
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://tool.example.edu",
      CANVAS_DOMAIN: "https://school.instructure.com",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      LTI_DEPLOYMENT_ID: "deployment-1",
      SESSION_SECRET: "s".repeat(48),
      STATE_ENCRYPTION_KEY: "k".repeat(48),
      ...oauthTokenEncryptionRuntimeEnv(),
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      ...databaseRuntimeEnv(),
      SEB_CONFIG_ENCRYPTION_CERT_PEM: "test-certificate"
    };

    for (const unsafeBase of [
      "http://school.instructure.com/api/v1",
      "https://attacker.example/api/v1",
      "https://school.instructure.com.evil.example/api/v1",
      "https://user:pass@school.instructure.com/api/v1",
      "https://school.instructure.com/api/v1?redirect=evil"
    ]) {
      const env = { ...baseEnv, CANVAS_API_BASE_URL: unsafeBase };
      expect(validateRuntimeConfig(loadConfigFromEnv(env), env), unsafeBase).toContain(
        "CANVAS_API_BASE_URL must be the configured Canvas HTTPS origin followed by /api/v1 in Cloud Run"
      );
    }

    const safeEnv = { ...baseEnv, CANVAS_API_BASE_URL: "https://school.instructure.com/api/v1/" };
    expect(validateRuntimeConfig(loadConfigFromEnv(safeEnv), safeEnv)).toEqual([]);
  });

  it("requires independent session-signing and state-encryption keys", () => {
    const sharedSecret = "x".repeat(48);
    const env = {
      APP_ENV: "prod",
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://tool.example.edu",
      CANVAS_DOMAIN: "https://school.instructure.com",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      LTI_DEPLOYMENT_ID: "deployment-1",
      SESSION_SECRET: sharedSecret,
      STATE_ENCRYPTION_KEY: sharedSecret,
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      ...databaseRuntimeEnv(),
      SEB_CONFIG_ENCRYPTION_CERT_PEM: "test-certificate"
    };

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toContain(
      "SESSION_SECRET and STATE_ENCRYPTION_KEY must be independent values in Cloud Run"
    );
  });

  it("pins the Canvas OAuth callback to the configured tool origin", () => {
    const baseEnv = {
      APP_ENV: "prod",
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://tool.example.edu",
      CANVAS_DOMAIN: "https://school.instructure.com",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      LTI_DEPLOYMENT_ID: "deployment-1",
      SESSION_SECRET: "s".repeat(48),
      STATE_ENCRYPTION_KEY: "k".repeat(48),
      ...oauthTokenEncryptionRuntimeEnv(),
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      ...databaseRuntimeEnv(),
      SEB_CONFIG_ENCRYPTION_CERT_PEM: "test-certificate"
    };

    for (const unsafeRedirect of [
      "https://attacker.example/api/oauth2callback",
      "https://tool.example.edu:444/api/oauth2callback",
      "https://user:pass@tool.example.edu/api/oauth2callback",
      "https://tool.example.edu/api/oauth2callback/extra",
      "https://tool.example.edu/api/oauth2callback?next=evil"
    ]) {
      const env = { ...baseEnv, CANVAS_REDIRECT_URI: unsafeRedirect };
      expect(validateRuntimeConfig(loadConfigFromEnv(env), env), unsafeRedirect).toContain(
        "CANVAS_REDIRECT_URI must equal TOOL_URL followed by /api/oauth2callback in Cloud Run"
      );
    }

    const safeEnv = { ...baseEnv, CANVAS_REDIRECT_URI: "https://tool.example.edu/api/oauth2callback" };
    expect(validateRuntimeConfig(loadConfigFromEnv(safeEnv), safeEnv)).toEqual([]);
  });

  it("allows instance-level disabled certificate encryption in Cloud Run while retaining other hardening", () => {
    const env = {
      APP_ENV: "prod",
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://tool.example.edu",
      CANVAS_DOMAIN: "https://school.instructure.com",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      LTI_DEPLOYMENT_ID: "deployment-1",
      SESSION_SECRET: "s".repeat(48),
      STATE_ENCRYPTION_KEY: "k".repeat(48),
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      ...databaseRuntimeEnv(),
      SEB_CONFIG_ENCRYPTION_ENABLED: "false",
      SEB_REQUIRED_DOMAINS: "*.example.edu,accounts.google.com"
    };

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toEqual(
      expect.arrayContaining([
        "SEB_REQUIRED_DOMAINS contains an unsafe hostname: *.example.edu",
        "SEB_REQUIRED_DOMAINS must not include an identity-provider hostname: accounts.google.com"
      ])
    );
    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).not.toContain(
      "SEB config encryption requires a validity-checked X.509 certificate through SEB_CONFIG_ENCRYPTION_CERT_PEM or SEB_CONFIG_ENCRYPTION_CERT_PATH"
    );
  });

  it("does not accept a bare public key in place of a validity-checked Cloud Run certificate", () => {
    const env = {
      APP_ENV: "prod",
      K_SERVICE: "canvas-seb",
      TOOL_URL: "https://tool.example.edu",
      CANVAS_DOMAIN: "https://school.instructure.com",
      LTI_CLIENT_ID: "client-id",
      LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
      LTI_DEPLOYMENT_ID: "deployment-1",
      SESSION_SECRET: "s".repeat(48),
      STATE_ENCRYPTION_KEY: "k".repeat(48),
      CANVAS_API_CLIENT_ID: "api-client",
      CANVAS_API_CLIENT_SECRET: "api-secret",
      ...databaseRuntimeEnv(),
      SEB_CONFIG_ENCRYPTION_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    };

    expect(validateRuntimeConfig(loadConfigFromEnv(env), env)).toContain(
      "SEB config encryption requires a validity-checked X.509 certificate through SEB_CONFIG_ENCRYPTION_CERT_PEM or SEB_CONFIG_ENCRYPTION_CERT_PATH"
    );
  });
});

function productionRuntimeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: "prod",
    TOOL_URL: "https://tool.example.edu",
    CANVAS_DOMAIN: "https://school.instructure.com",
    LTI_CLIENT_ID: "client-id",
    LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
    LTI_DEPLOYMENT_ID: "deployment-1",
    SESSION_SECRET: "s".repeat(48),
    STATE_ENCRYPTION_KEY: "k".repeat(48),
    OAUTH_TOKEN_ENCRYPTION_KEYRING: JSON.stringify({ primary: Buffer.alloc(32, 11).toString("base64url") }),
    OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "primary",
    OAUTH_TOKEN_ENCRYPTION_MODE: "enforce",
    CANVAS_API_CLIENT_ID: "api-client",
    CANVAS_API_CLIENT_SECRET: "api-secret",
    ...databaseRuntimeEnv(),
    SEB_CONFIG_ENCRYPTION_CERT_PEM: "test-certificate",
    ...overrides
  };
}

function databaseRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_HOST: "127.0.0.1",
    DATABASE_PORT: "5432",
    DATABASE_NAME: "canvas_seb",
    DATABASE_USER: "canvas_runtime",
    DATABASE_PASSWORD: "database-secret",
    DATABASE_SSL_MODE: "disable",
    DATABASE_POOL_MAX: "5",
    DATABASE_CONNECTION_TIMEOUT_MS: "10000",
    DATABASE_STATEMENT_TIMEOUT_MS: "30000"
  };
}

function oauthTokenEncryptionRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    OAUTH_TOKEN_ENCRYPTION_KEYRING: JSON.stringify({ primary: Buffer.alloc(32, 11).toString("base64url") }),
    OAUTH_TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "primary",
    OAUTH_TOKEN_ENCRYPTION_MODE: "enforce"
  };
}

function withProcessEnv<T>(env: NodeJS.ProcessEnv, run: () => T): T {
  const keys = new Set([...Object.keys(env), "K_SERVICE", "NODE_ENV", "APP_BASE_URL", "BASE_URL"]);
  const previous = new Map([...keys].map((key) => [key, process.env[key]]));
  for (const key of keys) {
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
