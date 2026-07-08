import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config/app-config.js";
import { DebugController } from "../../src/server/controllers/debug.controller.js";
import type { AssessmentService } from "../../src/server/services/assessment.service.js";
import type { CanvasApiService } from "../../src/server/services/canvas-api.service.js";
import type { DetectorTraceService } from "../../src/server/services/detector-trace.service.js";

describe("DebugController", () => {
  it("records Canvas detector trace events only when debug mode is enabled", () => {
    const trace = { recordEvent: vi.fn() } as unknown as DetectorTraceService;
    const enabledController = createController(true, trace);
    const disabledController = createController(false, trace);

    expect(
      enabledController.canvasDetectorTrace({ event: "submit" }, "https://canvas.example.edu", "SEB", "127.0.0.1")
    ).toEqual({
      enabled: true
    });
    expect(trace.recordEvent).toHaveBeenCalledWith(
      { event: "submit" },
      { ip: "127.0.0.1", origin: "https://canvas.example.edu", userAgent: "SEB" }
    );

    vi.clearAllMocks();

    expect(disabledController.canvasDetectorTrace({ event: "submit" }, "https://canvas.example.edu", "SEB")).toEqual({
      enabled: false
    });
    expect(trace.recordEvent).not.toHaveBeenCalled();
  });
});

function createController(debugEnabled: boolean, trace: DetectorTraceService): DebugController {
  const config = {
    profile: "dev",
    value: {
      security: { debugEnabled }
    }
  } as unknown as AppConfig;

  return new DebugController(config, {} as CanvasApiService, {} as AssessmentService, trace);
}
