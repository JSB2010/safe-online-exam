// @vitest-environment node

import { describe, expect, it } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { JwkService } from "../../src/server/services/jwk.service.js";

describe("JwkService", () => {
  it("generates development JWKS and signs client assertions", async () => {
    process.env.SPRING_PROFILES_ACTIVE = "dev";
    process.env.TOOL_URL = "https://tool.example.com";
    const service = new JwkService(new AppConfig());

    const jwks = await service.getPublicJwks();
    const assertion = await service.createClientAssertion(
      "client-1",
      "https://tool.example.com",
      "https://canvas.example.com/token"
    );

    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", kid: "canvas-seb-integration-key", alg: "RS256" });
    expect(assertion.split(".")).toHaveLength(3);
  });
});
