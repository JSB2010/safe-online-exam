import { createHash } from "node:crypto";
import { Controller, Get, Head, Post, Param, Query, Req, Res, Body, Headers } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ContentSebSetting, ExternalToolConfig, QuizSebSetting } from "../../shared/models.js";
import {
  allowlistEntriesForExternalTools,
  classicQuizContentId,
  enabledExternalTools,
  extractClassicQuizId,
  isYouTubeVideoTool,
  parseNewQuizContentId,
  youtubeVideoId,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { apiError } from "../http/api-error.js";
import { createSebConfigGrantActionToken } from "../http/action-token.js";
import { absoluteUrl, sebSchemeUrl } from "../http/request-url.js";
import { requireSebConfigGrantRequestIntegrity } from "../http/request-integrity.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";
import {
  createVerifiedLtiPrincipal,
  isVerifiedInstructor,
  isVerifiedStudent,
  verifiedLtiPrincipal
} from "../security/verified-lti-principal.js";
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
  SebConfigGrantService,
  sebConfigSettingsFingerprint
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

interface SebLaunchContentView {
  id: string;
  courseId: string;
  canvasId: string;
  assignmentId?: string | null;
  contentType: "CLASSIC_QUIZ" | "NEW_QUIZ";
  title: string;
  htmlUrl?: string | null;
  canvasLaunchUrl?: string | null;
}

@Controller()
export class SebController {
  private readonly configDownloadCache = new Map<string, { expiresAt: number; value: Promise<Buffer> }>();
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
    const principal = verifiedLtiPrincipal(request);
    const normalizedQuizId = normalizedPublicSebContentId(quizId);
    if (!principal || principal.courseId !== courseId || !normalizedQuizId || parseNewQuizContentId(normalizedQuizId)) {
      response.status(403).send("Launch this assessment from Canvas before downloading its SEB configuration.");
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
        return apiError(403, "Canvas connection is required before opening Safe Exam Browser.", {
          error_code: "CANVAS_SESSION_AUTHORIZATION_REQUIRED"
        });
      }
    }
    const target = await this.resolveConfigGrantTarget(courseId, contentId);
    if (!target) {
      return apiError(404, "SEB configuration is unavailable");
    }
    try {
      const grant = await this.configGrants.mintGrant(
        request,
        principal,
        courseId,
        target.canonicalContentId,
        target.settingsFingerprint
      );
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
        return apiError(403, "Canvas connection must be completed again before using Safe Exam Browser.", {
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
      this.rejectConfigPrefetch(response);
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
      const target = await this.resolveConfigGrantTarget(courseId, canonicalContentId);
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
      // The encrypted bytes may come from the short single-flight cache. Check
      // certificate time again immediately before serving them so a long-lived
      // process cannot issue a config after NotAfter.
      this.sebConfig.assertConfigurationDownloadReady({ requireCertificateEncryption: true });
      response
        .status(200)
        .type("application/octet-stream")
        .setHeader(
          "content-disposition",
          `attachment; filename="quiz_${sanitizeFileToken(courseId)}_${sanitizeFileToken(canonicalContentId)}.seb"`
        )
        .setHeader("content-description", "Safe Exam Browser Configuration")
        .setHeader("x-content-type-options", "nosniff")
        .setHeader("cache-control", "private, no-store")
        .setHeader("referrer-policy", "no-referrer")
        .setHeader("content-transfer-encoding", "binary")
        .send(generated);
    } catch (error) {
      if (error instanceof CanvasApiAuthorizationError || error instanceof CanvasApiPermissionError) {
        response
          .status(403)
          .setHeader("cache-control", "no-store")
          .send("Canvas connection is no longer available. Reopen Safe Exam Browser Quizzes from Canvas to continue.");
        return;
      }
      response
        .status(400)
        .setHeader("cache-control", "no-store")
        .send("Unable to generate this SEB configuration. Ask the instructor to verify the quiz settings.");
    }
  }

  @Head("/seb/config/:courseId/:contentId.seb")
  rejectConfigPrefetch(@Res() response: Response): void {
    response.status(405).setHeader("allow", "GET").setHeader("cache-control", "no-store").send();
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
      response
        .status(200)
        .type("application/octet-stream")
        .setHeader("content-disposition", 'attachment; filename="seb-setup-check.seb"')
        .setHeader("content-description", "Safe Exam Browser Setup Check Configuration")
        .setHeader("x-content-type-options", "nosniff")
        .setHeader("cache-control", "private, no-store")
        .setHeader("referrer-policy", "no-referrer")
        .setHeader("content-transfer-encoding", "binary")
        .send(generated);
    } catch {
      this.setupCheckConfigCache = undefined;
      response.status(400).send("Unable to generate the SEB setup check configuration.");
    }
  }

  @Get("/seb/check")
  setupCheckPage(@Req() request: Request, @Res() response: Response): void {
    const quitUrl = absoluteUrl(request, "/seb/check/quit", this.config.getApplicationBaseUrl());
    response.send(
      renderAppShell({
        title: "SEB Setup Check",
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
        "This SEB setup check configuration could not be verified. Reopen the setup check from Canvas using the Safe Exam Browser button.",
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
      return apiError(429, "Too many SEB tool requests", { error_code: "RATE_LIMITED" });
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

  @Post("/api/seb/access-proof/:courseId/:quizId")
  async createAccessProof(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Body() body?: { configKeyHash?: string; url?: string },
    @Res({ passthrough: true }) response?: Response
  ): Promise<Record<string, unknown>> {
    setSensitiveResponseHeaders(response);
    const normalizedContentId = normalizedPublicSebContentId(quizId);
    if (!normalizedContentId) {
      return apiError(404, "No SEB setting found for this quiz");
    }
    if (
      !consumePublicBudget(request, "seb-proof", 1_200) ||
      !(await this.distributedAdmission.consumeRequestIp(request, "seb-proof-ip", 2_400))
    ) {
      return apiError(429, "Too many SEB proof requests", { error_code: "RATE_LIMITED" });
    }
    const canonicalContentId = canonicalSebConfigContentId(normalizedContentId);
    const target = canonicalContentId ? await this.resolveConfigGrantTarget(courseId, canonicalContentId) : null;
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
      return apiError(404, "No SEB setting found for this quiz");
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
    const valid = !!configKey;
    if (!valid) {
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
        "This SEB configuration could not be verified. It may be stale, incorrect, or modified. Download a fresh SEB configuration from Canvas and reopen the quiz.",
        { error_code: "INVALID_SEB_CONFIG_PROOF" }
      );
    }
    return {
      success: true,
      proofToken: await this.proofService.mintProof(
        courseId,
        normalizedContentId,
        proofGenerationDigest(courseId, normalizedContentId, configKey, setting.accessCode),
        target.settingsFingerprint
      ),
      expiresInSeconds: this.proofService.getTokenTtlSeconds()
    };
  }

  @Post("/api/seb/access-code/:courseId/:quizId")
  async accessCode(
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string,
    @Headers("x-seb-proof-token") proofToken?: string,
    @Req() request?: Request,
    @Res({ passthrough: true }) response?: Response
  ): Promise<Record<string, unknown>> {
    setSensitiveResponseHeaders(response);
    const normalizedContentId = normalizedPublicSebContentId(quizId);
    if (!normalizedContentId || !proofToken || !/^[A-Za-z0-9_-]{43}$/u.test(proofToken) || !request) {
      return apiError(403, "Invalid or expired SEB access proof");
    }
    if (
      !consumePublicBudget(request, "seb-access-code", 1_200) ||
      !(await this.distributedAdmission.consumeRequestIp(request, "seb-access-code-ip", 2_400))
    ) {
      return apiError(429, "Too many SEB access-code requests", { error_code: "RATE_LIMITED" });
    }
    const canonicalContentId = canonicalSebConfigContentId(normalizedContentId);
    const target = canonicalContentId ? await this.resolveConfigGrantTarget(courseId, canonicalContentId) : null;
    const setting = target?.setting || null;
    if (
      !target ||
      !setting ||
      setting.courseId !== courseId ||
      !this.effectiveQuitPassword(setting) ||
      (setting.startPassword && !setting.configKeySalt) ||
      !canonicalContentId
    ) {
      return apiError(404, "No SEB setting found for this quiz");
    }
    if (!setting.sebRequired || !setting.enabled) {
      return { success: false, message: "SEB not required for this quiz" };
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
      return apiError(403, "Invalid or expired SEB access proof");
    }
    const exitGrant = await this.proofService.mintExitGrant(courseId, normalizedContentId, digest);
    return {
      success: true,
      accessCode: setting.accessCode,
      exitGrant,
      exitGrantExpiresInSeconds: this.proofService.getExitGrantTtlSeconds(),
      tools: this.examToolPayloads(setting.externalTools)
    };
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
    return apiError(405, "Use POST to redeem an SEB access proof");
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
          "Use Safe Exam Browser to Quit",
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
        await regenerateSebSession(request);
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
            "<h1>Canvas Launch Required</h1><p>Please open this assessment from Canvas before using Safe Exam Browser.</p>"
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
      response
        .setHeader("cache-control", "private, no-store")
        .setHeader("referrer-policy", "no-referrer")
        .redirect(303, this.canvasCourseHomeUrl(resolved.content.courseId));
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
      const target = await this.resolveConfigGrantTarget(resolved.content.courseId, resolvedCanonicalContentId);
      if (!target) {
        response.status(404).setHeader("cache-control", "no-store").send("SEB configuration is unavailable");
        return;
      }
      try {
        const grant = await this.configGrants.mintGrant(
          request,
          principal,
          resolved.content.courseId,
          target.canonicalContentId,
          target.settingsFingerprint
        );
        request.session!.completedSebLaunch = {
          courseId: resolved.content.courseId,
          contentId: canonicalContentId,
          issuedAt: Date.now()
        };
        await saveSebSession(request);
        const configPath = sebConfigPath(resolved.content.courseId, target.canonicalContentId, grant);
        response
          .setHeader("cache-control", "private, no-store")
          .setHeader("referrer-policy", "no-referrer")
          .send(
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

  private async generateConfig(
    courseId: string,
    contentId: string,
    canvasUrl?: string,
    startUrlOverride?: string
  ): Promise<Buffer> {
    if (startUrlOverride) {
      return this.generateConfigUncached(courseId, contentId, canvasUrl, startUrlOverride);
    }
    const record = await this.assessments.getAssessmentRecord(contentId);
    if (!record || record.courseId !== courseId) {
      throw new Error("Assessment not found");
    }
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          courseId,
          contentId,
          canvas: record.canvas,
          seb: record.seb,
          managedQuitPolicyDigest: this.managedQuitPolicyDigest()
        }),
        "utf8"
      )
      .digest("base64url");
    const now = Date.now();
    const cached = this.configDownloadCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = this.generateConfigUncached(courseId, contentId, canvasUrl);
    this.configDownloadCache.set(key, { expiresAt: now + 120_000, value });
    while (this.configDownloadCache.size > 64) {
      const oldest = this.configDownloadCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.configDownloadCache.delete(oldest);
    }
    try {
      return await value;
    } catch (error) {
      this.configDownloadCache.delete(key);
      throw error;
    }
  }

  private async generateConfigForGrant(
    courseId: string,
    contentId: string,
    target: { setting: QuizSebSetting | ContentSebSetting; settingsFingerprint: string },
    canvasUserId: string,
    requiresSessionHandoff: boolean
  ): Promise<Buffer> {
    if (!requiresSessionHandoff) {
      return this.generateConfig(courseId, contentId);
    }
    if (!this.canvasApi || !this.sessionHandoff) {
      throw new Error("Canvas session handoff services are unavailable");
    }
    const returnTo = await this.resolveCanvasStartUrl(courseId, contentId);
    const sessionUrl = await this.canvasApi.getSessionToken(canvasUserId, returnTo);
    const plain = await this.generatePlainConfigUncached(courseId, contentId, undefined, sessionUrl);
    const dynamicConfigKey = this.configKey.computeConfigKey(plain);
    await this.sessionHandoff.registerConfig(
      courseId,
      contentId,
      target.settingsFingerprint,
      dynamicConfigKey,
      returnTo
    );
    return this.sebConfig.prepareSebConfigurationDownload(plain, {
      startPassword: target.setting.startPassword,
      requireCertificateEncryption: true
    });
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
    response
      .setHeader("cache-control", "private, no-store")
      .setHeader("referrer-policy", "no-referrer")
      .send(
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

  private async resolveConfigGrantTarget(
    courseId: string,
    contentId: string
  ): Promise<{
    canonicalContentId: string;
    setting: QuizSebSetting | ContentSebSetting;
    settingsFingerprint: string;
  } | null> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      return null;
    }
    const parsed = parseNewQuizContentId(canonicalContentId);
    if (parsed && parsed.courseId !== courseId) {
      return null;
    }
    const setting = await this.resolveSebSetting(courseId, canonicalContentId);
    if (
      !setting?.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      setting.courseId !== courseId ||
      !this.effectiveQuitPassword(setting) ||
      (setting.startPassword && !setting.configKeySalt) ||
      !(await this.matchesAssessmentObject(courseId, canonicalContentId))
    ) {
      return null;
    }
    return {
      canonicalContentId,
      setting,
      settingsFingerprint: createHash("sha256")
        .update(
          `${sebConfigSettingsFingerprint(courseId, canonicalContentId, setting)}\0${this.managedQuitPolicyDigest()}`,
          "utf8"
        )
        .digest("base64url")
    };
  }

  private canvasCourseHomeUrl(courseId: string): string {
    return new URL(`/courses/${encodeURIComponent(courseId)}`, this.config.getCanvasDomain()).toString();
  }

  private applicationBaseUrl(): string {
    const baseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!baseUrl) {
      throw new Error("Application base URL is required for exam tools");
    }
    return baseUrl;
  }

  private examToolPayloads(tools?: ExternalToolConfig[] | null): Array<{ id: string; label: string; url: string }> {
    return enabledExternalTools(tools).map((tool) => ({
      id: tool.id,
      label: tool.label,
      url: this.examToolLaunchUrl(tool)
    }));
  }

  private examToolLaunchUrl(tool: ExternalToolConfig): string {
    const appBaseUrl = this.applicationBaseUrl();
    const videoId = isYouTubeVideoTool(tool) ? youtubeVideoId(tool) : null;
    if (videoId) {
      return new URL(`/seb/tool/youtube/${videoId}`, appBaseUrl).toString();
    }
    return tool.url;
  }

  private async redirectStaleSebLaunchToCanvas(response: Response, contentId: string): Promise<boolean> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      return false;
    }
    try {
      const resolved = await this.resolveContentForLaunch(canonicalContentId);
      if (!resolved?.content.courseId) {
        return false;
      }
      response
        .setHeader("cache-control", "private, no-store")
        .setHeader("referrer-policy", "no-referrer")
        .redirect(303, this.canvasCourseHomeUrl(resolved.content.courseId));
      return true;
    } catch {
      return false;
    }
  }

  private effectiveQuitPassword(setting: QuizSebSetting | ContentSebSetting): string | null {
    return setting.quitPassword?.trim() || this.config.value.seb.defaultQuitPassword?.trim() || null;
  }

  private managedQuitPolicyDigest(): string {
    return createHash("sha256")
      .update(`managed-quit-policy-v1\0${this.config.value.seb.defaultQuitPassword || ""}`, "utf8")
      .digest("base64url");
  }

  private async generateConfigUncached(
    courseId: string,
    contentId: string,
    canvasUrl?: string,
    startUrlOverride?: string
  ): Promise<Buffer> {
    const plain = await this.generatePlainConfigUncached(courseId, contentId, canvasUrl, startUrlOverride);
    const setting = await this.resolveSebSetting(courseId, contentId);
    return this.sebConfig.prepareSebConfigurationDownload(plain, {
      startPassword: setting?.startPassword,
      requireCertificateEncryption: true
    });
  }

  private async generatePlainConfigUncached(
    courseId: string,
    contentId: string,
    canvasUrl?: string,
    startUrlOverride?: string
  ): Promise<Buffer> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const setting = await this.assessments.getSebSettingForQuiz(classicId);
      if (!setting?.sebRequired || !setting.enabled || !setting.accessCode || setting.courseId !== courseId) {
        throw new Error("SEB not enabled or access code missing");
      }
      if (setting.startPassword && !setting.configKeySalt) {
        throw new Error("SEB start-password settings must be saved again before generating a configuration");
      }
      const accessCode = setting.accessCode;
      if (!accessCode) {
        throw new Error("SEB not enabled or access code missing");
      }
      const quiz = await this.assessments.getQuiz(classicId);
      if (!quiz || quiz.courseId !== courseId) {
        throw new Error("Assessment not found");
      }
      const startUrl =
        startUrlOverride || resolveClassicCanvasUrl(this.config, courseId, classicId, canvasUrl, quiz?.htmlUrl);
      return this.sebConfig.generateSebConfiguration({
        courseId,
        contentId: contentId.startsWith("classicquiz_") ? contentId : classicQuizContentId(classicId),
        startUrl,
        accessCode,
        allowedDomains: allowedDomains(setting),
        quitPassword: setting.quitPassword,
        startPassword: setting.startPassword,
        configKeySalt: setting.configKeySalt
      });
    }

    const setting = await this.assessments.getContentSebSetting(contentId);
    const parsedContentId = parseNewQuizContentId(contentId);
    if (
      !parsedContentId ||
      parsedContentId.courseId !== courseId ||
      !setting?.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      setting.courseId !== courseId ||
      setting.assignmentId !== parsedContentId.assignmentId
    ) {
      throw new Error("SEB not enabled or access code missing");
    }
    if (setting.startPassword && !setting.configKeySalt) {
      throw new Error("SEB start-password settings must be saved again before generating a configuration");
    }
    const accessCode = setting.accessCode;
    if (!accessCode) {
      throw new Error("SEB not enabled or access code missing");
    }
    const startUrl = startUrlOverride || (await this.resolveNewQuizStartUrl(courseId, contentId, setting));
    return this.sebConfig.generateSebConfiguration({
      courseId,
      contentId,
      startUrl,
      accessCode,
      allowedDomains: allowedDomains(setting),
      quitPassword: setting.quitPassword,
      startPassword: setting.startPassword,
      configKeySalt: setting.configKeySalt
    });
  }

  private async resolveCanvasStartUrl(courseId: string, contentId: string): Promise<string> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.assessments.getQuiz(classicId);
      return resolveClassicCanvasUrl(this.config, courseId, classicId, undefined, quiz?.htmlUrl);
    }
    const setting = await this.assessments.getContentSebSetting(contentId);
    if (!setting) {
      throw new Error("Assessment not found");
    }
    return this.resolveNewQuizStartUrl(courseId, contentId, setting);
  }

  private generateSetupCheckConfig(): Buffer {
    const plain = this.generatePlainSetupCheckConfig();
    return this.sebConfig.prepareSebConfigurationDownload(plain);
  }

  private currentSetupCheckConfigKey(): string {
    return this.configKey.computeConfigKey(this.generatePlainSetupCheckConfig());
  }

  private generatePlainSetupCheckConfig(): Buffer {
    const configuredBaseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!configuredBaseUrl) {
      throw new Error("Application base URL is required to generate SEB setup check configuration");
    }
    const baseUrl = configuredBaseUrl.replace(/\/+$/u, "");
    return this.sebConfig.generateSebSetupCheckConfiguration({
      startUrl: `${baseUrl}/seb/check`,
      quitUrl: `${baseUrl}/seb/check/quit`
    });
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

  private async resolveContentForLaunch(contentId: string): Promise<{
    content: SebLaunchContentView;
    setting: QuizSebSetting | ContentSebSetting | null;
    launchTarget: string;
  } | null> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.assessments.getQuiz(classicId);
      if (!quiz?.courseId) {
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
        launchTarget: resolveClassicCanvasUrl(this.config, quiz.courseId, classicId)
      };
    }
    const parsedContentId = parseNewQuizContentId(contentId);
    if (!parsedContentId) {
      return null;
    }
    const content = await this.assessments.getContentItem(contentId);
    const setting = await this.assessments.getContentSebSetting(contentId);
    if (!content && !setting) {
      return null;
    }
    const resolvedCourseId = content?.courseId || setting?.courseId;
    const assignmentId =
      setting?.assignmentId || content?.assignmentId || content?.canvasId || parsedContentId?.assignmentId;
    if (!resolvedCourseId || !assignmentId) {
      return null;
    }
    const contentView: SebLaunchContentView | null = content
      ? {
          id: content.id,
          courseId: content.courseId,
          canvasId: content.canvasId,
          assignmentId: content.assignmentId,
          contentType: "NEW_QUIZ",
          title: content.title,
          htmlUrl: content.htmlUrl,
          canvasLaunchUrl: content.canvasLaunchUrl
        }
      : null;
    return {
      content: contentView || {
        id: contentId,
        courseId: resolvedCourseId,
        canvasId: setting?.canvasId || assignmentId,
        assignmentId,
        contentType: "NEW_QUIZ",
        title: "New Quiz",
        htmlUrl: setting?.htmlUrl,
        canvasLaunchUrl: setting?.canvasLaunchUrl
      },
      setting,
      launchTarget: canvasAssignmentUrl(this.config, resolvedCourseId, assignmentId)
    };
  }

  private async resolveNewQuizStartUrl(
    courseId: string,
    contentId: string,
    setting: ContentSebSetting
  ): Promise<string> {
    const content = await this.assessments.getContentItem(contentId);
    const assignmentId = setting.assignmentId || setting.canvasId || parseNewQuizContentId(contentId)?.assignmentId;
    if (!assignmentId) {
      throw new Error("Unable to determine Canvas start URL");
    }
    const candidates = [content?.htmlUrl, setting.htmlUrl, content?.canvasLaunchUrl, setting.canvasLaunchUrl];
    for (const candidate of candidates) {
      if (candidate && isConfiguredCanvasUrl(this.config, candidate)) {
        const canonical = canonicalCanvasAssignmentUrl(this.config, courseId, assignmentId, candidate);
        if (canonical) {
          return canonical;
        }
      }
    }
    return canvasAssignmentUrl(this.config, courseId, assignmentId);
  }

  private async resolveSebSetting(
    courseId: string,
    quizId: string
  ): Promise<(QuizSebSetting | ContentSebSetting) | null> {
    const parsed = parseNewQuizContentId(quizId);
    if (parsed) {
      if (parsed.courseId !== courseId) {
        return null;
      }
      const setting = await this.assessments.getContentSebSetting(quizId);
      return setting?.courseId === courseId && setting.assignmentId === parsed.assignmentId ? setting : null;
    }
    if (quizId.startsWith("newquiz:")) {
      return null;
    }
    const setting = await this.assessments.getSebSettingForQuiz(quizId);
    return setting?.courseId === courseId ? setting : null;
  }

  private async matchesAssessmentObject(courseId: string, contentId: string): Promise<boolean> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      return false;
    }
    if (!(await this.assessments.isAssessmentAvailableForLearner(courseId, canonicalContentId))) {
      return false;
    }
    const parsed = parseNewQuizContentId(canonicalContentId);
    if (parsed) {
      if (parsed.courseId !== courseId) {
        return false;
      }
      const content = await this.assessments.getContentItem(canonicalContentId);
      return (
        content?.id === canonicalContentId &&
        content.courseId === courseId &&
        content.contentType === "NEW_QUIZ" &&
        content.assignmentId === parsed.assignmentId
      );
    }
    const quizId = extractClassicQuizId(canonicalContentId);
    if (!quizId) {
      return false;
    }
    const quiz = await this.assessments.getQuiz(quizId);
    return quiz?.id === quizId && quiz.courseId === courseId;
  }
}

