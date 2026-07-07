import { Body, Controller, Get, Headers, Ip, Param, Post, Query } from "@nestjs/common";
import { AppConfig } from "../config/app-config.js";
import { CanvasApiService } from "../services/canvas-api.service.js";
import { DetectorTraceService } from "../services/detector-trace.service.js";
import { QuizService } from "../services/quiz.service.js";

@Controller(["/api/debug", "/api/diagnostic"])
export class DebugController {
  constructor(
    private readonly config: AppConfig,
    private readonly canvasApi: CanvasApiService,
    private readonly quizService: QuizService,
    private readonly detectorTrace: DetectorTraceService
  ) {}

  @Get("/debug-status")
  debugStatus(): Record<string, unknown> {
    return {
      enabled: this.config.value.security.debugEnabled,
      profile: this.config.profile
    };
  }

  @Get("/environment")
  environment(): Record<string, unknown> {
    if (!this.config.value.security.debugEnabled) {
      return { enabled: false };
    }
    return {
      enabled: true,
      profile: this.config.profile,
      projectId: this.config.value.projectId,
      firestoreDatabaseId: this.config.value.firestoreDatabaseId,
      canvasDomain: this.config.getCanvasDomain(),
      toolUrlConfigured: !!this.config.toolUrl,
      ltiClientIdConfigured: !!this.config.value.lti.clientId
    };
  }

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

  @Get("/quizzes/:courseId")
  async quizzes(@Param("courseId") courseId: string, @Query("user_id") userId?: string): Promise<unknown> {
    if (!this.config.value.security.debugEnabled || !userId) {
      return { enabled: false };
    }
    return this.quizService.getQuizzesForCourse(courseId, userId, true);
  }

  @Get("/test-oauth/:userId")
  async oauth(@Param("userId") userId: string): Promise<Record<string, unknown>> {
    if (!this.config.value.security.debugEnabled) {
      return { enabled: false };
    }
    return { userId, hasAccessToken: await this.canvasApi.hasAccessToken(userId) };
  }

  @Get("/clear-oauth-token")
  @Post("/clear-oauth-token")
  async clearOauth(@Query("user_id") userId?: string): Promise<Record<string, unknown>> {
    if (!this.config.value.security.debugEnabled || !userId) {
      return { success: false };
    }
    await this.canvasApi.clearAccessToken(userId);
    return { success: true };
  }

  @Get([
    "/scopes",
    "/scopes/search",
    "/scopes/recommended",
    "/jwt",
    "/test-scopes",
    "/test-api/:courseId",
    "/test-lti-login",
    "/beans",
    "/seb-test",
    "/test-new-quiz-url"
  ])
  placeholder(): Record<string, unknown> {
    return {
      enabled: this.config.value.security.debugEnabled,
      message: this.config.value.security.debugEnabled
        ? "Diagnostic endpoint available in TypeScript rewrite"
        : "Debug endpoints disabled"
    };
  }
}
