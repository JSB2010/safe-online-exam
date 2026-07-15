import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config/app-config.js";
import { DebugController } from "../../src/server/controllers/debug.controller.js";
import type { DetectorTraceService } from "../../src/server/services/detector-trace.service.js";

describe("DebugController", () => {
  it("records Canvas detector trace events only when debug mode is enabled", () => {
    const trace = { recordEvent: vi.fn() } as unknown as DetectorTraceService;
    const enabledController = createController({ debugEnabled: true }, trace);
    const disabledController = createController({ debugEnabled: false }, trace);

    expect(enabledController.canvasDetectorTrace({ event: "submit" }, "https://canvas.example.edu")).toEqual({
      enabled: true
    });
    expect(trace.recordEvent).toHaveBeenCalledWith(
      { event: "submit" },
      { origin: "https://canvas.example.edu", includeDetails: false }
    );

    vi.clearAllMocks();

    expect(disabledController.canvasDetectorTrace({ event: "submit" }, "https://canvas.example.edu")).toEqual({
      enabled: false
    });
    expect(trace.recordEvent).not.toHaveBeenCalled();
  });

  it("records detail-rich trace events when detector diagnostics are enabled", () => {
    const trace = { recordEvent: vi.fn() } as unknown as DetectorTraceService;
    const controller = createController({ debugEnabled: false, detectorDiagnosticsEnabled: true }, trace);

    expect(controller.canvasDetectorTrace({ event: "submit" }, "https://canvas.example.edu")).toEqual({
      enabled: true
    });
    expect(trace.recordEvent).toHaveBeenCalledWith(
      { event: "submit" },
      { origin: "https://canvas.example.edu", includeDetails: true }
    );
  });
});

function createController(
  security: { debugEnabled: boolean; detectorDiagnosticsEnabled?: boolean },
  trace: DetectorTraceService
): DebugController {
  const config = {
    profile: "dev",
    value: {
      security: {
        debugEnabled: security.debugEnabled,
        detectorDiagnosticsEnabled: security.detectorDiagnosticsEnabled ?? false
      }
    }
  } as unknown as AppConfig;

  return new DebugController(config, trace);
}
