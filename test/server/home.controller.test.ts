import { describe, expect, it, vi } from "vitest";
import { HomeController } from "../../src/server/controllers/home.controller.js";

describe("HomeController", () => {
  it("serves a Canvas launch fallback for direct /login requests", () => {
    const controller = homeController();

    expect(controller.login()).toContain("Launch from Canvas");
    expect(controller.login()).toContain("configured LTI link");
  });

  it("serves a public, secret-free Canvas setup center", () => {
    const controller = homeController();

    const page = controller.setup();
    expect(page).toContain('"view":"admin-setup"');
    expect(page).toContain("https://tool.example.edu/lti/config");
    expect(page).toContain("https://tool.example.edu/.well-known/jwks.json");
    expect(page).not.toContain("LTI_DEPLOYMENT_ID");
  });

  it("reports readiness only after the selected repository is ready", async () => {
    const ready = homeController({ assertReady: vi.fn().mockResolvedValue(undefined) });
    await expect(ready.ready()).resolves.toEqual({ status: "UP" });

    const unavailable = homeController({ assertReady: vi.fn().mockRejectedValue(new Error("database secret")) });
    await expect(unavailable.ready()).rejects.toMatchObject({
      status: 503,
      response: { status: "DOWN" }
    });
  });

  it("publishes provenance only for an explicitly enabled development testbed", () => {
    const controller = homeController(undefined, {
      enabled: true,
      sourceCommitSha: "a".repeat(40),
      sourceRef: "feature/testbed",
      sourceWorktreeState: "clean",
      cloudBuildId: "build-123456",
      imageDigest: `sha256:${"b".repeat(64)}`
    });

    expect(controller.testbedStatus()).toMatchObject({
      enabled: true,
      environment: "dev",
      sourceCommitSha: "a".repeat(40),
      sourceRef: "feature/testbed"
    });
    expect(controller.home()).toContain('"enabled":true');
  });

  it("provides the Safe Online Exam icon for browser favicon probes", async () => {
    const response = { type: vi.fn().mockReturnThis(), send: vi.fn() };

    await homeController().favicon(response as any);

    expect(response.type).toHaveBeenCalledWith("image/x-icon");
    expect(response.send).toHaveBeenCalledWith(expect.any(Buffer));
  });
});

function homeController(
  repository: { assertReady: () => Promise<void> } = { assertReady: async () => undefined },
  testbed: Record<string, unknown> = { enabled: false }
) {
  return new HomeController(
    {
      profile: "dev",
      value: { testbed, security: { debugEnabled: false, detectorDiagnosticsEnabled: false } },
      getRequiredToolUrl: () => "https://tool.example.edu"
    } as any,
    repository as any
  );
}
