import { Controller, Get, Post, Param, Query, Req, Res, Body, Headers } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import { classicQuizContentId, extractClassicQuizId, parseNewQuizContentId } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { apiError } from "../http/api-error.js";
import { absoluteUrl, sebSchemeUrl } from "../http/request-url.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";
import { CanvasApiService } from "../services/canvas-api.service.js";
import { ContentService } from "../services/content.service.js";
import { LtiService } from "../services/lti.service.js";
import { LtiStateService } from "../services/lti-state.service.js";
import { QuizService } from "../services/quiz.service.js";
import { SebAccessProofService } from "../services/seb-access-proof.service.js";
import { SebConfigKeyService } from "../services/seb-config-key.service.js";
import { SebConfigurationService } from "../services/seb-configuration.service.js";
import { SebDetector } from "../services/seb-detector.service.js";

@Controller()
export class SebController {
  constructor(
    private readonly config: AppConfig,
    private readonly ltiService: LtiService,
    private readonly ltiState: LtiStateService,
    private readonly quizService: QuizService,
    private readonly contentService: ContentService,
    private readonly canvasApi: CanvasApiService,
    private readonly sebDetector: SebDetector,
    private readonly sebConfig: SebConfigurationService,
    private readonly configKey: SebConfigKeyService,
    private readonly proofService: SebAccessProofService
  ) {}

  @Get("/seb/quiz/:courseId/:quizId")
  async enforceQuiz(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Query("canvas_url") canvasUrl?: string,
    @Query("user_id") userId?: string
  ): Promise<void> {
    const setting = await this.quizService.getSebSettingForQuiz(quizId);
    if (!setting?.sebRequired || this.sebDetector.isRequestFromSeb(request, setting)) {
      response.redirect(resolveClassicCanvasUrl(this.config, courseId, quizId, canvasUrl, undefined));
      return;
    }
    const configPath = sebConfigPath(courseId, quizId, canvasUrl, userId);
    response.send(
      renderAppShell({
        title: "Safe Exam Browser Required",
        view: "seb-required",
        initialData: {
          courseId,
          quizId,
          userId,
          canvasUrl,
          configUrl: configPath,
          sebConfigUrl: configPath,
          sebLaunchUrl: sebSchemeUrl(request, configPath, this.config.getApplicationBaseUrl())
        }
      })
    );
  }

  @Get("/seb/config/:courseId/:contentId.seb")
  async downloadConfig(
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("contentId") contentId: string,
    @Query("canvas_url") canvasUrl?: string
  ): Promise<void> {
    try {
      const generated = await this.generateConfig(courseId, contentId, canvasUrl);
      response
        .status(200)
        .type("application/octet-stream")
        .setHeader(
          "content-disposition",
          `attachment; filename="quiz_${sanitizeFileToken(courseId)}_${sanitizeFileToken(contentId)}.seb"`
        )
        .setHeader("content-description", "Safe Exam Browser Configuration")
        .setHeader("x-content-type-options", "nosniff")
        .setHeader("content-transfer-encoding", "binary")
        .setHeader("accept-ranges", "bytes")
        .send(generated);
    } catch (error) {
      response.status(400).send(`Error generating SEB configuration: ${errorMessage(error)}`);
    }
  }

  @Get("/seb/config/:courseId/:quizId")
  redirectConfig(
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): void {
    response.redirect(302, `/seb/config/${courseId}/${quizId}.seb`);
  }

  @Post("/seb/launch/:contentId")
  async launchPost(
    @Req() request: Request,
    @Res() response: Response,
    @Param("contentId") contentId: string,
    @Body() body: Record<string, string>
  ): Promise<void> {
    await this.handleSebLaunch(request, response, contentId, body.id_token, body.state);
  }

  @Get("/seb/launch/:contentId")
  async launchGet(
    @Req() request: Request,
    @Res() response: Response,
    @Param("contentId") contentId: string
  ): Promise<void> {
    await this.handleSebLaunch(request, response, contentId);
  }

