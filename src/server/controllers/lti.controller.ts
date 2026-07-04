import { randomUUID } from "node:crypto";
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ContentItem, LtiLaunchData, Quiz } from "../../shared/models.js";
import { isInstructor, isStudent } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { createActionToken } from "../http/action-token.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";
import { sebSchemeUrl } from "../http/request-url.js";
import {
  CanvasApiService,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError,
  isCanvasApiRequestError
} from "../services/canvas-api.service.js";
import { ContentService } from "../services/content.service.js";
import { JwkService } from "../services/jwk.service.js";
import { LtiService } from "../services/lti.service.js";
import { LtiStateService } from "../services/lti-state.service.js";
import { QuizService } from "../services/quiz.service.js";
import { SebDetector } from "../services/seb-detector.service.js";

@Controller()
export class LtiController {
  constructor(
    private readonly config: AppConfig,
    private readonly ltiService: LtiService,
    private readonly ltiState: LtiStateService,
    private readonly jwkService: JwkService,
    private readonly quizService: QuizService,
    private readonly canvasApi: CanvasApiService,
    private readonly contentService: ContentService,
    private readonly sebDetector: SebDetector
  ) {}

  @Get("/lti/login")
  loginGet(@Req() request: Request, @Res() response: Response): void {
    this.handleLogin(request, response, request.query as Record<string, string>);
  }

