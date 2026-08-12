import { Body, Controller, Headers, HttpException, HttpStatus, Post } from "@nestjs/common";
import { AppConfig } from "../config/app-config.js";
import { DetectorTraceService } from "../services/detector-trace.service.js";

@Controller("/api/debug")
export class DebugController {
  private readonly requestsByWindow = new Map<string, { count: number; startedAt: number }>();

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

    if (!this.config.value.testbed.enabled || !isExpectedOrigin(origin, this.config.getCanvasDomain())) {
      return { enabled: false };
    }

    this.enforceRateLimit(origin!);

    this.detectorTrace.recordEvent(payload, { origin, includeDetails: diagnosticsEnabled });
    return { enabled: true };
  }

  private enforceRateLimit(origin: string): void {
    const now = Date.now();
    const current = this.requestsByWindow.get(origin);
    if (!current || now - current.startedAt >= 60_000) {
      this.requestsByWindow.set(origin, { count: 1, startedAt: now });
      return;
    }
    current.count += 1;
    if (current.count > 120) {
      throw new HttpException({ enabled: false }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function isExpectedOrigin(origin: string | undefined, canvasDomain: string): boolean {
  try {
    return !!origin && new URL(origin).origin === new URL(canvasDomain).origin && origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