  @Get("/seb/launch/:contentId/login")
  launchLogin(
    @Res() response: Response,
    @Param("contentId") _contentId: string,
    @Query() query: Record<string, string>
  ): void {
    const params = new URLSearchParams(query);
    response.redirect(`/lti/login?${params.toString()}`);
  }

  @Get("/seb/redirect/:quizId")
  async redirectQuiz(
    @Req() request: Request,
    @Res() response: Response,
    @Param("quizId") quizId: string,
    @Query("userId") userId?: string
  ): Promise<void> {
    const quiz = await this.quizService.getQuiz(quizId);
    if (!quiz) {
      response.status(404).send(renderFallbackHtml("Quiz Not Found", "<h1>Quiz not found</h1>"));
      return;
    }
    const setting = await this.quizService.getSebSettingForQuiz(quizId);
    if (!setting?.sebRequired) {
      response.redirect(quiz.htmlUrl || this.config.getCanvasDomain());
      return;
    }
    if (this.sebDetector.isRequestFromSeb(request, setting)) {
      const resolvedUserId = userId || request.session?.canvas_user_id;
      const sessionUrl = resolvedUserId
        ? await this.canvasApi.getSessionToken(resolvedUserId, quiz.htmlUrl || "")
        : null;
      response.redirect(sessionUrl || quiz.htmlUrl || this.config.getCanvasDomain());
      return;
    }
    response.send(
      renderAppShell({
        title: "Safe Exam Browser Required",
        view: "seb-required",
        initialData: {
          courseId: quiz.courseId,
          quizId,
          configUrl: `/seb/config/${quiz.courseId}/${quizId}.seb`,
          sebConfigUrl: `/seb/config/${quiz.courseId}/${quizId}.seb`
        }
      })
    );
  }

  @Get("/seb/config/:quizId")
  async legacyConfigRedirect(@Res() response: Response, @Param("quizId") quizId: string): Promise<void> {
    const quiz = await this.quizService.getQuiz(quizId);
    if (!quiz?.courseId) {
      response.status(400).send("Quiz course ID is missing");
      return;
    }
    response.redirect(302, `/seb/config/${quiz.courseId}/${quizId}.seb`);
  }

  @Post("/seb/validate")
  async validateSeb(@Req() request: Request, @Body() body: Record<string, string>): Promise<Record<string, unknown>> {
    const quizId = body.quiz_id;
    const browserExamKey = body.browser_exam_key;
    if (!quizId || !browserExamKey) {
      return { valid: false, error: "Missing required parameters" };
    }
    const setting = await this.quizService.getSebSettingForQuiz(quizId);
    if (!setting) {
      return { valid: false, error: "No SEB settings found for quiz" };
    }
    const valid = this.sebDetector.validateBrowserExamKey(browserExamKey, setting.browserExamKey);
    return valid ? { valid: true } : { valid: false, error: "Invalid Browser Exam Key" };
  }

  @Get("/seb/check")
  async checkSeb(@Req() request: Request, @Query("quizId") quizId: string): Promise<Record<string, unknown>> {
    const setting = await this.quizService.getSebSettingForQuiz(quizId);
    const sebRequired = !!setting?.sebRequired;
    return {
      seb_required: sebRequired,
      using_seb: sebRequired ? this.sebDetector.isRequestFromSeb(request, setting) : true,
      ...(sebRequired ? { config_url: `/seb/config/${quizId}` } : {})
    };
  }

  @Post("/api/seb/access-proof/:courseId/:quizId")
  async createAccessProof(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Body() body?: { configKeyHash?: string; url?: string }
  ): Promise<Record<string, unknown>> {
    const setting = await this.resolveSebSetting(courseId, quizId);
    if (!setting || !setting.sebRequired || !setting.enabled || !setting.accessCode) {
      return apiError(404, "No SEB setting found for this quiz");
    }
    if (!setting.configKey) {
      return apiError(409, "SEB configuration must be downloaded before access-code proof can be issued");
    }
    const valid =
      this.configKey.validateConfigKeyHashForUrl(body?.configKeyHash, body?.url, setting.configKey) ||
      this.configKey.validateConfigKeyHash(request, setting.configKey);
    if (!valid) {
      return apiError(403, "Invalid SEB configuration proof");
    }
    return {
      success: true,
      proofToken: this.proofService.mintProof(courseId, quizId),
      expiresInSeconds: this.proofService.getTokenTtlSeconds()
    };
  }

