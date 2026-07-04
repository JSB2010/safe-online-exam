import { describe, expect, it } from "vitest";
import { StaticJsController } from "../../src/server/controllers/static-js.controller.js";

describe("StaticJsController", () => {
  it("injects forwarded Cloud Run base URL without API key placeholders", async () => {
    const controller = new StaticJsController();
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canvas-seb-dev.run.app"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "canvas-seb-dev.run.app",
      socket: { localPort: 8080 }
    } as any;

    const script = await controller.canvasDetector(request);

    expect(script).toContain("https://canvas-seb-dev.run.app");
    expect(script).not.toContain("${SEB_API_KEY}");
    expect(script).not.toContain("https://canvas-seb-dev.run.app:80");
  });

  it("includes a generic progress overlay for the SEB quiz handoff", async () => {
    const controller = new StaticJsController();
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canvas-seb-dev.run.app"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "canvas-seb-dev.run.app",
      socket: { localPort: 8080 }
    } as any;

    const script = await controller.canvasDetector(request);

    expect(script).toContain("Getting your quiz ready");
    expect(script).toContain("This should only take a moment.");
    expect(script).toContain("showAccessCodeProgressOverlay();");
    expect(script).toContain("hideAccessCodeProgressOverlay(8000);");
  });
});
