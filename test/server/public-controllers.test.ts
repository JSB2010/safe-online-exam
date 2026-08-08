import { describe, expect, it, vi } from "vitest";
import { DebugController } from "../../src/server/controllers/debug.controller.js";
import { HomeController } from "../../src/server/controllers/home.controller.js";
import { JwkController } from "../../src/server/controllers/jwk.controller.js";

describe("public utility controllers", () => {
  it("serves health and launch fallback responses", () => {
    const controller = new HomeController(
      {
        profile: "prod",
        value: { testbed: { enabled: false }, security: {} },
        getRequiredToolUrl: () => "https://tool.example.edu"
      } as any,
      { assertReady: vi.fn().mockResolvedValue(undefined) } as any
    );

    expect(controller.home()).toContain('"view":"service-status"');
    expect(controller.health()).toEqual({ status: "UP" });
    expect(controller.loginHealth()).toEqual({ status: "UP" });
    expect(controller.login()).toContain("Launch from Canvas");
  });

  it("delegates JWKS responses to the JWK service", async () => {
    const jwkService = {
      getPublicJwks: vi.fn().mockResolvedValue({ keys: [{ kid: "key-1" }] })
    };
    const controller = new JwkController(jwkService as any);

    await expect(controller.getJwks()).resolves.toEqual({ keys: [{ kid: "key-1" }] });
    expect(jwkService.getPublicJwks).toHaveBeenCalled();
  });

  it("records detector traces only when debug mode is enabled", () => {
    const detectorTrace = { recordEvent: vi.fn() };
    const enabled = new DebugController(
      {
        value: {
          testbed: { enabled: true },
          security: { debugEnabled: true, detectorDiagnosticsEnabled: false }
        },
        getCanvasDomain: () => "https://canvas.example.edu"
      } as any,
      detectorTrace as any
    );

    expect(enabled.canvasDetectorTrace({ event: "loaded" }, "https://canvas.example.edu")).toEqual({
      enabled: true
    });
    expect(detectorTrace.recordEvent).toHaveBeenCalledWith(
      { event: "loaded" },
      { origin: "https://canvas.example.edu", includeDetails: false }
    );

    const disabled = new DebugController(
      {
        value: { testbed: { enabled: false }, security: { debugEnabled: false } },
        getCanvasDomain: () => "https://canvas.example.edu"
      } as any,
      detectorTrace as any
    );
    expect(disabled.canvasDetectorTrace({ event: "ignored" })).toEqual({ enabled: false });
    expect(detectorTrace.recordEvent).toHaveBeenCalledTimes(1);
  });
});