  @Get("/api/seb/access-code/:courseId/:quizId")
  async accessCode(
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Headers("x-seb-proof-token") proofToken?: string
  ): Promise<Record<string, unknown>> {
    if (!this.proofService.consumeProof(proofToken, courseId, quizId)) {
      return apiError(403, "Invalid or expired SEB access proof");
    }
    const setting = await this.resolveSebSetting(courseId, quizId);
    if (!setting || (setting.courseId && setting.courseId !== courseId)) {
      return apiError(404, "No SEB setting found for this quiz");
    }
    if (!setting.sebRequired || !setting.enabled) {
      return { success: false, message: "SEB not required for this quiz" };
    }
    if (!setting.accessCode) {
      return { success: false, message: "No access code configured for this quiz" };
    }
    return { success: true, accessCode: setting.accessCode };
  }

  @Get("/seb/exit/:courseId/:quizId")
  async exitPage(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Query("userId") userId?: string,
    @Query("mode") mode?: string
  ): Promise<void> {
    const exitPageUrl = absoluteUrl(request, `/seb/exit/${courseId}/${quizId}`, this.config.getApplicationBaseUrl());
    const quitUrl = absoluteUrl(
      request,
      `/seb/exit/quit/${courseId}/${quitPathId(quizId)}`,
      this.config.getApplicationBaseUrl()
    );
    response.send(
      renderAppShell({
        title: "Quiz Completed",
        view: "seb-exit",
        initialData: {
          courseId,
          quizId,
          userId,
          exitPageUrl,
          quitUrl,
          legacyQuitUrl: quitUrl,
          manualQuitUrl: absoluteUrl(
            request,
            `/seb/exit/manual/${courseId}/${quitPathId(quizId)}`,
            this.config.getApplicationBaseUrl()
          ),
          exitMode: mode || "manual"
        }
      })
    );
  }

  @Get(["/seb/exit/quit/:courseId/:quizId", "/seb/exit/manual/:courseId/:quizId"])
  quit(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): void {
    const quitUrl = absoluteUrl(
      request,
      `/seb/exit/quit/${courseId}/${quitPathId(quizId)}`,
      this.config.getApplicationBaseUrl()
    );
    response
      .setHeader("x-seb-quit", "true")
      .setHeader("x-seb-exit", request.path.includes("/manual/") ? "manual" : "automatic")
      .send(
        renderAppShell({
          title: "Safe Exam Browser Closing",
          view: "seb-quit",
          initialData: { courseId, quizId, quitUrl, legacyQuitUrl: quitUrl }
        })
      );
  }

  @Get("/seb/exit/api/:courseId/:quizId/urls")
  async exitUrls(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const setting = await this.quizService.getSebSettingForQuiz(quitPathId(quizId));
    return {
      exitPageUrl: absoluteUrl(request, `/seb/exit/${courseId}/${quizId}`, this.config.getApplicationBaseUrl()),
      quitUrl: absoluteUrl(
        request,
        `/seb/exit/quit/${courseId}/${quitPathId(quizId)}`,
        this.config.getApplicationBaseUrl()
      ),
      manualQuitUrl: absoluteUrl(
        request,
        `/seb/exit/manual/${courseId}/${quitPathId(quizId)}`,
        this.config.getApplicationBaseUrl()
      ),
      sebRequired: !!setting?.sebRequired
    };
  }