  @Post("/lti/login")
  @HttpCode(302)
  loginPost(@Req() request: Request, @Res() response: Response, @Body() body: Record<string, string>): void {
    this.handleLogin(request, response, body);
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
            `<h1>LTI Launch Error</h1><p>${escapeHtml(body.error_description || body.error)}</p>`
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
    try {
      const state = this.ltiState.consumeState(body.state);
      const launchData = await this.ltiService.validateToken(body.id_token, state.nonce);
      storeLaunchData(request, launchData);

      if (launchData.messageType === "LtiDeepLinkingRequest") {
        response.redirect(`/lti/deeplink/select?course_id=${encodeURIComponent(launchData.courseId || "")}`);
        return;
      }

      if (isInstructor(launchData)) {
        response.send(
          await this.renderTeacherView(request, launchData.courseId ?? undefined, launchData.userId, launchData)
        );
        return;
      }

      if (isStudent(launchData)) {
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
      response
        .status(400)
        .send(
          renderFallbackHtml(
            "Invalid LTI Launch",
            `<h1>Invalid LTI Launch</h1><p>${escapeHtml(errorMessage(error))}</p>`
          )
        );
    }
  }

  @Get("/lti/launch")
  async launchGet(
    @Req() request: Request,
    @Res() response: Response,
    @Query("course_id") courseId?: string,
    @Query("user_id") userId?: string
  ): Promise<void> {
    const launchData = sessionValue<LtiLaunchData>(request, "launchData");
    const resolvedCourseId = courseId || launchData?.courseId;
    const resolvedUserId = userId || launchData?.userId;
    if (!resolvedCourseId || !resolvedUserId) {
      response.redirect("/login");
      return;
    }
    if (courseId || userId) {
      storeLaunchData(request, {
        ...(launchData || {}),
        userId: resolvedUserId,
        courseId: resolvedCourseId,
        roles: launchData?.roles || []
      });
    }
    response.send(await this.renderTeacherView(request, resolvedCourseId, resolvedUserId, launchData || undefined));
  }

  @Get("/lti/config")
  ltiConfig(): Record<string, unknown> {
    const toolUrl = this.config.getRequiredToolUrl();
    return {
      title: "Safe Exam Browser Canvas Integration",
      description: "Require Safe Exam Browser for Canvas Classic Quizzes and New Quizzes.",
      oidc_initiation_url: `${toolUrl}/lti/login`,
      target_link_uri: `${toolUrl}/lti/launch`,
      public_jwk_url: `${toolUrl}/.well-known/jwks.json`,
      scopes: [
        "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
        "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
        "https://purl.imsglobal.org/spec/lti-dl/scope/contentitem"
      ],
      extensions: [
        {
          platform: "canvas.instructure.com",
          settings: {
            text: "Safe Exam Browser",
            placements: [
              {
                placement: "course_navigation",
                message_type: "LtiResourceLinkRequest",
                target_link_uri: `${toolUrl}/lti/launch`
              },
              {
                placement: "assignment_selection",
                message_type: "LtiDeepLinkingRequest",
                target_link_uri: `${toolUrl}/lti/launch`
              }
            ]
          }
        }
      ],
      custom_fields: {
        canvas_course_id: "$Canvas.course.id",
        canvas_user_id: "$Canvas.user.id"
      }
    };
  }

  @Get("/lti/deeplink/select")
  async deepLinkSelect(
    @Req() request: Request,
    @Res() response: Response,
    @Query("course_id") courseId?: string
  ): Promise<void> {
    const launchData = sessionValue<LtiLaunchData>(request, "launchData");
    const resolvedCourseId = courseId || launchData?.courseId;
    const userId = launchData?.userId;
    let quizzes: Quiz[] = [];
    if (resolvedCourseId && userId) {
      try {
        quizzes = await this.quizService.getQuizzesForCourse(resolvedCourseId, userId);
      } catch (error) {
        if (isCanvasApiAuthorizationError(error)) {
          response.send(
            this.renderApiAuthorizationView(
              request,
              resolvedCourseId,
              userId,
              "Canvas rejected the saved authorization. Reauthorize Canvas access before selecting content.",
              true
            )
          );
          return;
        }
        if (isCanvasApiPermissionError(error)) {
          response.send(renderCanvasContentError(resolvedCourseId, error));
          return;
        }
        throw error;
      }
    }
    response.send(
      renderAppShell({
        title: "Configure SEB Links",
        view: "deep-link-select",
        initialData: { courseId: resolvedCourseId, quizzes }
      })
    );
  }

  @Post("/lti/deeplink/process")
  async deepLinkProcess(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: Record<string, string>
  ): Promise<void> {
    const launchData = sessionValue<LtiLaunchData>(request, "launchData");
    if (!launchData?.deepLinkingSettings || !launchData.deploymentId) {
      response.status(400).send("Missing deep linking launch data");
      return;
    }
    const returnUrl = String((launchData.deepLinkingSettings as Record<string, unknown>).deep_link_return_url || "");
    const quizIds = Object.keys(body)
      .filter((key) => key.startsWith("quiz_"))
      .map((key) => key.slice("quiz_".length));
    const contentItems = await Promise.all(
      quizIds.map(async (quizId) => this.deepLinkItemForQuiz(quizId, body[`seb_${quizId}`] === "on"))
    );
    const jwt = await this.jwkService.signDeepLinkingJwt(
      {
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id": launchData.deploymentId,
        "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": contentItems,
        data: (launchData.deepLinkingSettings as Record<string, unknown>).data
      },
      this.config.getRequiredToolUrl(),
      this.config.value.lti.issuer
    );
    response.type("html").send(autoSubmitDeepLinkForm(returnUrl, jwt));
  }

  @Post("/lti/deeplink/update-seb")
  async updateSebDeepLink(@Body() body: Record<string, string>): Promise<Record<string, unknown>> {
    const quizId = body.quizId;
    if (!quizId) {
      return { success: false, error: "quizId is required" };
    }
    await this.quizService.updateSebConfigurationStructured({ quizId }, body.sebRequired === "true");
    return { success: true };
  }

  private handleLogin(request: Request, response: Response, params: Record<string, string>): void {
    const issuer = params.iss;
    const loginHint = params.login_hint;
    const targetLinkUri = params.target_link_uri;
    if (!issuer || !loginHint || !targetLinkUri) {
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
    const nonce = randomUUID();
    const state = this.ltiState.createState({ nonce, targetLinkUri });
    const redirectUri = `${this.config.getRequiredToolUrl()}/lti/launch`;
    const authUrl = new URL(this.config.value.lti.authUrl);
    authUrl.searchParams.set("scope", "openid");
    authUrl.searchParams.set("response_type", "id_token");
    authUrl.searchParams.set("client_id", params.client_id || this.config.value.lti.clientId || "");
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
    request.session!.target_link_uri = targetLinkUri;
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
      const classicQuizzes = await this.quizService.getQuizzesForCourse(courseId, userId, true);
      const content = await this.contentService.getAllContentForCourse(courseId, userId);
      const newQuizzes = content.filter((item) => item.contentType === "NEW_QUIZ");
      const quizzes = [...classicQuizzes.map(quizView), ...newQuizzes.map(contentView)];
      const quizSebSettings: Record<string, unknown> = {};
      for (const quiz of classicQuizzes) {
        const setting = await this.quizService.getSebSettingForQuiz(quiz.id);
        if (setting) {
          quizSebSettings[quiz.id] = setting;
        }
      }
      for (const item of newQuizzes) {
        const setting = await this.contentService.getSebSetting(item.id);
        if (setting) {
          quizSebSettings[item.id] = setting;
        }
      }
      return renderAppShell({
        title: "Safe Exam Browser Manager",
        view: "teacher",
        initialData: {
          courseId,
          userId,
          courseName: launchData?.courseName,
          launchData,
          hasApiAuthorization,
          quizzes,
          quizSebSettings,
          authToken: createActionToken(this.config, userId, courseId)
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
      throw error;
    }
  }

  private renderApiAuthorizationView(
    request: Request,
    courseId: string,
    userId: string,
    message = "Authorize Canvas access so this tool can read quizzes, set access codes, and update module links.",
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

  private async renderStudentLaunch(request: Request, launchData: LtiLaunchData): Promise<string> {
    const courseId = launchData.courseId || "";
    const quizId = launchData.resourceLinkId || "";
    const setting = quizId ? await this.quizService.getSebSettingForQuiz(quizId) : null;
    if (setting?.sebRequired && !this.sebDetector.isRequestFromSeb(request, setting)) {
      const configUrl = `/seb/config/${courseId}/${quizId}.seb`;
      return renderAppShell({
        title: "Safe Exam Browser Required",
        view: "seb-required",
        initialData: {
          courseId,
          quizId,
          configUrl,
          sebConfigUrl: configUrl,
          sebLaunchUrl: sebSchemeUrl(request, configUrl, this.config.getApplicationBaseUrl())
        }
      });
    }
    return renderAppShell({
      title: "Canvas Quiz",
      view: "student",
      initialData: { launchData }
    });
  }

  private async deepLinkItemForQuiz(quizId: string, sebRequired: boolean): Promise<Record<string, unknown>> {
    const quiz = await this.quizService.getQuiz(quizId);
    const title = quiz?.title || "Canvas Quiz";
    const url = sebRequired
      ? `${this.config.getRequiredToolUrl()}/seb/redirect/${encodeURIComponent(quizId)}`
      : quiz?.htmlUrl || this.config.getRequiredToolUrl();
    return {
      type: "ltiResourceLink",
      title,
      url,
      custom: {
        seb_required: String(sebRequired),
        quiz_id: quizId,
        original_url: quiz?.htmlUrl || ""
      }
    };
  }
}

function storeLaunchData(request: Request, launchData: LtiLaunchData): void {
  request.session!.launchData = launchData;
  request.session!.ltiLaunchData = launchData;
  request.session!.canvas_user_id = launchData.userId;
  request.session!.userId = launchData.userId;
  request.session!.user_id = launchData.userId;
  if (launchData.courseId) {
    request.session!.canvas_course_id = launchData.courseId;
    request.session!.courseId = launchData.courseId;
  }
}

function sessionValue<T>(request: Request, key: string): T | undefined {
  return (request.session as unknown as Record<string, unknown> | undefined)?.[key] as T | undefined;
}

function quizView(quiz: Quiz): Record<string, unknown> {
  return {
    ...quiz,
    id: quiz.id,
    contentType: "CLASSIC_QUIZ",
    quizTypeDisplay: quiz.quizTypeDisplay || "Classic Quiz"
  };
}

function contentView(item: ContentItem): Record<string, unknown> {
  return {
    ...item,
    id: item.id,
    canvasQuizId: item.canvasId,
    quizTypeDisplay: item.quizTypeDisplay || (item.contentType === "NEW_QUIZ" ? "New Quiz" : item.contentType)
  };
}

function autoSubmitDeepLinkForm(returnUrl: string, jwt: string): string {
  return `<!doctype html><html lang="en"><body><form id="deeplink" method="post" action="${escapeAttribute(returnUrl)}"><input type="hidden" name="JWT" value="${escapeAttribute(jwt)}" /></form><script>document.getElementById("deeplink").submit();</script></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/gu, "&quot;");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderCanvasContentError(
  courseId: string,
  error: { status: number; responseBody: string; url: string }
): string {
  return renderFallbackHtml(
    "Canvas Content Unavailable",
    `<h1>Canvas Content Unavailable</h1><p>Canvas could not load course content for course <strong>${escapeHtml(courseId)}</strong>.</p><p>Canvas returned ${error.status}: ${escapeHtml(error.responseBody)}</p><p class="subtle">Request path: ${escapeHtml(safeCanvasPath(error.url))}</p>`
  );
}

function safeCanvasPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
