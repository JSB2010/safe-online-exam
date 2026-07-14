import { Body, Controller, Headers, Post } from "@nestjs/common";
import { AppConfig } from "../config/app-config.js";
import { DetectorTraceService } from "../services/detector-trace.service.js";

@Controller("/api/debug")
export class DebugController {
  constructor(
    private readonly config: AppConfig,
    private readonly detectorTrace: DetectorTraceService
  ) {}

  @Post("/canvas-detector-trace")
  canvasDetectorTrace(@Body() payload: unknown, @Headers("origin") origin?: string): Record<string, unknown> {
    const diagnosticsEnabled = this.config.value.security.detectorDiagnosticsEnabled;
    if (!this.config.value.security.debugEnabled && !diagnosticsEnabled) {
      return { enabled: false };
    }

    this.detectorTrace.recordEvent(payload, { origin, includeDetails: diagnosticsEnabled });
    return { enabled: true };
  }
}
