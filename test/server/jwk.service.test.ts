// @vitest-environment node

import { generateKeyPair } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exportJWK } from "jose";
import { AppConfig } from "../../src/server/config/app-config.js";
import { JwkService } from "../../src/server/services/jwk.service.js";

describe("JwkService", () => {
  it("generates development JWKS", async () => {
    process.env.SPRING_PROFILES_ACTIVE = "dev";
    process.env.TOOL_URL = "https://tool.example.com";
    const service = new JwkService(new AppConfig());

    const jwks = await service.getPublicJwks();

    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", kid: "canvas-seb-integration-key", alg: "RS256" });
  });

  it("requires an explicit private key in production", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LTI_PRIVATE_KEY: undefined
      },
      async () => {
        const service = new JwkService(new AppConfig());

        await expect(service.getPublicJwks()).rejects.toThrow("LTI_PRIVATE_KEY is required in prod");
      }
    );
  });

  it("exports only the public part of a configured RSA private JWK", async () => {
    const { privateKey } = await new Promise<{ privateKey: JsonWebKey }>((resolve, reject) => {
      generateKeyPair(
        "rsa",
        {
          modulusLength: 2048,
          publicExponent: 0x10001
        },
        async (error, publicKey, generatedPrivateKey) => {
          if (error) {
            reject(error);
            return;
          }
          void publicKey;
          resolve({ privateKey: (await exportJWK(generatedPrivateKey)) as JsonWebKey });
        }
      );
    });
    privateKey.kid = "configured-key";

    await withEnv({ NODE_ENV: "production", LTI_PRIVATE_KEY: JSON.stringify(privateKey) }, async () => {
      const service = new JwkService(new AppConfig());

      const jwks = await service.getPublicJwks();

      expect(jwks.keys[0]).toMatchObject({ kty: "RSA", kid: "configured-key", use: "sig", alg: "RS256" });
      expect(jwks.keys[0]).not.toHaveProperty("d");
      expect(jwks.keys[0]).not.toHaveProperty("p");
      expect(jwks.keys[0]).not.toHaveProperty("q");
    });
  });

  it("rejects configured keys that are not RSA private JWKs", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LTI_PRIVATE_KEY: JSON.stringify({ kty: "oct", k: "secret" })
      },
      async () => {
        const service = new JwkService(new AppConfig());

        await expect(service.getPublicJwks()).rejects.toThrow("LTI private key must be an RSA private JWK");
      }
    );
  });
});

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
