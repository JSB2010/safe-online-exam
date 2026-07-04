import { describe, expect, it } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { LtiStateService } from "../../src/server/services/lti-state.service.js";

describe("LtiStateService", () => {
  it("encrypts state and consumes it once", () => {
    const service = new LtiStateService(new AppConfig());
    const state = service.createState({ nonce: "nonce-1", target: "launch" });

    expect(service.consumeState(state)).toEqual({ nonce: "nonce-1", target: "launch" });
    expect(() => service.consumeState(state)).toThrow();
  });
});
