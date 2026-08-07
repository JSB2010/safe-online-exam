import { randomUUID } from "node:crypto";
import { Body, Controller, Get, HttpCode, Logger, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { regenerateSession, saveSession } from "../http/session-lifecycle.js";
import type { ContentItem, ContentSebSetting, LtiLaunchData, Quiz, QuizSebSetting } from "../../shared/models.js";
import { isInstructor, isStudent, parseNewQuizContentId } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { createActionToken, createAdminActionToken, createSebConfigGrantActionToken } from "../http/action-token.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";
import { toCourseDefaultsView, toSebSettingView } from "../http/seb-response.js";
import { sebSchemeUrl } from "../http/request-url.js";
import {
  CanvasLtiConfigurationError,
  createVerifiedLtiPrincipal,
  isVerifiedAccountAdmin,
  verifiedLtiPrincipal
} from "../security/verified-lti-principal.js";
import type { VerifiedAccountAdminPrincipal, VerifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import { consumePublicBudget } from "../security/public-admission.js";
import { DistributedAdmissionService, hasBoundedLtiValidationEnvelope } from "../security/distributed-admission.js";
import {
  clearLtiOidcBrowserTransactionCookie,
  createLtiOidcBrowserTransaction,
  LTI_OIDC_BROWSER_BINDING_FIELD,
  LTI_OIDC_TRANSACTION_ID_FIELD,
  matchingLtiOidcBrowserTransactionCookie,
  setLtiOidcBrowserTransactionCookie
} from "../security/lti-oidc-browser-binding.js";
import {
  AssessmentService,
  CourseMutationInProgressError,
  CourseMutationOperationLockLostError,
  CourseResetInProgressError
} from "../services/assessment.service.js";
import {
  CanvasApiService,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError,
  isCanvasApiRequestError
} from "../services/canvas-api.service.js";
import { CourseSettingsService } from "../services/course-settings.service.js";
import { isAllowedDeploymentId, LtiService } from "../services/lti.service.js";
import { LtiStateService } from "../services/lti-state.service.js";
import { canonicalSebConfigContentId } from "../services/seb-config-grant.service.js";
import { SebDetector } from "../services/seb-detector.service.js";

@Controller()
export class LtiController {
  private readonly logger = new Logger(LtiController.name);

  constructor(
    private readonly config: AppConfig,
    private readonly ltiService: LtiService,
    private readonly ltiState: LtiStateService,
    private readonly assessments: AssessmentService,
    private readonly canvasApi: CanvasApiService,
    private readonly courseSettings: CourseSettingsService,
    private readonly sebDetector: SebDetector,
    private readonly distributedAdmission: DistributedAdmissionService
  ) {}

  @Get("/lti/login")
  async loginGet(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.handleLogin(request, response, request.query as Record<string, string>);
  }

  @Post("/lti/login")
  @HttpCode(302)
  async loginPost(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: Record<string, string>
  ): Promise<void> {
    await this.handleLogin(request, response, body);
  }

  @Post("/lti/launch")
  async launchPost(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: Record<string, string>
  ): Promise<void> {
    if (body.error) {
      response
        .status(400)
        .send(
          renderFallbackHtml(
            "LTI Launch Error",
            "<h1>LTI Launch Error</h1><p>Canvas could not complete this launch. Return to the course and open Safe Online Exam again. If the problem continues, ask a Canvas administrator to verify the app installation.</p>"
          )
        );
      return;
    }
    if (!body.id_token) {
      response
        .status(400)
        .send(
          renderFallbackHtml(
            "LTI Launch Error",
            "<h1>LTI Launch Error</h1><p>Canvas did not provide an LTI id_token.</p>"
          )
        );
      return;
    }
    if (!hasBoundedLtiValidationEnvelope(body.state, body.id_token)) {
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
    let verificationStage = "state";
    try {
      const state = this.ltiState.peekState(body.state);
      verificationStage = "browser-binding";
      const transactionCookieName = matchingLtiOidcBrowserTransactionCookie(request, state);
      if (!transactionCookieName) {
        throw new Error("LTI launch browser binding does not match the initiating login");
      }
      verificationStage = "state-admission";
      if (!(await this.distributedAdmission.consumeLtiStateValidationAttempt(body.state))) {
        response.status(429).setHeader("retry-after", "60").send("Too many LTI launch attempts");
        return;
      }
      verificationStage = "token";
      const launchData = await this.ltiService.validateToken(body.id_token, state.nonce);
      verificationStage = "login-launch-binding";
      if (
        state.issuer !== launchData.issuer ||
        (state.deploymentId && state.deploymentId !== launchData.deploymentId) ||
        state.targetLinkUri !== launchData.targetLinkUri
      ) {
        throw new Error("LTI launch does not match the initiating login");
      }
      verificationStage = "state-claim";
      await this.ltiState.claimState(body.state);
      clearLtiOidcBrowserTransactionCookie(response, transactionCookieName);
      verificationStage = "session";
      await regenerateSession(request);
      verificationStage = "principal";
      const principal = createVerifiedLtiPrincipal(launchData);
      storeLaunchData(request, { ...launchData, courseId: principal.courseId });
      request.session!.verifiedLtiPrincipal = principal;
      verificationStage = "identity";
      await this.canvasApi.updateStoredIdentity?.(
        principal.canvasUserId,
        {
          displayName: launchData.fullName,
          email: launchData.email
        },
        isVerifiedAccountAdmin(principal) ? "account_admin" : "instructor"
      );

      verificationStage = "response";
      if (launchData.messageType === "LtiDeepLinkingRequest") {
        response
          .status(410)
          .send(
            renderFallbackHtml(
              "Deep Linking Removed",
              "<h1>Deep Linking Removed</h1><p>Use the Safe Online Exam course navigation app to manage secure assessment requirements.</p>"
            )
          );
        return;
      }

      if (isVerifiedAccountAdmin(principal)) {
        response.send(await this.renderAdminView(request, principal));
        return;
      }

      if (isInstructor(launchData)) {
        response.send(
          await this.renderTeacherView(request, launchData.courseId ?? undefined, launchData.userId, launchData)
        );
        return;
      }

      if (isStudent(launchData)) {
        const directContentId = sebLaunchContentIdFromTargetLinkUri(
          launchData.targetLinkUri,
          this.config.getRequiredToolUrl()
        );
        const principal = verifiedLtiPrincipal(request);
        if (directContentId && principal && principal.courseId === launchData.courseId) {
          if (!(await this.canvasApi.hasSessionTokenAccess(principal.canvasUserId))) {
            response.send(this.renderStudentSessionAuthorizationView(true));
            return;
          }
          request.session!.pendingSebLaunch = {
            courseId: principal.courseId,
            contentId: directContentId,
            subject: principal.subject,
            deploymentId: principal.deploymentId,
            issuedAt: Date.now()
          };
          await saveSession(request);
          response.redirect(303, `/seb/launch/${encodeURIComponent(directContentId)}`);
          return;
        }
        response.send(await this.renderStudentLaunch(request, launchData));
        return;
      }

      response.send(
        renderFallbackHtml(
          "LTI Launch",
          "<h1>Launch received</h1><p>Your Canvas role is not authorized for this tool.</p>"
        )
      );
    } catch (error) {
      if (error instanceof CanvasLtiConfigurationError) {
        response
          .status(400)
          .send(
            renderFallbackHtml(
              "Canvas Configuration Error",
              "<h1>Canvas Configuration Error</h1><p>Canvas did not provide the required signed user identity. Ask a Canvas administrator to refresh this tool's LTI Developer Key configuration, then reopen the tool from Canvas.</p>"
            )
          );
        return;
      }
      const failure = describeLtiLaunchFailure(error);
      this.logger.warn(`LTI launch verification failed at ${verificationStage}: ${failure.logMessage}`);
      response.status(400).send(renderFallbackHtml(failure.title, failure.html));
    }
  }

  @Get("/lti/launch")
  async launchGet(
    @Req() request: Request,
    @Res() response: Response,
    @Query("course_id") courseId?: string,
    @Query("user_id") userId?: string,
    @Query("connected") connected?: string
  ): Promise<void> {
    const principal = verifiedLtiPrincipal(request);
    const launchData = sessionValue<LtiLaunchData>(request, "launchData");
    if (isCrossSiteIframeNavigation(request)) {
      response
        .status(403)
        .send(
          renderFallbackHtml("Forbidden", "<h1>Forbidden</h1><p>Reopen this tool from Canvas course navigation.</p>")
        );
      return;
    }
    if (!principal || !launchData) {
      response.redirect("/login");
      return;
    }
    if ((courseId && courseId !== principal.courseId) || (userId && userId !== principal.canvasUserId)) {
      response
        .status(403)
        .send(
          renderFallbackHtml("Forbidden", "<h1>Forbidden</h1><p>The launch identity does not match this session.</p>")
        );
      return;
    }
    const resolvedLaunchData: LtiLaunchData = {
      ...launchData,
      userId: principal.canvasUserId,
      ltiSubject: principal.subject,
      canvasUserId: principal.canvasUserId,
      courseId: principal.courseId,
      roles: [...principal.roles]
    };
    if (isVerifiedAccountAdmin(principal)) {
      response.send(await this.renderAdminView(request, principal));
      return;
    }
    if (isInstructor(resolvedLaunchData)) {
      response.send(
        await this.renderTeacherView(request, principal.courseId, principal.canvasUserId, resolvedLaunchData)
      );
      return;
    }
    if (isStudent(resolvedLaunchData)) {
      response.send(await this.renderStudentLaunch(request, resolvedLaunchData, connected === "1"));
      return;
    }
    response.send(
      renderFallbackHtml(
        "LTI Launch",
        "<h1>Launch received</h1><p>Your Canvas role is not authorized for this tool.</p>"
      )
    );
  }

  @Get("/lti/config")
  ltiConfig(): Record<string, unknown> {
    const toolUrl = this.config.getRequiredToolUrl();
    const identityCustomFields = {
      canvas_user_id: "$Canvas.user.id"
    };
    const courseCustomFields = {
      ...identityCustomFields,
      canvas_membership_roles: "$Canvas.membership.roles",
      canvas_lis_membership_roles: "$com.Instructure.membership.roles",
      seb_launch_surface: "course",
      canvas_course_id: "$Canvas.course.id",
      canvas_membership_permissions:
        "$Canvas.membership.permissions<manage_assignments_add,manage_assignments_edit,manage_course_content_add,manage_course_content_edit,manage_course_content_delete>"
    };
    const adminCustomFields = {
      ...identityCustomFields,
      seb_launch_surface: "account_admin",
      canvas_account_id: "$Canvas.account.id",
      canvas_root_account_id: "$Canvas.rootAccount.id",
      canvas_user_is_root_account_admin: "$Canvas.user.isRootAccountAdmin"
    };
    return {
      title: "Safe Online Exam",
      description: "Require Safe Online Exam with Safe Exam Browser for Canvas Classic Quizzes and New Quizzes.",
      oidc_initiation_url: `${toolUrl}/lti/login`,
      target_link_uri: `${toolUrl}/lti/launch`,
      public_jwk_url: `${toolUrl}/.well-known/jwks.json`,
      scopes: [],
      extensions: [
        {
          platform: "canvas.instructure.com",
          privacy_level: "public",
          settings: {
            text: "Safe Online Exam",
            placements: [
              {
                placement: "course_navigation",
                message_type: "LtiResourceLinkRequest",
                target_link_uri: `${toolUrl}/lti/launch`,
                visibility: "members",
                default: "enabled",
                enabled: true,
                custom_fields: { ...courseCustomFields }
              },
              {
                placement: "account_navigation",
                message_type: "LtiResourceLinkRequest",
                target_link_uri: `${toolUrl}/lti/launch`,
                text: "Safe Online Exam Admin",
                visibility: "admins",
                required_permissions: "manage_course_content_edit",
                default: "enabled",
                enabled: true,
                display_type: "full_width_in_context",
                root_account_only: true,
                custom_fields: { ...adminCustomFields }
              }
            ]
          }
        }
      ],
      // Preserve the original course-level fields for existing Canvas
      // registrations; placement fields add the launch-surface discriminator.
      custom_fields: { ...courseCustomFields }
    };
  }

  private async renderAdminView(request: Request, principal: VerifiedAccountAdminPrincipal): Promise<string> {
    if (!(await this.canvasApi.hasAccessToken(principal.canvasUserId, "account_admin"))) {
      return renderAppShell({
        title: "Canvas Administrator Authorization Required",
        view: "api-authorization",
        initialData: {
          message:
            "Authorize Canvas access so the school dashboard can discover courses and perform approved recovery actions.",
          authUrl: "/api/admin/oauth2authorize"
        }
      });
    }
    return renderAppShell({
      title: "Safe Online Exam Administration",
      view: "admin",
      initialData: {
        userId: principal.canvasUserId,
        accountId: principal.accountId,
        rootAccountId: principal.rootAccountId,
        authToken: createAdminActionToken(this.config, principal.canvasUserId, principal.rootAccountId, {
          subject: principal.subject,
          deploymentId: principal.deploymentId,
          sessionId: request.sessionID || ""
        })
      }
    });
  }

  private async handleLogin(request: Request, response: Response, params: Record<string, string>): Promise<void> {
    const issuer = params.iss;
    const loginHint = params.login_hint;
    const targetLinkUri = params.target_link_uri;
    if (!hasBoundedLtiLoginEnvelope(params)) {
      response
        .status(400)
        .send(
          renderFallbackHtml(
            "LTI Login Error",
            "<h1>LTI Login Error</h1><p>Canvas did not provide the required OIDC login parameters.</p>"
          )
        );
      return;
    }
    if (
      !consumePublicBudget(request, "lti-login", 1_200) ||
      !(await this.distributedAdmission.consumeLtiLoginIp(request))
    ) {
      response.status(429).setHeader("retry-after", "60").send("Too many LTI login requests");
      return;
    }
    const configuredClientId = this.config.value.lti.clientId;
    if (
      issuer !== this.config.value.lti.issuer ||
      (params.client_id && params.client_id !== configuredClientId) ||
      !isAllowedTargetLinkUri(targetLinkUri, this.config.getRequiredToolUrl())
    ) {
      response
        .status(400)
        .send(renderFallbackHtml("LTI Login Error", "<h1>LTI Login Error</h1><p>Invalid LTI platform or target.</p>"));
      return;
    }
    if (
      this.config.value.lti.deploymentIdCheckingEnabled !== false &&
      !isAllowedDeploymentId(this.config.value.lti.deploymentId, params.lti_deployment_id)
    ) {
      response.status(400).send(renderDeploymentConfigurationError());
      return;
    }
    const nonce = randomUUID();
    const browserTransaction = createLtiOidcBrowserTransaction();
    const statePayload: Record<string, string> = {
      nonce,
      targetLinkUri,
      issuer,
      [LTI_OIDC_TRANSACTION_ID_FIELD]: browserTransaction.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: browserTransaction.bindingHash
    };
    if (params.lti_deployment_id) {
      statePayload.deploymentId = params.lti_deployment_id;
    }
    const state = await this.ltiState.createState(statePayload);
    const redirectUri = `${this.config.getRequiredToolUrl()}/lti/launch`;
    const authUrl = new URL(this.config.value.lti.authUrl);
    authUrl.searchParams.set("scope", "openid");
    authUrl.searchParams.set("response_type", "id_token");
    authUrl.searchParams.set("client_id", configuredClientId || "");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("login_hint", loginHint);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_mode", "form_post");
    authUrl.searchParams.set("nonce", nonce);
    authUrl.searchParams.set("prompt", "none");
    if (params.lti_message_hint) {
      authUrl.searchParams.set("lti_message_hint", params.lti_message_hint);
    }
    if (params.lti_deployment_id) {
      authUrl.searchParams.set("lti_deployment_id", params.lti_deployment_id);
    }
    setLtiOidcBrowserTransactionCookie(response, browserTransaction);
    response.redirect(authUrl.toString());
  }

  private async renderTeacherView(
    request: Request,
    courseId?: string,
    userId?: string,
    launchData?: LtiLaunchData
  ): Promise<string> {
    if (!courseId || !userId) {
      return renderFallbackHtml(
        "Canvas Authorization Required",
        "<h1>Canvas Authorization Required</h1><p>Launch this tool from a Canvas course.</p>"
      );
    }
    const hasApiAuthorization = await this.canvasApi.hasAccessToken(userId);
    if (!hasApiAuthorization) {
      return this.renderApiAuthorizationView(request, courseId, userId);
    }
    try {
      const { classicQuizzes, contentItems: content } = await this.assessments.refreshCourseContent(courseId, userId);
      const newQuizzes = content.filter((item) => item.contentType === "NEW_QUIZ");
      const quizzes = [...classicQuizzes.map(quizView), ...newQuizzes.map(contentView)];
      const quizSebSettings: Record<string, unknown> = {};
      for (const quiz of classicQuizzes) {
        const setting = await this.assessments.getSebSettingForQuiz(quiz.id);
        if (setting) {
          quizSebSettings[quiz.id] = toSebSettingView(setting, this.config.value.seb.defaultQuitPassword);
        }
      }
      for (const item of newQuizzes) {
        const setting = await this.assessments.getContentSebSetting(item.id);
        if (setting) {
          quizSebSettings[item.id] = toSebSettingView(setting, this.config.value.seb.defaultQuitPassword);
        }
      }
      // New courses are created here, after a verified instructor launch, so
      // the complete catalog is persisted without mutating ordinary reads.
      const courseDefaults = await this.courseSettings.ensureDefaults(courseId);
      return renderAppShell({
        title: "Safe Online Exam",
        view: "teacher",
        initialData: {
          courseId,
          userId,
          courseName: launchData?.courseName,
          launchData,
          hasApiAuthorization,
          courseDefaults: toCourseDefaultsView(courseDefaults, this.config.value.seb.defaultQuitPassword),
          showSetupWizard: !courseDefaults.setupCompleted,
          onboarding: {
            canvasConnection: "connected",
            courseSecurityReady:
              !!courseDefaults.quitPassword?.trim() || !!this.config.value.seb.defaultQuitPassword?.trim(),
            courseSetupComplete: courseDefaults.setupCompleted === true,
            enabledAssessmentCount: Object.values(quizSebSettings).filter(
              (setting: any) => setting?.sebRequired && setting?.enabled
            ).length
          },
          quizzes,
          quizSebSettings,
          authToken: createActionToken(this.config, userId, courseId, {
            subject: request.session!.verifiedLtiPrincipal!.subject,
            deploymentId: request.session!.verifiedLtiPrincipal!.deploymentId,
            sessionId: request.sessionID || ""
          })
        }
      });
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return this.renderApiAuthorizationView(
          request,
          courseId,
          userId,
          "Canvas rejected the saved authorization. Reauthorize Canvas access to continue.",
          true
        );
      }
      if (isCanvasApiPermissionError(error)) {
        return renderCanvasContentError(courseId, error);
      }
      if (isCanvasApiRequestError(error)) {
        return renderCanvasContentError(courseId, error);
      }
      if (
        error instanceof CourseMutationInProgressError ||
        error instanceof CourseMutationOperationLockLostError ||
        error instanceof CourseResetInProgressError
      ) {
        return renderFallbackHtml(
          "Course Update in Progress",
          '<h1>Course Update in Progress</h1><p>Safe Online Exam is finishing another update for this course. Your verified Canvas session is still active.</p><p><a href="/lti/launch">Try again</a></p>'
        );
      }
      throw error;
    }
  }

  private renderApiAuthorizationView(
    request: Request,
    courseId: string,
    userId: string,
    message = "Authorize Canvas access so this tool can read quizzes and set access codes.",
    reauthorize = false
  ): string {
    const endpoint = reauthorize ? "/api/oauth2reauthorize" : "/api/oauth2authorize";
    return renderAppShell({
      title: "Canvas Authorization Required",
      view: "api-authorization",
      initialData: {
        courseId,
        userId,
        message,
        authUrl: `${endpoint}?course_id=${encodeURIComponent(courseId)}&user_id=${encodeURIComponent(userId)}&redirect_url=${encodeURIComponent(request.originalUrl || "/lti/launch")}`
      }
    });
  }

  private async renderStudentLaunch(
    request: Request,
    launchData: LtiLaunchData,
    showReadinessPrompt = false
  ): Promise<string> {
    const courseId = launchData.courseId || "";
    const principal = verifiedLtiPrincipal(request);
    if (!principal || principal.courseId !== courseId) {
      return renderFallbackHtml(
        "Canvas Launch Required",
        "<h1>Canvas Launch Required</h1><p>Please reopen this assessment from Canvas.</p>"
      );
    }
    const assessmentTargetId =
      launchData.custom?.quiz_id ||
      launchData.custom?.content_id ||
      sebLaunchContentIdFromTargetLinkUri(launchData.targetLinkUri, this.config.getRequiredToolUrl()) ||
      "";
    const targetContentId = assessmentTargetId || launchData.resourceLinkId || "";
    if (!(await this.canvasApi.hasSessionTokenAccess(principal.canvasUserId))) {
      return this.renderStudentSessionAuthorizationView(!!assessmentTargetId);
    }
    const readinessPromptDismissed = await this.canvasApi.hasDismissedStudentReadinessPrompt(principal.canvasUserId);
    const target = targetContentId
      ? await this.resolveStudentContent(courseId, targetContentId, request, principal)
      : null;
    const configGrantToken = this.configGrantActionToken(request, principal);
    if (target?.setting?.sebRequired && !this.sebDetector.isRequestFromSeb(request, target.setting)) {
      return renderAppShell({
        title: "Safe Online Exam Required",
        view: "seb-required",
        initialData: {
          courseId,
          quizId: target.id,
          configGrantUrl: target.configGrantUrl,
          configGrantToken
        }
      });
    }
    return renderAppShell({
      title: "Safe Online Exam",
      view: "student",
      initialData: {
        courseId,
        courseName: launchData.courseName,
        studentName: launchData.fullName,
        launchData,
        setupCheckConfigUrl: "/seb/check/config.seb",
        setupCheckLaunchUrl: sebSchemeUrl(request, "/seb/check/config.seb", this.config.getApplicationBaseUrl()),
        sessionReadinessUrl: "/api/seb/session-readiness",
        configGrantToken,
        onboarding: {
          connection: "connected",
          readinessRecommended: !readinessPromptDismissed,
          showReadinessPrompt: showReadinessPrompt && !readinessPromptDismissed
        },
        quizzes: courseId ? await this.enabledStudentQuizzes(courseId, request, principal) : []
      }
    });
  }

  private renderStudentSessionAuthorizationView(resumeAssessment = false): string {
    return renderAppShell({
      title: "Connect Canvas",
      view: "student-session-authorization",
      initialData: {
        authUrl: "/api/student-session-authorize",
        onboarding: {
          connection: "required",
          resumeAssessment
        }
      }
    });
  }

  private async enabledStudentQuizzes(
    courseId: string,
    request: Request,
    principal: VerifiedLtiPrincipal
  ): Promise<Array<Record<string, unknown>>> {
    const [classicQuizzes, contentItems] = await Promise.all([
      this.assessments.getQuizzesForCourse(courseId),
      this.assessments.getCachedContentForCourse(courseId)
    ]);
    const rows: Array<Record<string, unknown>> = [];
    for (const quiz of classicQuizzes) {
      if (quiz.courseId !== courseId) {
        continue;
      }
      if (!(await this.assessments.isAssessmentAvailableForLearner(courseId, quiz.id))) {
        continue;
      }
      const setting = await this.assessments.getSebSettingForQuiz(quiz.id);
      if (setting?.courseId === courseId && setting.sebRequired && setting.enabled && setting.accessCode) {
        rows.push(
          await this.studentQuizView(
            request,
            principal,
            courseId,
            quiz.id,
            quiz.title,
            "Classic Quiz",
            quiz.htmlUrl,
            setting
          )
        );
      }
    }
    for (const item of contentItems.filter((entry) => entry.contentType === "NEW_QUIZ")) {
      const parsed = parseNewQuizContentId(item.id);
      if (item.courseId !== courseId || parsed?.courseId !== courseId || parsed.assignmentId !== item.assignmentId) {
        continue;
      }
      if (!(await this.assessments.isAssessmentAvailableForLearner(courseId, item.id))) {
        continue;
      }
      const setting = await this.assessments.getContentSebSetting(item.id);
      if (
        setting?.courseId === courseId &&
        setting.assignmentId === parsed.assignmentId &&
        setting.sebRequired &&
        setting.enabled &&
        setting.accessCode
      ) {
        rows.push(
          await this.studentQuizView(
            request,
            principal,
            courseId,
            item.id,
            item.title,
            "New Quiz",
            item.htmlUrl,
            setting
          )
        );
      }
    }
    return rows.sort((left, right) => String(left.title).localeCompare(String(right.title)));
  }

  private async resolveStudentContent(
    courseId: string,
    contentId: string,
    request: Request,
    principal: VerifiedLtiPrincipal
  ): Promise<
    | (Record<string, unknown> & {
        id: string;
        setting: QuizSebSetting | ContentSebSetting | null;
        configUrl: string;
        configGrantUrl: string;
        sebLaunchUrl: string;
      })
    | null
  > {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      return null;
    }
    if (!(await this.assessments.isAssessmentAvailableForLearner(courseId, canonicalContentId))) {
      return null;
    }
    const parsedNewQuiz = parseNewQuizContentId(canonicalContentId);
    if (parsedNewQuiz) {
      if (parsedNewQuiz.courseId !== courseId) {
        return null;
      }
      const content = await this.assessments.getContentItem(canonicalContentId);
      const setting = await this.assessments.getContentSebSetting(canonicalContentId);
      if (
        (!content && !setting) ||
        (content &&
          (content.id !== canonicalContentId ||
            content.courseId !== courseId ||
            content.assignmentId !== parsedNewQuiz.assignmentId)) ||
        (setting && (setting.courseId !== courseId || setting.assignmentId !== parsedNewQuiz.assignmentId))
      ) {
        return null;
      }
      return {
        ...(await this.studentQuizView(
          request,
          principal,
          courseId || parsedNewQuiz?.courseId || setting?.courseId || "",
          canonicalContentId,
          content?.title || "New Quiz",
          "New Quiz",
          content?.htmlUrl || setting?.htmlUrl || null,
          setting
        )),
        setting
      };
    }
    const quizId = canonicalContentId.slice("classicquiz_".length);
    const quiz = await this.assessments.getQuiz(quizId);
    const setting = await this.assessments.getSebSettingForQuiz(quizId);
    if ((!quiz && !setting) || (quiz && quiz.courseId !== courseId) || (setting && setting.courseId !== courseId)) {
      return null;
    }
    return {
      ...(await this.studentQuizView(
        request,
        principal,
        courseId || quiz?.courseId || setting?.courseId || "",
        quizId,
        quiz?.title || "Canvas Quiz",
        "Classic Quiz",
        quiz?.htmlUrl || null,
        setting
      )),
      setting
    };
  }

  private async studentQuizView(
    _request: Request,
    principal: VerifiedLtiPrincipal,
    courseId: string,
    contentId: string,
    title: string,
    quizTypeDisplay: string,
    htmlUrl: string | null | undefined,
    setting: QuizSebSetting | ContentSebSetting | null
  ): Promise<
    Record<string, unknown> & { id: string; configUrl: string; configGrantUrl: string; sebLaunchUrl: string }
  > {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (
      !canonicalContentId ||
      principal.courseId !== courseId ||
      setting?.courseId !== courseId ||
      !setting?.sebRequired ||
      !setting.enabled ||
      !setting.accessCode
    ) {
      const launchUrl = `/seb/launch/${encodeURIComponent(contentId)}`;
      return {
        id: contentId,
        title,
        quizTypeDisplay,
        htmlUrl,
        configUrl: launchUrl,
        configGrantUrl: launchUrl,
        sebLaunchUrl: launchUrl
      };
    }
    const configGrantUrl = `/api/seb/config-grant/${encodeURIComponent(courseId)}/${encodeURIComponent(canonicalContentId)}`;
    return {
      id: contentId,
      title,
      quizTypeDisplay,
      htmlUrl,
      configUrl: configGrantUrl,
      configGrantUrl,
      sebLaunchUrl: `/seb/launch/${encodeURIComponent(canonicalContentId)}`
    };
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
}

function describeLtiLaunchFailure(error: unknown): { logMessage: string; title: string; html: string } {
  const message = error instanceof Error ? error.message : "";
  if (/RS256 requires key modulusLength to be 2048 bits or larger/i.test(message)) {
    return {
      logMessage: "platform signing key modulus is below 2048 bits",
      title: "Canvas Signing-Key Error",
      html: "<h1>Canvas Signing-Key Error</h1><p>Canvas signed this launch with an RSA key smaller than 2048 bits, so the tool rejected it.</p><p>A Canvas administrator must rotate the platform LTI signing keys, restart Canvas's web service, and reopen the tool to issue a fresh launch. Do not lower the tool's signature-verification requirements.</p>"
    };
  }
  if (/LTI launch browser binding does not match the initiating login/i.test(message)) {
    return {
      logMessage: "browser transaction cookie was absent or did not match",
      title: "Canvas Launch Cookie Blocked",
      html: "<h1>Canvas Launch Cookie Blocked</h1><p>The browser did not return the short-lived security cookie created when Canvas opened this tool.</p><p>Allow third-party cookies for Canvas and this tool, then reopen it from Canvas. If the browser offers an option to open the tool in a new window, that also avoids third-party cookie blocking.</p>"
    };
  }
  if (/Validated root-account launch is missing signed numeric account identifiers/i.test(message)) {
    return {
      logMessage: "root-account launch is missing signed numeric account identifiers",
      title: "Canvas Administrator Launch Configuration Error",
      html: "<h1>Canvas Administrator Launch Configuration Error</h1><p>Canvas did not provide the signed account identifiers required by the administrator dashboard.</p><p>Refresh the LTI Developer Key from this service's current <code>/lti/config</code>, confirm the app is installed at the root account, and reopen the tool.</p>"
    };
  }
  if (/Validated root-account launch does not identify a Canvas root-account administrator/i.test(message)) {
    return {
      logMessage: "root-account administrator flag is absent or false",
      title: "Canvas Root Administrator Required",
      html: "<h1>Canvas Root Administrator Required</h1><p>This launch was not signed by Canvas as a root-account administrator.</p><p>Sign in directly as an administrator assigned at the root account. Do not launch while masquerading as another user or from a subaccount administrator account.</p>"
    };
  }
  if (/Validated root-account launch is missing a signed Canvas administrator role/i.test(message)) {
    return {
      logMessage: "root-account launch is missing a signed administrator role",
      title: "Canvas Administrator Role Required",
      html: "<h1>Canvas Administrator Role Required</h1><p>Canvas marked this user as a root-account administrator but did not include a standard signed administrator role in the LTI launch.</p><p>Confirm the user is assigned an administrator role in the root account and reopen the tool.</p>"
    };
  }
  if (/Validated course launch is missing required course context/i.test(message)) {
    return {
      logMessage: "launch placement is missing course or administrator context",
      title: "Canvas LTI Placement Configuration Error",
      html: "<h1>Canvas LTI Placement Configuration Error</h1><p>The launch did not include the context fields required for its Canvas placement.</p><p>Refresh the LTI Developer Key from this service's current <code>/lti/config</code>, then reinstall or refresh the root-account app registration.</p>"
    };
  }
  return {
    logMessage: "token verification failed",
    title: "Invalid LTI Launch",
    html: "<h1>Invalid LTI Launch</h1><p>The signed Canvas launch could not be verified. Reopen the tool from Canvas.</p><p>If this continues, ask a Canvas administrator to check the tool registration, deployment ID, issuer, and platform signing keys.</p>"
  };
}

function storeLaunchData(request: Request, launchData: LtiLaunchData): void {
  request.session!.launchData = launchData;
  request.session!.ltiLaunchData = launchData;
  const canvasUserId = launchData.canvasUserId || launchData.custom?.canvas_user_id || launchData.userId;
  request.session!.canvas_user_id = canvasUserId;
  request.session!.userId = canvasUserId;
  request.session!.user_id = canvasUserId;
  if (launchData.courseId) {
    request.session!.canvas_course_id = launchData.courseId;
    request.session!.courseId = launchData.courseId;
  }
}

function sebLaunchContentIdFromTargetLinkUri(targetLinkUri: string | null | undefined, toolUrl: string): string | null {
  try {
    const target = new URL(targetLinkUri || "");
    const tool = new URL(toolUrl);
    if (target.origin !== tool.origin || target.search || target.hash) {
      return null;
    }
    const match = target.pathname.match(/^\/seb\/launch\/([^/]{1,300})$/u);
    if (!match) {
      return null;
    }
    return canonicalSebConfigContentId(decodeURIComponent(match[1])) || null;
  } catch {
    return null;
  }
}

function isAllowedTargetLinkUri(targetLinkUri: string, toolUrl: string): boolean {
  try {
    const target = new URL(targetLinkUri);
    const tool = new URL(toolUrl);
    return (
      target.origin === tool.origin &&
      (target.pathname === "/lti/launch" || /^\/seb\/launch\/[a-z0-9:_-]{1,300}$/iu.test(target.pathname))
    );
  } catch {
    return false;
  }
}

function renderDeploymentConfigurationError(): string {
  return renderFallbackHtml(
    "LTI Deployment Configuration Required",
    [
      "<h1>LTI Deployment Configuration Required</h1>",
      "<p>Canvas launched this tool with a deployment ID that this service does not yet allow.</p>",
      "<p>This usually means the tool was installed in another Canvas course or account after the service was configured.</p>",
      "<h2>For the Canvas and service administrator</h2>",
      "<ol>",
      "<li>Find the installed external app's Canvas <code>deployment_id</code>. The Canvas External Tools API returns it for the course or account app.</li>",
      "<li>Add that ID to the service's <code>LTI_DEPLOYMENT_ID</code> allowlist without removing existing IDs.</li>",
      "<li>Deploy a new service revision, then reopen this tool from Canvas.</li>",
      "</ol>",
      "<p>For a deliberate self-service rollout, an administrator may instead set <code>LTI_DEPLOYMENT_ID_CHECKING_ENABLED=false</code>. That accepts any signed deployment from this configured Canvas issuer and client ID.</p>"
    ].join("")
  );
}

function hasBoundedLtiLoginEnvelope(params: Record<string, string>): boolean {
  return (
    hasBoundedString(params.iss, 2_048) &&
    hasBoundedString(params.login_hint, 4_096) &&
    hasBoundedString(params.target_link_uri, 2_048) &&
    (!params.client_id || hasBoundedString(params.client_id, 512)) &&
    (!params.lti_deployment_id || hasBoundedString(params.lti_deployment_id, 512)) &&
    (!params.lti_message_hint || hasBoundedString(params.lti_message_hint, 8_192))
  );
}

function hasBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isCrossSiteIframeNavigation(request: Request): boolean {
  const destination = request.header?.("sec-fetch-dest")?.trim().toLowerCase();
  const site = request.header?.("sec-fetch-site")?.trim().toLowerCase();
  return destination === "iframe" && site === "cross-site";
}

function sessionValue<T>(request: Request, key: string): T | undefined {
  return (request.session as unknown as Record<string, unknown> | undefined)?.[key] as T | undefined;
}

function quizView(quiz: Quiz): Record<string, unknown> {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    canvasQuizId: quiz.canvasQuizId,
    title: quiz.title,
    description: quiz.description,
    htmlUrl: quiz.htmlUrl,
    updatedAt: quiz.updatedAt,
    contentType: "CLASSIC_QUIZ",
    quizTypeDisplay: quiz.quizTypeDisplay || "Classic Quiz"
  };
}

function contentView(item: ContentItem): Record<string, unknown> {
  return {
    id: item.id,
    courseId: item.courseId,
    canvasQuizId: item.canvasId,
    assignmentId: item.assignmentId,
    title: item.title,
    description: item.description,
    htmlUrl: item.htmlUrl,
    contentType: item.contentType,
    quizTypeDisplay: item.quizTypeDisplay || (item.contentType === "NEW_QUIZ" ? "New Quiz" : item.contentType)
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function renderCanvasContentError(courseId: string, error: { status: number }): string {
  return renderFallbackHtml(
    "Canvas Content Unavailable",
    `<h1>Canvas Content Unavailable</h1><p>Canvas could not load course content for course <strong>${escapeHtml(courseId)}</strong>.</p><p>Canvas returned status ${error.status}. Verify the Developer Key scopes and try again.</p>`
  );
}
