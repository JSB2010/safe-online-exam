// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { JwkService } from "../../src/server/services/jwk.service.js";

describe("JwkService", () => {
  it("generates development JWKS during startup", async () => {
    await withEnv(developmentRuntimeEnv(), async () => {
      const service = new JwkService(new AppConfig());

      await service.onModuleInit();
      const jwks = await service.getPublicJwks();

      expect(jwks.keys[0]).toMatchObject({ kty: "RSA", kid: "canvas-seb-integration-key", alg: "RS256" });
      expect(Object.keys(jwks.keys[0]!).sort()).toEqual(["alg", "e", "key_ops", "kid", "kty", "n", "use"]);
    });
  });

  it("requires an explicit private key in production", async () => {
    await withEnv(productionRuntimeEnv({ LTI_PRIVATE_KEY: undefined }), async () => {
      expect(() => new AppConfig()).toThrow("LTI_PRIVATE_KEY is required in production");
    });
  });

  it("accepts a strong configured signing key and exports an allowlisted public JWK", async () => {
    const privateKey = rsaPrivateJwk();
    Object.assign(privateKey, {
      kid: "configured-key",
      alg: "RS256",
      use: "sig",
      unexpected_secret: "must-not-be-public"
    });

    await withEnv(productionRuntimeEnv({ LTI_PRIVATE_KEY: JSON.stringify(privateKey) }), async () => {
      const service = new JwkService(new AppConfig());

      await service.onModuleInit();
      const jwks = await service.getPublicJwks();

      expect(jwks.keys[0]).toMatchObject({ kty: "RSA", kid: "configured-key", use: "sig", alg: "RS256" });
      expect(Object.keys(jwks.keys[0]!).sort()).toEqual(["alg", "e", "key_ops", "kid", "kty", "n", "use"]);
      expect(jwks.keys[0]).not.toHaveProperty("unexpected_secret");
    });
  });

  it("rejects malformed configured JWK JSON during startup", async () => {
    await withEnv(productionRuntimeEnv({ LTI_PRIVATE_KEY: "not-json" }), async () => {
      const service = new JwkService(new AppConfig());

      await expect(service.onModuleInit()).rejects.toThrow("LTI_PRIVATE_KEY must contain a valid JSON Web Key");
    });
  });

  it("rejects configured keys that are not RSA private JWKs during startup", async () => {
    await withEnv(productionRuntimeEnv({ LTI_PRIVATE_KEY: JSON.stringify({ kty: "oct", k: "secret" }) }), async () => {
      const service = new JwkService(new AppConfig());

      await expect(service.onModuleInit()).rejects.toThrow("LTI private key must be an RSA private JWK");
    });
  });

  it("rejects RSA signing keys with a modulus below 2048 bits during startup", async () => {
    const privateKey = rsaPrivateJwk(1024);

    await withEnv(productionRuntimeEnv({ LTI_PRIVATE_KEY: JSON.stringify(privateKey) }), async () => {
      const service = new JwkService(new AppConfig());

      await expect(service.onModuleInit()).rejects.toThrow("RSA modulus of at least 2048 bits");
    });
  });

  it("rejects RSA signing keys with an unsafe public exponent during startup", async () => {
    const privateKey = rsaPrivateJwk(2048, 3);

    await withEnv(productionRuntimeEnv({ LTI_PRIVATE_KEY: JSON.stringify(privateKey) }), async () => {
      const service = new JwkService(new AppConfig());

      await expect(service.onModuleInit()).rejects.toThrow("RSA public exponent 65537");
    });
  });

  it.each([
    ["a conflicting algorithm", { alg: "RS512" }, "algorithm must be RS256"],
    ["an encryption use", { use: "enc" }, "use must be sig"],
    ["non-signing operations", { key_ops: ["decrypt"] }, "operations must permit signing only"]
  ])("rejects a valid RSA key configured with %s", async (_label, metadata, expectedMessage) => {
    const privateKey = Object.assign(rsaPrivateJwk(), metadata);

    await withEnv(productionRuntimeEnv({ LTI_PRIVATE_KEY: JSON.stringify(privateKey) }), async () => {
      const service = new JwkService(new AppConfig());

      await expect(service.onModuleInit()).rejects.toThrow(expectedMessage);
    });
  });
});

function rsaPrivateJwk(modulusLength = 2048, publicExponent = 0x10001): JsonWebKey {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength, publicExponent });
  return privateKey.export({ format: "jwk" });
}

function developmentRuntimeEnv(): Record<string, string | undefined> {
  return {
    APP_ENV: "dev",
    NODE_ENV: "development",
    SPRING_PROFILES_ACTIVE: "dev",
    K_SERVICE: undefined,
    TOOL_URL: "https://tool.example.com",
    LTI_PRIVATE_KEY: undefined
  };
}

function productionRuntimeEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    APP_ENV: "prod",
    NODE_ENV: "production",
    SPRING_PROFILES_ACTIVE: undefined,
    K_SERVICE: undefined,
    APP_BASE_URL: undefined,
    BASE_URL: undefined,
    TOOL_URL: "https://tool.example.edu",
    CANVAS_DOMAIN: "https://school.instructure.com",
    CANVAS_API_BASE_URL: "https://school.instructure.com/api/v1",
    CANVAS_REDIRECT_URI: "https://tool.example.edu/api/oauth2callback",
    LTI_CLIENT_ID: "client-id",
    LTI_PRIVATE_KEY: '{"kty":"RSA","d":"private"}',
    LTI_DEPLOYMENT_ID: "deployment-1",
    SESSION_SECRET: "s".repeat(48),
    STATE_ENCRYPTION_KEY: "k".repeat(48),
    CANVAS_API_CLIENT_ID: "api-client",
    CANVAS_API_CLIENT_SECRET: "api-secret",
    DATABASE_HOST: "127.0.0.1",
    DATABASE_NAME: "canvas_seb",
    DATABASE_USER: "canvas_runtime",
    DATABASE_PASSWORD: "database-secret",
    SEB_CONFIG_ENCRYPTION_ENABLED: "true",
    SEB_CONFIG_ENCRYPTION_CERT_PEM: "test-certificate",
    APP_DEBUG_ENABLED: "false",
    ...overrides
  };
}

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
