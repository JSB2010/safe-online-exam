import { Controller, Get, Post, Param, Query, Req, Res, Body, Headers } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import {
  allowlistEntriesForExternalTools,
  classicQuizContentId,
  enabledExternalTools,
  extractClassicQuizId,
  parseNewQuizContentId,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { apiError } from "../http/api-error.js";
import { absoluteUrl, sebSchemeUrl } from "../http/request-url.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";
import { AssessmentService } from "../services/assessment.service.js";
import { LtiService } from "../services/lti.service.js";
import { LtiStateService } from "../services/lti-state.service.js";
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
    private readonly assessments: AssessmentService,
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
    const setting = await this.assessments.getSebSettingForQuiz(quizId);
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

  @Get("/seb/config-encryption-certificate.pem")
  downloadConfigEncryptionCertificatePem(@Res() response: Response): void {
    const certificate = this.sebConfig.getEncryptionCertificate();
    if (!certificate) {
      response.status(404).send("SEB config encryption certificate is not configured");
      return;
    }
    response
      .status(200)
      .type("application/x-pem-file")
      .setHeader("content-disposition", 'attachment; filename="seb-config-encryption-certificate.pem"')
      .setHeader("x-seb-public-key-hash", certificate.publicKeyHash.toString("hex"))
      .send(certificate.pem);
  }

  @Get("/seb/config-encryption-certificate.cer")
  downloadConfigEncryptionCertificateDer(@Res() response: Response): void {
    const certificate = this.sebConfig.getEncryptionCertificate();
    if (!certificate) {
      response.status(404).send("SEB config encryption certificate is not configured");
      return;
    }
    response
      .status(200)
      .type("application/pkix-cert")
      .setHeader("content-disposition", 'attachment; filename="seb-config-encryption-certificate.cer"')
      .setHeader("x-seb-public-key-hash", certificate.publicKeyHash.toString("hex"))
      .send(certificate.der);
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

  @Get("/seb/config/:quizId")
  async legacyConfigRedirect(@Res() response: Response, @Param("quizId") quizId: string): Promise<void> {
    const quiz = await this.assessments.getQuiz(quizId);
    if (!quiz?.courseId) {
      response.status(400).send("Quiz course ID is missing");
      return;
    }
    response.redirect(302, `/seb/config/${quiz.courseId}/${quizId}.seb`);
  }

  @Get("/api/seb/tools/:courseId/:quizId")
  async tools(@Param("courseId") courseId: string, @Param("quizId") quizId: string): Promise<Record<string, unknown>> {
    const setting = await this.resolveSebSetting(courseId, quizId);
    if (!setting?.sebRequired || !setting.enabled) {
      return { success: true, tools: [] };
    }
    return {
      success: true,
      tools: enabledExternalTools(setting.externalTools).map((tool) => ({
        id: tool.id,
        label: tool.label,
        url: tool.url
      }))
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
      return apiError(
        409,
        "No valid SEB configuration is registered for this quiz. Download a fresh SEB configuration from Canvas and reopen the quiz.",
        { error_code: "SEB_CONFIG_NOT_REGISTERED" }
      );
    }
    const expectedConfigKey = await this.currentConfigKey(courseId, quizId, setting);
    const valid =
      this.configKey.validateConfigKeyHashForUrl(body?.configKeyHash, body?.url, expectedConfigKey) ||
      this.configKey.validateConfigKeyHash(request, expectedConfigKey);
    if (!valid) {
      console.warn(
        "SEB access proof rejected",
        JSON.stringify({
          courseId,
          quizId,
          hasBodyProof: !!body?.configKeyHash,
          hasHeaderProof: !!firstHeader(request, [
            "x-safeexambrowser-configkeyhash",
            "x-seb-config-key-hash",
            "x-config-key-hash",
            "x-safeexambrowser-requesthash"
          ]),
          canvasUrl: !!body?.url && isConfiguredCanvasUrl(this.config, body.url),
          quizUrl: !!body?.url && isExpectedQuizUrl(this.config, body.url, courseId, quizId),
          sebUserAgent: /SafeExamBrowser|SEB\/|SEB;/iu.test(request.header("user-agent") || "")
        })
      );
      return apiError(
        403,
        "This SEB configuration could not be verified. It may be stale, incorrect, or modified. Download a fresh SEB configuration from Canvas and reopen the quiz.",
        { error_code: "INVALID_SEB_CONFIG_PROOF" }
      );
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
      let setting = await this.assessments.getSebSettingForQuiz(classicId);
      if (!setting?.sebRequired || !setting.accessCode) {
        throw new Error("SEB not enabled or access code missing");
      }
      if (setting.startPassword && !setting.configKeySalt) {
        setting = await this.assessments.saveQuizSebSetting(setting);
      }
      const accessCode = setting.accessCode;
      if (!accessCode) {
        throw new Error("SEB not enabled or access code missing");
      }
      const quiz = await this.assessments.getQuiz(classicId);
      const startUrl = resolveClassicCanvasUrl(this.config, courseId, classicId, canvasUrl, quiz?.htmlUrl);
      const generated = this.sebConfig.generateSebConfiguration({
        courseId,
        contentId: contentId.startsWith("classicquiz_") ? contentId : classicQuizContentId(classicId),
        startUrl,
        accessCode,
        allowedDomains: allowedDomains(setting),
        quitPassword: setting.quitPassword,
        startPassword: setting.startPassword,
        configKeySalt: setting.configKeySalt
      });
      await this.assessments.saveQuizSebSetting({ ...setting, configKey: this.configKey.computeConfigKey(generated) });
      return this.sebConfig.prepareSebConfigurationDownload(generated, { startPassword: setting.startPassword });
    }

    let setting = await this.assessments.getContentSebSetting(contentId);
    if (!setting?.sebRequired || !setting.accessCode) {
      throw new Error("SEB not enabled or access code missing");
    }
    if (setting.startPassword && !setting.configKeySalt) {
      setting = await this.assessments.saveContentSebSetting(setting);
    }
    const accessCode = setting.accessCode;
    if (!accessCode) {
      throw new Error("SEB not enabled or access code missing");
    }
    const startUrl = await this.resolveNewQuizStartUrl(courseId, contentId, setting);
    const generated = this.sebConfig.generateSebConfiguration({
      courseId,
      contentId,
      startUrl,
      accessCode,
      allowedDomains: allowedDomains(setting),
      quitPassword: setting.quitPassword,
      startPassword: setting.startPassword,
      configKeySalt: setting.configKeySalt
    });
    await this.assessments.saveContentSebSetting({ ...setting, configKey: this.configKey.computeConfigKey(generated) });
    return this.sebConfig.prepareSebConfigurationDownload(generated, { startPassword: setting.startPassword });
  }

  private async currentConfigKey(
    courseId: string,
    contentId: string,
    setting: QuizSebSetting | ContentSebSetting
  ): Promise<string> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.assessments.getQuiz(classicId);
      const startUrl = resolveClassicCanvasUrl(this.config, courseId, classicId, undefined, quiz?.htmlUrl);
      const generated = this.sebConfig.generateSebConfiguration({
        courseId,
        contentId: contentId.startsWith("classicquiz_") ? contentId : classicQuizContentId(classicId),
        startUrl,
        accessCode: setting.accessCode || "",
        allowedDomains: allowedDomains(setting),
        quitPassword: setting.quitPassword,
        startPassword: setting.startPassword,
        configKeySalt: setting.configKeySalt
      });
      return this.configKey.computeConfigKey(generated);
    }

    const startUrl = await this.resolveNewQuizStartUrl(courseId, contentId, setting as ContentSebSetting);
    const generated = this.sebConfig.generateSebConfiguration({
      courseId,
      contentId,
      startUrl,
      accessCode: setting.accessCode || "",
      allowedDomains: allowedDomains(setting),
      quitPassword: setting.quitPassword,
      startPassword: setting.startPassword,
      configKeySalt: setting.configKeySalt
    });
    return this.configKey.computeConfigKey(generated);
  }

  private async resolveContentForLaunch(
    contentId: string
  ): Promise<{ content: any; setting: QuizSebSetting | ContentSebSetting | null; launchTarget: string } | null> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.assessments.getQuiz(classicId);
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
        setting: await this.assessments.getSebSettingForQuiz(classicId),
        launchTarget: quiz.htmlUrl || this.config.getCanvasDomain()
      };
    }
    const content = await this.assessments.getContentItem(contentId);
    const setting = await this.assessments.getContentSebSetting(contentId);
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
    const content = await this.assessments.getContentItem(contentId);
    const candidates = [content?.htmlUrl, setting.htmlUrl, content?.canvasLaunchUrl, setting.canvasLaunchUrl];
    for (const candidate of candidates) {
      if (candidate && isConfiguredCanvasUrl(this.config, candidate)) {
        return canonicalCanvasAssignmentTakeUrl(this.config, courseId, candidate);
      }
    }
    const assignmentId = setting.assignmentId || setting.canvasId || parseNewQuizContentId(contentId)?.assignmentId;
    if (!assignmentId) {
      throw new Error("Unable to determine Canvas start URL");
    }
    return `${this.config.getCanvasDomain()}/courses/${courseId}/assignments/${assignmentId}/take`;
  }

  private async resolveSebSetting(
    _courseId: string,
    quizId: string
  ): Promise<(QuizSebSetting | ContentSebSetting) | null> {
    if (quizId.startsWith("newquiz:")) {
      return this.assessments.getContentSebSetting(quizId);
    }
    const parsed = parseNewQuizContentId(quizId);
    if (parsed) {
      return this.assessments.getContentSebSetting(quizId);
    }
    return this.assessments.getSebSettingForQuiz(quizId);
  }
}