  private async handleSebLaunch(
    request: Request,
    response: Response,
    contentId: string,
    idToken?: string,
    state?: string
  ): Promise<void> {
    if (idToken) {
      try {
        const consumed = this.ltiState.consumeState(state);
        const launchData = await this.ltiService.validateToken(idToken, consumed.nonce);
        request.session!.launchData = launchData;
        request.session!.canvas_user_id = launchData.userId;
      } catch {
        response
          .status(400)
          .send(
            renderFallbackHtml(
              "Invalid LTI Launch",
              "<h1>Invalid LTI Launch</h1><p>Please launch this assessment from Canvas.</p>"
            )
          );
        return;
      }
    } else if (!request.session?.launchData) {
      response
        .status(403)
        .send(
          renderFallbackHtml(
            "Canvas Launch Required",
            "<h1>Canvas Launch Required</h1><p>Please open this assessment from Canvas before using Safe Exam Browser.</p>"
          )
        );
      return;
    }

    const resolved = await this.resolveContentForLaunch(contentId);
    if (!resolved) {
      response.status(404).send(renderFallbackHtml("Launch Content Not Found", "<h1>Launch content not found</h1>"));
      return;
    }
    if (!resolved.setting?.sebRequired || this.sebDetector.isRequestFromSeb(request, resolved.setting)) {
      response.redirect(resolved.launchTarget);
      return;
    }
    response.send(
      renderAppShell({
        title: "Safe Exam Browser Required",
        view: "seb-download",
        initialData: {
          content: resolved.content,
          contentTitle: resolved.content.title,
          contentType: resolved.content.contentType,
          courseId: resolved.content.courseId,
          contentId: resolved.content.id,
          configDownloadUrl: `/seb/config/${resolved.content.courseId}/${resolved.content.id}.seb`,
          sebConfigUrl: `/seb/config/${resolved.content.courseId}/${resolved.content.id}.seb`,
          sebLaunchUrl: sebSchemeUrl(
            request,
            `/seb/config/${resolved.content.courseId}/${resolved.content.id}.seb`,
            this.config.getApplicationBaseUrl()
          )
        }
      })
    );
  }

