import { describe, expect, it } from "vitest";
import { HomeController } from "../../src/server/controllers/home.controller.js";

describe("HomeController", () => {
  it("serves a Canvas launch fallback for direct /login requests", () => {
    const controller = new HomeController();

    expect(controller.login()).toContain("Launch from Canvas");
    expect(controller.login()).toContain("configured LTI link");
  });
});