function resolveClassicCanvasUrl(
  config: AppConfig,
  courseId: string,
  quizId: string,
  _canvasUrl?: string,
  _storedUrl?: string | null
): string {
  return `${config.getCanvasDomain()}/courses/${courseId}/quizzes/${quizId}/take`;
}

function canonicalCanvasAssignmentTakeUrl(config: AppConfig, courseId: string, value: string): string {
  const url = new URL(value);
  const assignmentMatch = url.pathname.match(/^\/courses\/([^/]+)\/assignments\/([^/?#]+)(?:\/take)?\/?$/u);
  if (!assignmentMatch) {
    url.hash = "";
    url.searchParams.delete("user_id");
    url.searchParams.delete("attempt");
    return url.toString();
  }
  return `${config.getCanvasDomain()}/courses/${courseId}/assignments/${assignmentMatch[2]}/take`;
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
  const customEntries = setting.urlRules?.length
    ? urlRulesToAllowedEntries(setting.urlRules)
    : setting.customDomains || [];
  return Array.from(
    new Set([
      ...(setting.ssoDomains || []),
      ...(setting.educationalToolDomains || []),
      ...customEntries,
      ...allowlistEntriesForExternalTools(setting.externalTools)
    ])
  );
}

function firstHeader(request: Request, names: string[]): string | undefined {
  for (const name of names) {
    const value = request.header(name);
    if (value) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function isExpectedQuizUrl(config: AppConfig, value: string, courseId: string, quizId: string): boolean {
  try {
    if (!isConfiguredCanvasUrl(config, value)) {
      return false;
    }
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/u, "");
    if (quizId.startsWith("newquiz:")) {
      const parsed = parseNewQuizContentId(quizId);
      return !!parsed && path.startsWith(`/courses/${courseId}/assignments/${parsed.assignmentId}`);
    }
    return path.startsWith(`/courses/${courseId}/quizzes/${quizId}`);
  } catch {
    return false;
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