  private async generateConfig(courseId: string, contentId: string, canvasUrl?: string): Promise<Buffer> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const setting = await this.quizService.getSebSettingForQuiz(classicId);
      if (!setting?.sebRequired || !setting.accessCode) {
        throw new Error("SEB not enabled or access code missing");
      }
      const quiz = await this.quizService.getQuiz(classicId);
      const startUrl = resolveClassicCanvasUrl(this.config, courseId, classicId, canvasUrl, quiz?.htmlUrl);
      const generated = this.sebConfig.generateSebConfiguration({
        courseId,
        contentId: contentId.startsWith("classicquiz_") ? contentId : classicQuizContentId(classicId),
        startUrl,
        accessCode: setting.accessCode,
        allowedDomains: allowedDomains(setting),
        quitPassword: setting.quitPassword
      });
      await this.quizService.saveSebSetting({ ...setting, configKey: this.configKey.computeConfigKey(generated) });
      return generated;
    }

    const setting = await this.contentService.getSebSetting(contentId);
    if (!setting?.sebRequired || !setting.accessCode) {
      throw new Error("SEB not enabled or access code missing");
    }
    const startUrl = await this.resolveNewQuizStartUrl(courseId, contentId, setting);
    const generated = this.sebConfig.generateSebConfiguration({
      courseId,
      contentId,
      startUrl,
      accessCode: setting.accessCode,
      allowedDomains: allowedDomains(setting),
      quitPassword: setting.quitPassword
    });
    await this.contentService.saveSebSetting({ ...setting, configKey: this.configKey.computeConfigKey(generated) });
    return generated;
  }

  private async resolveContentForLaunch(
    contentId: string
  ): Promise<{ content: any; setting: QuizSebSetting | ContentSebSetting | null; launchTarget: string } | null> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.quizService.getQuiz(classicId);
      if (!quiz) {
        return null;
      }
      return {
        content: {
          id: classicQuizContentId(classicId),
          courseId: quiz.courseId,
          canvasId: classicId,
          contentType: "CLASSIC_QUIZ",
          title: quiz.title,
          htmlUrl: quiz.htmlUrl
        },
        setting: await this.quizService.getSebSettingForQuiz(classicId),
        launchTarget: quiz.htmlUrl || this.config.getCanvasDomain()
      };
    }
    const content = await this.contentService.getContentItem(contentId);
    const setting = await this.contentService.getSebSetting(contentId);
    if (!content && !setting) {
      return null;
    }
    return {
      content: content || {
        id: contentId,
        courseId: setting?.courseId,
        canvasId: setting?.canvasId,
        contentType: "NEW_QUIZ",
        title: "New Quiz",
        htmlUrl: setting?.htmlUrl,
        canvasLaunchUrl: setting?.canvasLaunchUrl
      },
      setting,
      launchTarget:
        content?.htmlUrl ||
        content?.canvasLaunchUrl ||
        setting?.htmlUrl ||
        setting?.canvasLaunchUrl ||
        this.config.getCanvasDomain()
    };
  }

  private async resolveNewQuizStartUrl(
    courseId: string,
    contentId: string,
    setting: ContentSebSetting
  ): Promise<string> {
    const content = await this.contentService.getContentItem(contentId);
    const candidates = [content?.htmlUrl, setting.htmlUrl, content?.canvasLaunchUrl, setting.canvasLaunchUrl];
    for (const candidate of candidates) {
      if (candidate && isConfiguredCanvasUrl(this.config, candidate)) {
        return candidate;
      }
    }
    const assignmentId = setting.assignmentId || setting.canvasId || parseNewQuizContentId(contentId)?.assignmentId;
    if (!assignmentId) {
      throw new Error("Unable to determine Canvas start URL");
    }
    return `${this.config.getCanvasDomain()}/courses/${courseId}/assignments/${assignmentId}`;
  }

  private async resolveSebSetting(
    _courseId: string,
    quizId: string
  ): Promise<(QuizSebSetting | ContentSebSetting) | null> {
    if (quizId.startsWith("newquiz:")) {
      return this.contentService.getSebSetting(quizId);
    }
    const parsed = parseNewQuizContentId(quizId);
    if (parsed) {
      return this.contentService.getSebSetting(quizId);
    }
    return this.quizService.getSebSettingForQuiz(quizId);
  }
}

function resolveClassicCanvasUrl(
  config: AppConfig,
  courseId: string,
  quizId: string,
  canvasUrl?: string,
  storedUrl?: string | null
): string {
  const candidates = [canvasUrl, storedUrl];
  for (const candidate of candidates) {
    const decoded = decodeValue(candidate);
    if (decoded && isConfiguredCanvasUrl(config, decoded)) {
      return decoded;
    }
  }
  return `${config.getCanvasDomain()}/courses/${courseId}/quizzes/${quizId}`;
}

function isConfiguredCanvasUrl(config: AppConfig, value: string): boolean {
  try {
    const candidate = new URL(value);
    const canvas = new URL(config.getCanvasDomain());
    return candidate.protocol === "https:" && candidate.hostname.toLowerCase() === canvas.hostname.toLowerCase();
  } catch {
    return false;
  }
}

function allowedDomains(setting: QuizSebSetting | ContentSebSetting): string[] {
  return [...(setting.ssoDomains || []), ...(setting.educationalToolDomains || []), ...(setting.customDomains || [])];
}

function decodeValue(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function quitPathId(value: string): string {
  return value.startsWith("classicquiz_") ? value.slice("classicquiz_".length) : value;
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function sebConfigPath(courseId: string, contentId: string, canvasUrl?: string, userId?: string): string {
  const params = new URLSearchParams();
  if (canvasUrl) {
    params.set("canvas_url", canvasUrl);
  }
  if (userId) {
    params.set("user_id", userId);
  }
  const query = params.toString();
  return `/seb/config/${encodeURIComponent(courseId)}/${encodeURIComponent(contentId)}.seb${query ? `?${query}` : ""}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
