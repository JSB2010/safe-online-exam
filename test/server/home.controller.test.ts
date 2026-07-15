import { describe, expect, it } from "vitest";
import { HomeController } from "../../src/server/controllers/home.controller.js";

describe("HomeController", () => {
  it("serves a Canvas launch fallback for direct /login requests", () => {
    const controller = new HomeController({ getRequiredToolUrl: () => "https://tool.example.edu" } as any);

    expect(controller.login()).toContain("Launch from Canvas");
    expect(controller.login()).toContain("configured LTI link");
  });

  it("serves a public, secret-free Canvas setup center", () => {
    const controller = new HomeController({ getRequiredToolUrl: () => "https://tool.example.edu" } as any);

    const page = controller.setup();
    expect(page).toContain('"view":"admin-setup"');
    expect(page).toContain("https://tool.example.edu/lti/config");
    expect(page).toContain("https://tool.example.edu/.well-known/jwks.json");
    expect(page).not.toContain("LTI_DEPLOYMENT_ID");
  });
});
