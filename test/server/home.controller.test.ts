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

  it("handles browser favicon probes without generating a not-found warning", () => {
    expect(homeController().favicon()).toBeUndefined();
  });
});

function homeController(repository: { assertReady: () => Promise<void> } = { assertReady: async () => undefined }) {
  return new HomeController({ getRequiredToolUrl: () => "https://tool.example.edu" } as any, repository as any);
}
