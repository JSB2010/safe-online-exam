import { Body, Controller, Headers, Ip, Post } from "@nestjs/common";
import { AppConfig } from "../config/app-config.js";
import { DetectorTraceService } from "../services/detector-trace.service.js";

@Controller("/api/debug")
export class DebugController {
  constructor(
    private readonly config: AppConfig,
    private readonly detectorTrace: DetectorTraceService
  ) {}

  @Post("/canvas-detector-trace")
  canvasDetectorTrace(
    @Body() payload: unknown,
    @Headers("origin") origin?: string,
    @Headers("user-agent") userAgent?: string,
    @Ip() ip?: string
  ): Record<string, unknown> {
    if (!this.config.value.security.debugEnabled) {
      return { enabled: false };
    }

    this.detectorTrace.recordEvent(payload, { ip, origin, userAgent });
    return { enabled: true };
  }
}