function resolveClassicCanvasUrl(
  config: AppConfig,
  courseId: string,
  quizId: string,
  _canvasUrl?: string,
  _storedUrl?: string | null
): string {
  return `${config.getCanvasDomain()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}/take`;
}

function canonicalCanvasAssignmentUrl(
  config: AppConfig,
  courseId: string,
  assignmentId: string,
  value: string
): string | null {
  const url = new URL(value);
  const assignmentMatch = url.pathname.match(/^\/courses\/([^/]+)\/assignments\/([^/?#]+)(?:\/.*)?$/u);
  if (
    !assignmentMatch ||
    decodeUrlSegment(assignmentMatch[1]) !== courseId ||
    decodeUrlSegment(assignmentMatch[2]) !== assignmentId
  ) {
    return null;
  }
  return canvasAssignmentUrl(config, courseId, assignmentId);
}

function canvasAssignmentUrl(config: AppConfig, courseId: string, assignmentId: string): string {
  return `${config.getCanvasDomain()}/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}`;
}

function decodeUrlSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isConfiguredCanvasUrl(config: AppConfig, value: string): boolean {
  try {
    const candidate = new URL(value);
    const canvas = new URL(config.getCanvasDomain());
    return (
      candidate.protocol === "https:" &&
      !candidate.username &&
      !candidate.password &&
      candidate.origin.toLowerCase() === canvas.origin.toLowerCase()
    );
  } catch {
    return false;
  }
}

function allowedDomains(setting: QuizSebSetting | ContentSebSetting): string[] {
  const customEntries = urlRulesToAllowedEntries(setting.urlRules);
  return Array.from(
    new Set([
      // Legacy SSO entries are intentionally excluded. Student Canvas session
      // handoff starts the assessment without granting the identity provider
      // access inside the locked SEB session.
      ...(setting.educationalToolDomains || []),
      ...customEntries,
      ...allowlistEntriesForExternalTools(setting.externalTools)
    ])
  );
}

function renderYouTubeToolPage(playerUrl: string): string {
  const src = escapeHtmlAttribute(playerUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <title>YouTube video</title>
    <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#000}iframe{display:block}</style>
  </head>
  <body>
    <iframe title="YouTube video" src="${src}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
  </body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function proofGenerationDigest(courseId: string, contentId: string, configKey: string, accessCode: string): string {
  return createHash("sha256")
    .update(`seb-proof-v2\0${courseId}\0${contentId}\0${configKey}\0${accessCode}`, "utf8")
    .digest("base64url");
}

async function regenerateSebSession(request: Request): Promise<void> {
  if (!request.session?.regenerate) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
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
      return !!parsed && matchesPathFamily(path, `/courses/${courseId}/assignments/${parsed.assignmentId}`);
    }
    return matchesPathFamily(path, `/courses/${courseId}/quizzes/${quizId}`);
  } catch {
    return false;
  }
}

function matchesPathFamily(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isExpectedSetupCheckUrl(config: AppConfig, value: string): boolean {
  try {
    const configuredBaseUrl = config.getApplicationBaseUrl() || config.toolUrl;
    if (!configuredBaseUrl) {
      return false;
    }
    const url = new URL(value);
    const expectedBaseUrl = new URL(configuredBaseUrl);
    return (
      url.protocol === expectedBaseUrl.protocol &&
      url.host.toLowerCase() === expectedBaseUrl.host.toLowerCase() &&
      url.pathname.replace(/\/+$/u, "") === "/seb/check"
    );
  } catch {
    return false;
  }
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function sebConfigPath(courseId: string, contentId: string, grant: string): string {
  const params = new URLSearchParams();
  params.set("grant", grant);
  return `/seb/config/${encodeURIComponent(courseId)}/${encodeURIComponent(contentId)}.seb?${params.toString()}`;
}

function configGrantEndpoint(courseId: string, contentId: string): string {
  return `/api/seb/config-grant/${encodeURIComponent(courseId)}/${encodeURIComponent(contentId)}`;
}

function normalizedPublicSebContentId(contentId: string | undefined | null): string | null {
  const canonicalContentId = canonicalSebConfigContentId(contentId);
  if (!canonicalContentId) {
    return null;
  }
  if (parseNewQuizContentId(canonicalContentId)) {
    return canonicalContentId;
  }
  return extractClassicQuizId(canonicalContentId);
}

function requiresStudentSessionHandoff(principal: VerifiedLtiPrincipal): boolean {
  return isVerifiedStudent(principal) && !isVerifiedInstructor(principal);
}

function isSafeConfigNavigation(request: Request): boolean {
  const fetchSite = request.header("sec-fetch-site")?.toLowerCase();
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function setSensitiveResponseHeaders(response?: Response): void {
  if (!response) {
    return;
  }
  response
    .setHeader("cache-control", "private, no-store, max-age=0")
    .setHeader("pragma", "no-cache")
    .setHeader("expires", "0")
    .setHeader("referrer-policy", "no-referrer");
  response.vary("Origin, X-SEB-Proof-Token");
}

function consumePendingSebLaunch(
  request: Request,
  principal: VerifiedLtiPrincipal,
  courseId: string,
  contentId: string
): boolean {
  const pending = request.session?.pendingSebLaunch;
  if (request.session) {
    delete request.session.pendingSebLaunch;
  }
  return (
    !!pending &&
    Date.now() - pending.issuedAt >= 0 &&
    Date.now() - pending.issuedAt <= 120_000 &&
    pending.courseId === courseId &&
    pending.contentId === contentId &&
    pending.subject === principal.subject &&
    pending.deploymentId === principal.deploymentId
  );
}

function isDirectLtiLaunchReplay(request: Request, config: AppConfig, courseId: string, contentId: string): boolean {
  const completed = request.session?.completedSebLaunch;
  if (
    !completed ||
    completed.courseId !== courseId ||
    completed.contentId !== contentId ||
    Date.now() - completed.issuedAt < 0 ||
    Date.now() - completed.issuedAt > 86_400_000
  ) {
    return false;
  }
  const targetLinkUri = request.session?.launchData?.targetLinkUri;
  try {
    const target = new URL(targetLinkUri || "");
    const tool = new URL(config.getRequiredToolUrl());
    if (target.origin !== tool.origin || target.search || target.hash) {
      return false;
    }
    const match = target.pathname.match(/^\/seb\/launch\/([^/]{1,300})$/u);
    return !!match && canonicalSebConfigContentId(decodeURIComponent(match[1])) === contentId;
  } catch {
    return false;
  }
}

async function saveSebSession(request: Request): Promise<void> {
  if (!request.session?.save) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    request.session!.save((error) => (error ? reject(error) : resolve()));
  });
}
