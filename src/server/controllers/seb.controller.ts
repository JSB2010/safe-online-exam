import { Controller, Get, Head, Post, Param, Query, Req, Res, Body, Headers } from "@nestjs/common";
import type { Request, Response } from "express";
import { regenerateSession, saveSession } from "../http/session-lifecycle.js";
import type { ContentSebSetting, ExternalToolConfig, QuizSebSetting } from "../../shared/models.js";
import { parseNewQuizContentId } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { apiError } from "../http/api-error.js";
import { createSebConfigGrantActionToken } from "../http/action-token.js";
import { absoluteUrl, sebSchemeUrl } from "../http/request-url.js";
import { requireSebConfigGrantRequestIntegrity } from "../http/request-integrity.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";
import {
  setPrivateNoStoreResponseHeaders,
  setSebDownloadResponseHeaders,
  setSensitiveSebResponseHeaders
} from "../http/response-headers.js";
import { createVerifiedLtiPrincipal, verifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import type { VerifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import { consumePublicBudget } from "../security/public-admission.js";
import { DistributedAdmissionService, hasBoundedLtiValidationEnvelope } from "../security/distributed-admission.js";
import {
  clearLtiOidcBrowserTransactionCookie,
  matchingLtiOidcBrowserTransactionCookie
} from "../security/lti-oidc-browser-binding.js";
import { AssessmentService } from "../services/assessment.service.js";
import { LtiService } from "../services/lti.service.js";
import { LtiStateService } from "../services/lti-state.service.js";
import { SebAccessProofService } from "../services/seb-access-proof.service.js";
import {
  canonicalSebConfigContentId,
  sameSebConfigSettingsFingerprint,
  SebConfigGrantRateLimitError,
  SebConfigGrantService
} from "../services/seb-config-grant.service.js";
import { SebConfigKeyService } from "../services/seb-config-key.service.js";
import { SebConfigurationService } from "../services/seb-configuration.service.js";
import { SebDetector } from "../services/seb-detector.service.js";
import {
  CanvasApiAuthorizationError,
  CanvasApiPermissionError,
  CanvasApiService
} from "../services/canvas-api.service.js";
import { SebSessionHandoffService } from "../services/seb-session-handoff.service.js";
import {
  configGrantEndpoint,
  consumePendingSebLaunch,
  firstHeader,
  isConfiguredCanvasUrl,
  isDirectLtiLaunchReplay,
  isExpectedQuizUrl,
  isExpectedSetupCheckUrl,
  isSafeConfigNavigation,
  normalizedPublicSebContentId,
  proofGenerationDigest,
  renderYouTubeToolPage,
  requiresStudentSessionHandoff,
  resolveClassicCanvasUrl,
  sanitizeFileToken,
  sebConfigPath
} from "./seb-controller-helpers.js";
import {
  SebContentCoordinator,
  type SebConfigGrantTarget,
  type SebLaunchContentView
} from "./seb-content-coordinator.js";

@Controller()
export class SebController {
  private readonly contentCoordinator: SebContentCoordinator;
  private setupCheckConfigCache?: Promise<Buffer>;
  constructor(
    private readonly config: AppConfig,
    private readonly ltiService: LtiService,
    private readonly ltiState: LtiStateService,
    private readonly assessments: AssessmentService,
    private readonly sebDetector: SebDetector,
    private readonly sebConfig: SebConfigurationService,
    private readonly configKey: SebConfigKeyService,
    private readonly proofService: SebAccessProofService,
    private readonly configGrants: SebConfigGrantService,
    private readonly distributedAdmission: DistributedAdmissionService,
    private readonly canvasApi?: CanvasApiService,
    private readonly sessionHandoff?: SebSessionHandoffService
  ) {
    this.contentCoordinator = new SebContentCoordinator(
      config,
      assessments,
      sebConfig,
      configKey,
      canvasApi,
      sessionHandoff
    );
  }

  @Get("/seb/quiz/:courseId/:quizId")
  async enforceQuiz(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Query("canvas_url") canvasUrl?: string,
    @Query("user_id") userId?: string
  ): Promise<void> {
    const principal = verifiedLtiPrincipal(request);
    const normalizedQuizId = normalizedPublicSebContentId(quizId);
    if (!principal || principal.courseId !== courseId || !normalizedQuizId || parseNewQuizContentId(normalizedQuizId)) {
      response
        .status(403)
        .send("Launch this assessment from Canvas before downloading its Safe Online Exam configuration.");
      return;
    }
    const setting = await this.assessments.getSebSettingForQuiz(normalizedQuizId);
    if (!setting?.sebRequired || this.sebDetector.isRequestFromSeb(request, setting)) {
      response.redirect(resolveClassicCanvasUrl(this.config, courseId, normalizedQuizId, canvasUrl, undefined));
      return;
    }
    const canonicalContentId = canonicalSebConfigContentId(normalizedQuizId);
    if (!canonicalContentId) {
      response.status(404).send("Assessment not found");
      return;
    }
    const configPath = configGrantEndpoint(courseId, canonicalContentId);
    response.send(
      renderAppShell({
        title: "Safe Exam Browser Required",
        view: "seb-required",
        initialData: {
          courseId,
          quizId: normalizedQuizId,
          userId,
          canvasUrl,
          browserReturnUrl: this.canvasCourseHomeUrl(courseId),
          configGrantUrl: configPath,
          configGrantToken: this.configGrantActionToken(request, principal)
        }
      })
    );
  }

  @Post("/api/seb/config-grant/:courseId/:contentId")
  async issueConfigGrant(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("contentId") contentId: string
  ): Promise<Record<string, unknown>> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal || principal.courseId !== courseId) {
      return apiError(403, "Verified Canvas launch required", { error_code: "LTI_PRINCIPAL_REQUIRED" });
    }
    requireSebConfigGrantRequestIntegrity(request, this.config, principal);
    if (requiresStudentSessionHandoff(principal)) {
      if (!this.canvasApi || !(await this.canvasApi.hasSessionTokenAccess(principal.canvasUserId))) {
        return apiError(403, "Canvas connection is required before opening Safe Online Exam.", {
          error_code: "CANVAS_SESSION_AUTHORIZATION_REQUIRED"
        });
      }
    }
    try {
      const target = await this.resolveCurrentConfigGrantTarget(courseId, contentId);
      if (!target) {
        return apiError(404, "Safe Online Exam configuration is unavailable");
      }
      const grant = await this.configGrants.mintGrant(
        request,
        principal,
        courseId,
        target.canonicalContentId,
        target.settingsFingerprint
      );
      if (!(await this.finalizeCourseScopedGrant(courseId, target, () => this.configGrants.revokeGrant(grant)))) {
        return apiError(404, "Safe Online Exam configuration is unavailable");
      }
      const configPath = sebConfigPath(courseId, target.canonicalContentId, grant);
      return {
        success: true,
        sebLaunchUrl: sebSchemeUrl(request, configPath, this.config.getApplicationBaseUrl()),
        expiresInSeconds: this.configGrants.getTokenTtlSeconds()
      };
    } catch (error) {
      if (error instanceof SebConfigGrantRateLimitError) {
        return apiError(429, "Too many configuration requests", { error_code: "RATE_LIMITED" });
      }
      throw error;
    }
  }

  @Post("/api/seb/session-readiness")
  async verifyStudentSessionReadiness(@Req() request: Request): Promise<Record<string, unknown>> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal || !requiresStudentSessionHandoff(principal)) {
      return apiError(403, "Verified student Canvas launch required", { error_code: "LTI_STUDENT_REQUIRED" });
    }
    requireSebConfigGrantRequestIntegrity(request, this.config, principal);
    if (!this.canvasApi) {
      return apiError(503, "Canvas session handoff is unavailable", { error_code: "CANVAS_SESSION_UNAVAILABLE" });
    }
    try {
      // Do not expose or retain the returned URL. A successful response proves
      // the student token can create the same Canvas session link used at exam
      // configuration download time.
      await this.canvasApi.getSessionToken(principal.canvasUserId, this.canvasCourseHomeUrl(principal.courseId));
      return { success: true, checks: { canvasSessionAuthorization: true } };
    } catch (error) {
      if (error instanceof CanvasApiAuthorizationError || error instanceof CanvasApiPermissionError) {
        return apiError(403, "Canvas connection must be completed again before using Safe Online Exam.", {
          error_code: "CANVAS_SESSION_AUTHORIZATION_REQUIRED"
        });
      }
      return apiError(502, "Canvas could not verify the student session connection.", {
        error_code: "CANVAS_SESSION_READINESS_FAILED"
      });
    }
  }

  @Post("/api/seb/session-readiness/dismiss")
  async dismissStudentReadinessPrompt(@Req() request: Request): Promise<Record<string, unknown>> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal || !requiresStudentSessionHandoff(principal)) {
      return apiError(403, "Verified student Canvas launch required", { error_code: "LTI_STUDENT_REQUIRED" });
    }
    requireSebConfigGrantRequestIntegrity(request, this.config, principal);
    if (!this.canvasApi) {
      return apiError(503, "Canvas session handoff is unavailable", { error_code: "CANVAS_SESSION_UNAVAILABLE" });
    }
    // This is only a prompt preference. It is intentionally separate from the
    // readiness result and never grants durable device trust.
    await this.canvasApi.dismissStudentReadinessPrompt(principal.canvasUserId);
    return { success: true };
  }

  @Get("/seb/config/:courseId/:contentId.seb")
  async downloadConfig(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("contentId") contentId: string,
    @Query("grant") grant?: string
  ): Promise<void> {
    if (request.method?.toUpperCase() === "HEAD") {
      await this.inspectConfigDownload(response, courseId, contentId, grant);
      return;
    }
    if (
      !consumePublicBudget(request, "seb-config-download", 1_200) ||
      !(await this.distributedAdmission.consumeRequestIp(request, "seb-config-download-ip", 2_400))
    ) {
      response.status(429).setHeader("retry-after", "60").send("Too many configuration requests");
      return;
    }
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      response.status(403).setHeader("cache-control", "no-store").send("Invalid or expired configuration grant");
      return;
    }
    const consumedGrant = await this.configGrants.consumeGrant(grant, courseId, canonicalContentId);
    if (!consumedGrant) {
      response.status(403).setHeader("cache-control", "no-store").send("Invalid or expired configuration grant");
      return;
    }
    try {
      const target = await this.resolveCurrentConfigGrantTarget(courseId, canonicalContentId);
      if (!target || !sameSebConfigSettingsFingerprint(consumedGrant.settingsFingerprint, target.settingsFingerprint)) {
        response.status(403).setHeader("cache-control", "no-store").send("Invalid or expired configuration grant");
        return;
      }
      const generated = await this.generateConfigForGrant(
        courseId,
        canonicalContentId,
        target,
        consumedGrant.canvasUserId,
        consumedGrant.requiresSessionHandoff
      );
      const current = await this.finalizeCourseScopedGrant(courseId, target, async () => {
        await this.sessionHandoff?.revokeConfigs(generated.handoffDocumentIds);
      });
      if (!current) {
        response.status(403).setHeader("cache-control", "no-store").send("Invalid or expired configuration grant");
        return;
      }
      // Certificate validity may change while a configuration is in the short
      // single-flight cache. Recheck it before serving encrypted output.
      this.sebConfig.assertConfigurationDownloadReady();
      setSebDownloadResponseHeaders(response);
      response
        .status(200)
        .type("application/octet-stream")
        .setHeader(
          "content-disposition",
          `attachment; filename="quiz_${sanitizeFileToken(courseId)}_${sanitizeFileToken(canonicalContentId)}.seb"`
        )
        .setHeader("content-description", "Safe Online Exam Configuration")
        .send(generated.buffer);
    } catch (error) {
      if (error instanceof CanvasApiAuthorizationError || error instanceof CanvasApiPermissionError) {
        response
          .status(403)
          .setHeader("cache-control", "no-store")
          .send("Canvas connection is no longer available. Reopen Safe Online Exam from Canvas to continue.");
        return;
      }
      response
        .status(400)
        .setHeader("cache-control", "no-store")
        .send(
          "Unable to generate this Safe Online Exam configuration. Ask the instructor to verify the quiz settings."
        );
    }
  }

  @Head("/seb/config/:courseId/:contentId.seb")
  async inspectConfigDownload(
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("contentId") contentId: string,
    @Query("grant") grant?: string
  ): Promise<void> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId || !(await this.configGrants.validateGrant(grant, courseId, canonicalContentId))) {
      response.status(403).setHeader("cache-control", "no-store").send();
      return;
    }
    // Windows SEB validates a configuration URL with HEAD before its single
    // GET download. Do not consume the grant here: only downloadConfig may
    // mint the assessment's session handoff and release encrypted bytes.
    setPrivateNoStoreResponseHeaders(response);
    response.status(200).type("application/octet-stream").send();
  }

  @Get("/seb/config-encryption-certificate.pem")
  downloadConfigEncryptionCertificatePem(@Res() response: Response): void {
    const certificate = this.sebConfig.getEncryptionCertificate();
    if (!certificate) {
      response.status(404).send("Safe Online Exam configuration encryption certificate is not configured");
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
      response.status(404).send("Safe Online Exam configuration encryption certificate is not configured");
      return;
    }
    response
      .status(200)
      .type("application/pkix-cert")
      .setHeader("content-disposition", 'attachment; filename="seb-config-encryption-certificate.cer"')
      .setHeader("x-seb-public-key-hash", certificate.publicKeyHash.toString("hex"))
      .send(certificate.der);
  }

  @Get("/seb/check/config.seb")
  async downloadSetupCheckConfig(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (
      !consumePublicBudget(request, "seb-setup-check-config", 1_200) ||
      !(await this.distributedAdmission.consumeRequestIp(request, "seb-setup-check-config-ip", 2_400))
    ) {
      response.status(429).setHeader("retry-after", "60").send("Too many setup-check configuration requests");
      return;
    }
    try {
      if (!this.setupCheckConfigCache) {
        this.setupCheckConfigCache = Promise.resolve().then(() => this.generateSetupCheckConfig());
      }
      const generated = await this.setupCheckConfigCache;
      // The setup settings are stable, but certificate readiness is not. Check
      // it on every response even when the encrypted bytes are cached.
      this.sebConfig.assertConfigurationDownloadReady();
      setSebDownloadResponseHeaders(response);
      response
        .status(200)
        .type("application/octet-stream")
        .setHeader("content-disposition", 'attachment; filename="seb-setup-check.seb"')
        .setHeader("content-description", "Safe Online Exam Setup Check Configuration")
        .send(generated);
    } catch {
      this.setupCheckConfigCache = undefined;
      response.status(400).send("Unable to generate the Safe Online Exam setup check configuration.");
    }
  }

  @Get("/seb/check")
  setupCheckPage(@Req() request: Request, @Res() response: Response): void {
    const quitUrl = absoluteUrl(request, "/seb/check/quit", this.config.getApplicationBaseUrl());
    response.send(
      renderAppShell({
        title: "Safe Online Exam Setup Check",
        view: "seb-check",
        initialData: {
          proofUrl: "/api/seb/check-proof",
          quitUrl,
          legacyQuitUrl: quitUrl,
          configEncryptionEnabled: !!this.sebConfig.getEncryptionCertificate(),
          serverDetectedSeb: this.sebDetector.isRequestFromSeb(request)
        }
      })
    );
  }

  @Post("/api/seb/check-proof")
  verifySetupCheck(
    @Req() request: Request,
    @Body() body?: { configKeyHash?: string; url?: string }
  ): Record<string, unknown> {
    const expectedConfigKey = this.currentSetupCheckConfigKey();
    const proofUrl = body?.url || "";
    const validUrl = isExpectedSetupCheckUrl(this.config, proofUrl);
    const validProof =
      this.configKey.validateConfigKeyHashForUrl(body?.configKeyHash, proofUrl, expectedConfigKey) ||
      this.configKey.validateConfigKeyHash(request, expectedConfigKey);
    if (!validUrl || !validProof) {
      return apiError(
        403,
        "This Safe Online Exam setup check configuration could not be verified. Reopen the setup check from Canvas using the Safe Online Exam button.",
        { error_code: "INVALID_SEB_SETUP_CHECK_PROOF" }
      );
    }
    return {
      success: true,
      checks: {
        configKey: true,
        expectedUrl: true
      }
    };
  }

  @Get("/seb/check/quit")
  quitSetupCheck(@Req() request: Request, @Res() response: Response): void {
    const quitUrl = absoluteUrl(request, "/seb/check/quit", this.config.getApplicationBaseUrl());
    response
      .setHeader("x-seb-quit", "true")
      .setHeader("x-seb-exit", "setup-check")
      .send(
        renderAppShell({
          title: "Safe Exam Browser Closing",
          view: "seb-quit",
          initialData: { quitUrl, legacyQuitUrl: quitUrl, courseId: "setup", quizId: "check" }
        })
      );
  }

  @Get("/seb/config/:courseId/:quizId")
  async redirectConfig(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<void> {
    const principal = verifiedLtiPrincipal(request);
    const canonicalContentId = canonicalSebConfigContentId(quizId);
    if (!principal || principal.courseId !== courseId || !canonicalContentId || !isSafeConfigNavigation(request)) {
      response.status(403).setHeader("cache-control", "no-store").send("Launch this assessment from Canvas.");
      return;
    }
    this.renderConfigGrantPage(request, response, principal, courseId, canonicalContentId);
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

  @Get("/seb/launch-handoff")
  launchHandoff(@Res() response: Response): void {
    setPrivateNoStoreResponseHeaders(response);
    response.send(
      renderAppShell({
        title: "Opening Safe Exam Browser",
        view: "seb-launching-handoff",
        initialData: {}
      })
    );
  }

  @Get("/seb/launch/:contentId")
  async launchGet(
    @Req() request: Request,
    @Res() response: Response,
    @Param("contentId") contentId: string,
    @Query("connected") connected?: string
  ): Promise<void> {
    await this.handleSebLaunch(request, response, contentId, undefined, undefined, connected === "1");
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
  async legacyConfigRedirect(
    @Req() request: Request,
    @Res() response: Response,
    @Param("quizId") quizId: string
  ): Promise<void> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal || !isSafeConfigNavigation(request)) {
      response.status(403).setHeader("cache-control", "no-store").send("Launch this assessment from Canvas.");
      return;
    }
    const normalizedQuizId = normalizedPublicSebContentId(quizId);
    if (!normalizedQuizId || parseNewQuizContentId(normalizedQuizId)) {
      response.status(404).setHeader("cache-control", "no-store").send("Assessment not found");
      return;
    }
    const quiz = await this.assessments.getQuiz(normalizedQuizId);
    if (!quiz?.courseId || quiz.courseId !== principal.courseId) {
      response.status(404).setHeader("cache-control", "no-store").send("Assessment not found");
      return;
    }
    const canonicalContentId = canonicalSebConfigContentId(normalizedQuizId);
    if (!canonicalContentId) {
      response.status(404).setHeader("cache-control", "no-store").send("Assessment not found");
      return;
    }
    this.renderConfigGrantPage(request, response, principal, quiz.courseId, canonicalContentId);
  }

  @Get("/api/seb/tools/:courseId/:quizId")
  async tools(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const principal = verifiedLtiPrincipal(request);
    const normalizedContentId = normalizedPublicSebContentId(quizId);
    if (!principal || principal.courseId !== courseId || !normalizedContentId) {
      return apiError(403, "Verified Canvas launch required");
    }
    if (
      !consumePublicBudget(request, "seb-tools", 1_200) ||
      !(await this.distributedAdmission.consumeRequestIp(request, "seb-tools-ip", 2_400))
    ) {
      return apiError(429, "Too many Safe Online Exam tool requests", { error_code: "RATE_LIMITED" });
    }
    const setting = await this.resolveSebSetting(courseId, normalizedContentId);
    if (!setting?.sebRequired || !setting.enabled || !this.effectiveQuitPassword(setting)) {
      return { success: true, tools: [] };
    }
    return {
      success: true,
      tools: this.examToolPayloads(setting.externalTools)
    };
  }

  @Get("/api/seb/requirement/:courseId/:quizId")
  async requirementStatus(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Res({ passthrough: true }) response?: Response
  ): Promise<Record<string, unknown>> {
    response?.setHeader("cache-control", "private, no-store, max-age=0");
    if (!/^[a-z0-9_-]{1,128}$/iu.test(courseId)) {
      return { success: true, sebRequired: false };
    }
    const canonicalContentId = canonicalSebConfigContentId(quizId);
    const parsed = parseNewQuizContentId(canonicalContentId);
    if (!canonicalContentId || (parsed && parsed.courseId !== courseId)) {
      return { success: true, sebRequired: false };
    }
    const cached = this.cachedSebRequirementStatus(courseId, canonicalContentId);
    if (cached) {
      return { success: true, sebRequired: await cached };
    }
    return {
      success: true,
      sebRequired: await this.cacheSebRequirementStatus(courseId, canonicalContentId, async () => {
        if (
          !consumePublicBudget(request, "seb-requirement", 12_000) ||
          !(await this.distributedAdmission.consumeRequestIp(request, "seb-requirement-ip", 24_000))
        ) {
          return apiError(429, "Too many Safe Online Exam requirement checks", { error_code: "RATE_LIMITED" });
        }
        return this.isSebRequirementConfigured(courseId, canonicalContentId);
      })
    };
  }

  @Post("/api/seb/access-proof/:courseId/:quizId")
  async createAccessProof(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Body() body?: { configKeyHash?: string; url?: string },
    @Res({ passthrough: true }) response?: Response
  ): Promise<Record<string, unknown>> {
    setSensitiveSebResponseHeaders(response);
    const normalizedContentId = normalizedPublicSebContentId(quizId);
    if (!normalizedContentId) {
      return apiError(404, "No Safe Online Exam setting found for this quiz");
    }
    if (
      !consumePublicBudget(request, "seb-proof", 1_200) ||
      !(await this.distributedAdmission.consumeRequestIp(request, "seb-proof-ip", 2_400))
    ) {
      return apiError(429, "Too many Safe Online Exam proof requests", { error_code: "RATE_LIMITED" });
    }
    return this.createAccessProofForCurrentCourseState(request, courseId, normalizedContentId, body);
  }

  @Post("/api/seb/access-code/:courseId/:quizId")
  async accessCode(
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Headers("x-seb-proof-token") proofToken?: string,
    @Req() request?: Request,
    @Res({ passthrough: true }) response?: Response
  ): Promise<Record<string, unknown>> {
    setSensitiveSebResponseHeaders(response);
    const normalizedContentId = normalizedPublicSebContentId(quizId);
    if (!normalizedContentId || !proofToken || !/^[A-Za-z0-9_-]{43}$/u.test(proofToken) || !request) {
      return apiError(403, "Invalid or expired Safe Online Exam access proof");
    }
    if (
      !consumePublicBudget(request, "seb-access-code", 1_200) ||
      !(await this.distributedAdmission.consumeRequestIp(request, "seb-access-code-ip", 2_400))
    ) {
      return apiError(429, "Too many Safe Online Exam access-code requests", { error_code: "RATE_LIMITED" });
    }
    return this.releaseAccessCodeForCurrentCourseState(courseId, normalizedContentId, proofToken);
  }

  /**
   * YouTube now requires a Referer or equivalent client identity for embeds.
   * The server-owned page is the embedding document, so the player receives a
   * stable HTTPS origin even when SEB opens a tool in a separate window.
   */
  @Get("/seb/tool/youtube/:videoId")
  youtubeTool(@Param("videoId") videoId: string, @Res() response: Response): void {
    if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
      response.status(404).send("Video not found");
      return;
    }
    const appBaseUrl = this.applicationBaseUrl();
    const origin = new URL(appBaseUrl).origin;
    const player = new URL(`https://www.youtube.com/embed/${videoId}`);
    player.searchParams.set("rel", "0");
    player.searchParams.set("origin", origin);
    response
      .status(200)
      .setHeader("cache-control", "no-store")
      .setHeader("referrer-policy", "strict-origin-when-cross-origin")
      .setHeader(
        "content-security-policy",
        "default-src 'none'; frame-src https://www.youtube.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
      )
      .type("html")
      .send(renderYouTubeToolPage(player.toString()));
  }

  @Get("/api/seb/access-code/:courseId/:quizId")
  accessCodeGet(): Record<string, unknown> {
    return apiError(405, "Use POST to redeem a Safe Online Exam access proof");
  }

  @Get("/seb/exit/session/:courseId/:quizId/:grant")
  async exitSessionPage(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Param("grant") grant: string
  ): Promise<void> {
    const context = await this.validatedExitGrant(courseId, quizId, grant);
    if (!context) {
      response
        .status(403)
        .setHeader("cache-control", "no-store")
        .send(
          renderFallbackHtml(
            "Exit Link Unavailable",
            "<h1>Exit link unavailable</h1><p>Return to the submitted assessment results page, or ask your proctor for help.</p>"
          )
        );
      return;
    }
    const quitUrl = absoluteUrl(
      request,
      `/seb/exit/quit/${encodeURIComponent(courseId)}/${encodeURIComponent(context.grantContentId)}/${grant}`,
      this.config.getApplicationBaseUrl()
    );
    response
      .setHeader("cache-control", "private, no-store, max-age=0")
      .setHeader("referrer-policy", "no-referrer")
      .send(
        renderAppShell({
          title: "Quiz Completed",
          view: "seb-exit",
          initialData: {
            courseId,
            quizId: context.grantContentId,
            quitUrl,
            legacyQuitUrl: quitUrl,
            manualQuitUrl: null,
            exitMode: "submitted"
          }
        })
      );
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
    response.send(
      renderAppShell({
        title: "Quiz Completed",
        view: "seb-exit",
        initialData: {
          courseId,
          quizId,
          userId,
          exitPageUrl,
          quitUrl: null,
          legacyQuitUrl: null,
          manualQuitUrl: null,
          exitMode: mode || "manual"
        }
      })
    );
  }

  @Get(["/seb/exit/quit/:courseId/:quizId", "/seb/exit/manual/:courseId/:quizId"])
  quit(@Res() response: Response, @Param("courseId") _courseId: string, @Param("quizId") _quizId: string): void {
    response
      .status(410)
      .setHeader("cache-control", "no-store")
      .send(
        renderFallbackHtml(
          "Use Safe Online Exam to Quit",
          "<h1>Automatic quit is unavailable</h1><p>Use Safe Exam Browser's native Quit command and the proctor-provided quit password.</p>"
        )
      );
  }

  @Get("/seb/exit/quit/:courseId/:quizId/:grant")
  async quitWithGrant(
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Param("grant") grant: string
  ): Promise<void> {
    const context = await this.validatedExitGrant(courseId, quizId, grant);
    if (!context) {
      response
        .status(403)
        .setHeader("cache-control", "no-store")
        .send(renderFallbackHtml("Exit Link Unavailable", "<h1>Exit link unavailable</h1>"));
      return;
    }
    response
      .setHeader("cache-control", "no-store")
      .setHeader("referrer-policy", "no-referrer")
      .redirect(303, this.sebConfig.assessmentQuitUrl(courseId, context.configContentId, context.setting.accessCode!));
  }

  @Get("/seb/exit/complete/:courseId/:quizId/:token")
  async completeQuit(
    @Req() request: Request,
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Param("token") token: string
  ): Promise<void> {
    const contentId = canonicalSebConfigContentId(quizId);
    const grantContentId = normalizedPublicSebContentId(quizId);
    const setting = grantContentId ? await this.resolveSebSetting(courseId, grantContentId) : null;
    if (
      !contentId ||
      !setting?.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      setting.courseId !== courseId ||
      !this.sebConfig.matchesAssessmentQuitToken(courseId, contentId, setting.accessCode, token)
    ) {
      response
        .status(403)
        .setHeader("cache-control", "no-store")
        .send(renderFallbackHtml("Exit Link Unavailable", "<h1>Exit link unavailable</h1>"));
      return;
    }
    const quitUrl = absoluteUrl(request, request.path, this.config.getApplicationBaseUrl());
    response
      .setHeader("cache-control", "no-store")
      .setHeader("x-seb-quit", "true")
      .setHeader("x-seb-exit", "submitted")
      .send(
        renderAppShell({
          title: "Safe Exam Browser Closing",
          view: "seb-quit",
          initialData: { courseId, quizId: contentId, quitUrl, legacyQuitUrl: quitUrl }
        })
      );
  }

  private async validatedExitGrant(
    courseId: string,
    quizId: string,
    grant: string
  ): Promise<{
    grantContentId: string;
    configContentId: string;
    setting: QuizSebSetting | ContentSebSetting;
  } | null> {
    const grantContentId = normalizedPublicSebContentId(quizId);
    const configContentId = canonicalSebConfigContentId(quizId);
    const setting = grantContentId ? await this.resolveSebSetting(courseId, grantContentId) : null;
    if (
      !grantContentId ||
      !configContentId ||
      !setting?.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      setting.courseId !== courseId ||
      !this.effectiveQuitPassword(setting)
    ) {
      return null;
    }
    return (await this.proofService.getExitGrant(grant, courseId, grantContentId))
      ? { grantContentId, configContentId, setting }
      : null;
  }

  private async handleSebLaunch(
    request: Request,
    response: Response,
    contentId: string,
    idToken?: string,
    state?: string,
    showReadinessPrompt = false
  ): Promise<void> {
    if (idToken) {
      if (!hasBoundedLtiValidationEnvelope(state, idToken)) {
        if (await this.redirectStaleSebLaunchToCanvas(response, contentId)) {
          return;
        }
        response
          .status(400)
          .send(renderFallbackHtml("Invalid LTI Launch", "<h1>Invalid LTI Launch</h1><p>Invalid launch envelope.</p>"));
        return;
      }
      if (
        !consumePublicBudget(request, "lti-token-validation", 1_200) ||
        !(await this.distributedAdmission.consumeLtiValidationIp(request))
      ) {
        response.status(429).setHeader("retry-after", "60").send("Too many LTI launch attempts");
        return;
      }
      try {
        const consumed = this.ltiState.peekState(state);
        const transactionCookieName = matchingLtiOidcBrowserTransactionCookie(request, consumed);
        if (!transactionCookieName) {
          throw new Error("LTI launch browser binding does not match the initiating login");
        }
        if (!(await this.distributedAdmission.consumeLtiStateValidationAttempt(state))) {
          response.status(429).setHeader("retry-after", "60").send("Too many LTI launch attempts");
          return;
        }
        const launchData = await this.ltiService.validateToken(idToken, consumed.nonce);
        if (
          consumed.issuer !== launchData.issuer ||
          (consumed.deploymentId && consumed.deploymentId !== launchData.deploymentId) ||
          consumed.targetLinkUri !== launchData.targetLinkUri
        ) {
          throw new Error("LTI launch does not match the initiating login");
        }
        await this.ltiState.claimState(state);
        clearLtiOidcBrowserTransactionCookie(response, transactionCookieName);
        await regenerateSession(request);
        request.session!.launchData = launchData;
        request.session!.verifiedLtiPrincipal = createVerifiedLtiPrincipal(launchData);
        request.session!.canvas_user_id = launchData.canvasUserId || launchData.userId;
        await this.canvasApi?.updateStoredIdentity?.(launchData.canvasUserId || launchData.userId, {
          displayName: launchData.fullName,
          email: launchData.email
        });
      } catch {
        if (await this.redirectStaleSebLaunchToCanvas(response, contentId)) {
          return;
        }
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
    } else if (!verifiedLtiPrincipal(request) || !request.session?.launchData) {
      if (await this.redirectStaleSebLaunchToCanvas(response, contentId)) {
        return;
      }
      response
        .status(403)
        .send(
          renderFallbackHtml(
            "Canvas Launch Required",
            "<h1>Canvas Launch Required</h1><p>Please open this assessment from Canvas before using Safe Online Exam.</p>"
          )
        );
      return;
    }

    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      response.status(404).send(renderFallbackHtml("Launch Content Not Found", "<h1>Launch content not found</h1>"));
      return;
    }
    const resolved = await this.resolveContentForLaunch(canonicalContentId);
    if (!resolved) {
      response.status(404).send(renderFallbackHtml("Launch Content Not Found", "<h1>Launch content not found</h1>"));
      return;
    }
    const principal = verifiedLtiPrincipal(request);
    if (!principal || resolved.content.courseId !== principal.courseId) {
      response
        .status(403)
        .send(
          renderFallbackHtml(
            "Forbidden",
            "<h1>Forbidden</h1><p>This assessment is not in the launched Canvas course.</p>"
          )
        );
      return;
    }
    const directLaunch = consumePendingSebLaunch(request, principal, resolved.content.courseId, canonicalContentId);
    if (!directLaunch && isDirectLtiLaunchReplay(request, this.config, resolved.content.courseId, canonicalContentId)) {
      setPrivateNoStoreResponseHeaders(response);
      response.redirect(303, this.canvasCourseHomeUrl(resolved.content.courseId));
      return;
    }
    if (!resolved.setting?.sebRequired || this.sebDetector.isRequestFromSeb(request, resolved.setting)) {
      response.redirect(resolved.launchTarget);
      return;
    }
    const resolvedCanonicalContentId = canonicalSebConfigContentId(resolved.content.id);
    if (!resolvedCanonicalContentId) {
      response.status(404).send(renderFallbackHtml("Launch Content Not Found", "<h1>Launch content not found</h1>"));
      return;
    }
    if (directLaunch) {
      try {
        const target = await this.resolveCurrentConfigGrantTarget(
          resolved.content.courseId,
          resolvedCanonicalContentId
        );
        if (!target) {
          response
            .status(404)
            .setHeader("cache-control", "no-store")
            .send("Safe Online Exam configuration is unavailable");
          return;
        }
        const grant = await this.configGrants.mintGrant(
          request,
          principal,
          resolved.content.courseId,
          target.canonicalContentId,
          target.settingsFingerprint
        );
        if (
          !(await this.finalizeCourseScopedGrant(resolved.content.courseId, target, () =>
            this.configGrants.revokeGrant(grant)
          ))
        ) {
          response
            .status(404)
            .setHeader("cache-control", "no-store")
            .send("Safe Online Exam configuration is unavailable");
          return;
        }
        request.session!.completedSebLaunch = {
          courseId: resolved.content.courseId,
          contentId: canonicalContentId,
          issuedAt: Date.now()
        };
        await saveSession(request);
        const configPath = sebConfigPath(resolved.content.courseId, target.canonicalContentId, grant);
        setPrivateNoStoreResponseHeaders(response);
        response.send(
          renderAppShell({
            title: "Opening Safe Exam Browser",
            view: "seb-launching",
            initialData: {
              sebLaunchUrl: sebSchemeUrl(request, configPath, this.config.getApplicationBaseUrl()),
              browserReturnUrl: this.canvasCourseHomeUrl(resolved.content.courseId)
            }
          })
        );
        return;
      } catch (error) {
        if (error instanceof SebConfigGrantRateLimitError) {
          response.status(429).setHeader("retry-after", "60").send("Too many configuration requests");
          return;
        }
        throw error;
      }
    }
    const readinessPromptDismissed =
      showReadinessPrompt && this.canvasApi
        ? await this.canvasApi.hasDismissedStudentReadinessPrompt(principal.canvasUserId)
        : false;
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
          browserReturnUrl: this.canvasCourseHomeUrl(resolved.content.courseId),
          configGrantUrl: configGrantEndpoint(resolved.content.courseId, resolvedCanonicalContentId),
          configGrantToken: this.configGrantActionToken(request, principal),
          setupCheckLaunchUrl: sebSchemeUrl(request, "/seb/check/config.seb", this.config.getApplicationBaseUrl()),
          sessionReadinessUrl: "/api/seb/session-readiness",
          showReadinessPrompt: showReadinessPrompt && !readinessPromptDismissed
        }
      })
    );
  }

  private generateConfigForGrant(
    courseId: string,
    contentId: string,
    target: { setting: QuizSebSetting | ContentSebSetting; settingsFingerprint: string },
    canvasUserId: string,
    requiresSessionHandoff: boolean
  ): Promise<{ buffer: Buffer; handoffDocumentIds: string[] }> {
    return this.contentCoordinator.generateConfigForGrant(
      courseId,
      contentId,
      target,
      canvasUserId,
      requiresSessionHandoff
    );
  }

  private configGrantActionToken(request: Request, principal: VerifiedLtiPrincipal): string {
    if (!request.sessionID) {
      throw new Error("Session binding is required for SEB configuration grants");
    }
    return createSebConfigGrantActionToken(this.config, principal.canvasUserId, principal.courseId, {
      subject: principal.subject,
      deploymentId: principal.deploymentId,
      sessionId: request.sessionID
    });
  }

  private renderConfigGrantPage(
    request: Request,
    response: Response,
    principal: VerifiedLtiPrincipal,
    courseId: string,
    contentId: string
  ): void {
    setPrivateNoStoreResponseHeaders(response);
    response.send(
      renderAppShell({
        title: "Safe Exam Browser Required",
        view: "seb-download",
        initialData: {
          courseId,
          contentId,
          browserReturnUrl: this.canvasCourseHomeUrl(courseId),
          configGrantUrl: configGrantEndpoint(courseId, contentId),
          configGrantToken: this.configGrantActionToken(request, principal),
          setupCheckLaunchUrl: sebSchemeUrl(request, "/seb/check/config.seb", this.config.getApplicationBaseUrl()),
          sessionReadinessUrl: "/api/seb/session-readiness"
        }
      })
    );
  }

  private async createAccessProofForCurrentCourseState(
    request: Request,
    courseId: string,
    normalizedContentId: string,
    body?: { configKeyHash?: string; url?: string }
  ): Promise<Record<string, unknown>> {
    const canonicalContentId = canonicalSebConfigContentId(normalizedContentId);
    const target = canonicalContentId ? await this.resolveCurrentConfigGrantTarget(courseId, canonicalContentId) : null;
    const setting = target?.setting || null;
    if (
      !target ||
      !setting ||
      !setting.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      !this.effectiveQuitPassword(setting) ||
      (setting.startPassword && !setting.configKeySalt) ||
      !canonicalContentId
    ) {
      return apiError(404, "No Safe Online Exam setting found for this quiz");
    }
    const expectedConfigKey = await this.currentConfigKey(courseId, normalizedContentId, setting);
    const validBodyUrl = !!body?.url && isExpectedQuizUrl(this.config, body.url, courseId, normalizedContentId);
    const staticValid =
      (validBodyUrl && this.configKey.validateConfigKeyHashForUrl(body?.configKeyHash, body?.url, expectedConfigKey)) ||
      this.configKey.validateConfigKeyHash(request, expectedConfigKey);
    const handoffConfigKey =
      validBodyUrl && this.sessionHandoff
        ? await this.sessionHandoff.resolveConfigKey(
            courseId,
            canonicalContentId,
            target.settingsFingerprint,
            body?.configKeyHash,
            body?.url
          )
        : null;
    const configKey = staticValid ? expectedConfigKey : handoffConfigKey;
    if (!configKey) {
      console.warn(
        "SEB access proof rejected",
        JSON.stringify({
          courseId,
          quizId: normalizedContentId,
          hasBodyProof: !!body?.configKeyHash,
          hasHeaderProof: !!firstHeader(request, [
            "x-safeexambrowser-configkeyhash",
            "x-seb-config-key-hash",
            "x-config-key-hash",
            "x-safeexambrowser-requesthash"
          ]),
          canvasUrl: !!body?.url && isConfiguredCanvasUrl(this.config, body.url),
          quizUrl: validBodyUrl,
          sebUserAgent: /SafeExamBrowser|SEB\/|SEB;/iu.test(request.header("user-agent") || "")
        })
      );
      return apiError(
        403,
        "This Safe Online Exam configuration could not be verified. It may be stale, incorrect, or modified. Download a fresh configuration from Canvas and reopen the quiz.",
        { error_code: "INVALID_SEB_CONFIG_PROOF" }
      );
    }
    const proofToken = await this.proofService.mintProof(
      courseId,
      normalizedContentId,
      proofGenerationDigest(courseId, normalizedContentId, configKey, setting.accessCode),
      target.settingsFingerprint
    );
    if (!(await this.finalizeCourseScopedGrant(courseId, target, () => this.proofService.revokeProof(proofToken)))) {
      return apiError(404, "No Safe Online Exam setting found for this quiz");
    }
    return {
      success: true,
      proofToken,
      expiresInSeconds: this.proofService.getTokenTtlSeconds()
    };
  }

  private async releaseAccessCodeForCurrentCourseState(
    courseId: string,
    normalizedContentId: string,
    proofToken: string
  ): Promise<Record<string, unknown>> {
    const canonicalContentId = canonicalSebConfigContentId(normalizedContentId);
    const target = canonicalContentId ? await this.resolveCurrentConfigGrantTarget(courseId, canonicalContentId) : null;
    const setting = target?.setting || null;
    if (
      !target ||
      !setting ||
      setting.courseId !== courseId ||
      !this.effectiveQuitPassword(setting) ||
      (setting.startPassword && !setting.configKeySalt) ||
      !canonicalContentId
    ) {
      return apiError(404, "No Safe Online Exam setting found for this quiz");
    }
    if (!setting.sebRequired || !setting.enabled) {
      return { success: false, message: "Safe Online Exam is not required for this quiz" };
    }
    if (!setting.accessCode) {
      return { success: false, message: "No access code configured for this quiz" };
    }
    const digest = await this.proofService.consumeProof(
      proofToken,
      courseId,
      normalizedContentId,
      target.settingsFingerprint
    );
    if (!digest) {
      return apiError(403, "Invalid or expired Safe Online Exam access proof");
    }
    const exitGrant = await this.proofService.mintExitGrant(courseId, normalizedContentId, digest);
    if (!(await this.finalizeCourseScopedGrant(courseId, target, () => this.proofService.revokeExitGrant(exitGrant)))) {
      return apiError(404, "No Safe Online Exam setting found for this quiz");
    }
    return {
      success: true,
      accessCode: setting.accessCode,
      exitGrant,
      exitGrantExpiresInSeconds: this.proofService.getExitGrantTtlSeconds(),
      tools: this.examToolPayloads(setting.externalTools)
    };
  }

  private resolveCurrentConfigGrantTarget(courseId: string, contentId: string): Promise<SebConfigGrantTarget | null> {
    return this.contentCoordinator.resolveCurrentConfigGrantTarget(courseId, contentId);
  }

  resolveConfigGrantTarget(courseId: string, contentId: string): Promise<SebConfigGrantTarget | null> {
    return this.contentCoordinator.resolveConfigGrantTarget(courseId, contentId);
  }

  private finalizeCourseScopedGrant(
    courseId: string,
    target: SebConfigGrantTarget,
    revoke: () => Promise<void>
  ): Promise<SebConfigGrantTarget | null> {
    return this.contentCoordinator.finalizeCourseScopedGrant(courseId, target, revoke);
  }

  private isSebRequirementConfigured(courseId: string, contentId: string): Promise<boolean> {
    return this.contentCoordinator.isSebRequirementConfigured(courseId, contentId);
  }

  private cachedSebRequirementStatus(courseId: string, contentId: string): Promise<boolean> | null {
    return this.contentCoordinator.cachedSebRequirementStatus(courseId, contentId);
  }

  private cacheSebRequirementStatus(
    courseId: string,
    contentId: string,
    load: () => Promise<boolean>
  ): Promise<boolean> {
    return this.contentCoordinator.cacheSebRequirementStatus(courseId, contentId, load);
  }

  private canvasCourseHomeUrl(courseId: string): string {
    return this.contentCoordinator.canvasCourseHomeUrl(courseId);
  }

  private applicationBaseUrl(): string {
    return this.contentCoordinator.applicationBaseUrl();
  }

  private examToolPayloads(tools?: ExternalToolConfig[] | null): Array<{ id: string; label: string; url: string }> {
    return this.contentCoordinator.examToolPayloads(tools);
  }

  private redirectStaleSebLaunchToCanvas(response: Response, contentId: string): Promise<boolean> {
    return this.contentCoordinator.redirectStaleSebLaunchToCanvas(response, contentId);
  }

  private effectiveQuitPassword(setting: QuizSebSetting | ContentSebSetting): string | null {
    return this.contentCoordinator.effectiveQuitPassword(setting);
  }

  private generateSetupCheckConfig(): Buffer {
    return this.contentCoordinator.generateSetupCheckConfig();
  }

  private currentSetupCheckConfigKey(): string {
    return this.contentCoordinator.currentSetupCheckConfigKey();
  }

  private currentConfigKey(
    courseId: string,
    contentId: string,
    setting: QuizSebSetting | ContentSebSetting
  ): Promise<string> {
    return this.contentCoordinator.currentConfigKey(courseId, contentId, setting);
  }

  private resolveContentForLaunch(contentId: string): Promise<{
    content: SebLaunchContentView;
    setting: QuizSebSetting | ContentSebSetting | null;
    launchTarget: string;
  } | null> {
    return this.contentCoordinator.resolveContentForLaunch(contentId);
  }

  private resolveSebSetting(courseId: string, quizId: string): Promise<(QuizSebSetting | ContentSebSetting) | null> {
    return this.contentCoordinator.resolveSebSetting(courseId, quizId);
  }
}
