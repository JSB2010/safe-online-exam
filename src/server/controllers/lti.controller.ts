import { randomUUID } from "node:crypto";
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ContentItem, ContentSebSetting, LtiLaunchData, Quiz, QuizSebSetting } from "../../shared/models.js";
import { isInstructor, isStudent, parseNewQuizContentId } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { createActionToken } from "../http/action-token.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";
import { sebSchemeUrl } from "../http/request-url.js";
import { AssessmentService } from "../services/assessment.service.js";
import {
  CanvasApiService,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError,
  isCanvasApiRequestError
} from "../services/canvas-api.service.js";
import { CourseSettingsService } from "../services/course-settings.service.js";
import { LtiService } from "../services/lti.service.js";
import { LtiStateService } from "../services/lti-state.service.js";
import { SebDetector } from "../services/seb-detector.service.js";

@Controller()
export class LtiController {
  constructor(
    private readonly config: AppConfig,
    private readonly ltiService: LtiService,
    private readonly ltiState: LtiStateService,
    private readonly assessments: AssessmentService,
    private readonly canvasApi: CanvasApiService,
    private readonly courseSettings: CourseSettingsService,
    private readonly sebDetector: SebDetector
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
      const state = await this.ltiState.consumeState(body.state);
      const launchData = await this.ltiService.validateToken(body.id_token, state.nonce);
      storeLaunchData(request, launchData);

      if (launchData.messageType === "LtiDeepLinkingRequest") {
        response
          .status(410)
          .send(
            renderFallbackHtml(
              "Deep Linking Removed",
              "<h1>Deep Linking Removed</h1><p>Use the Safe Exam Browser course navigation app to manage SEB requirements.</p>"
            )
          );
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
    const canReuseLaunchData =
      !!launchData &&
      (!courseId || launchData.courseId === resolvedCourseId) &&
      (!userId || launchData.userId === resolvedUserId);
    const resolvedLaunchData: LtiLaunchData = {
      ...(canReuseLaunchData ? launchData : {}),
      userId: resolvedUserId,
      courseId: resolvedCourseId,
      roles: canReuseLaunchData ? launchData.roles : []
    };
    if (courseId || userId) {
      storeLaunchData(request, resolvedLaunchData);
    }
    if (isInstructor(resolvedLaunchData)) {
      response.send(await this.renderTeacherView(request, resolvedCourseId, resolvedUserId, resolvedLaunchData));
      return;
    }
    if (isStudent(resolvedLaunchData) || resolvedLaunchData.roles.length === 0) {
      response.send(await this.renderStudentLaunch(request, resolvedLaunchData));
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
    return {
      title: "Safe Exam Browser Canvas Integration",
      description: "Require Safe Exam Browser for Canvas Classic Quizzes and New Quizzes.",
      oidc_initiation_url: `${toolUrl}/lti/login`,
      target_link_uri: `${toolUrl}/lti/launch`,
      public_jwk_url: `${toolUrl}/.well-known/jwks.json`,
      scopes: [],
      extensions: [
        {
          platform: "canvas.instructure.com",
          settings: {
            text: "Safe Exam Browser",
            placements: [
              {
                placement: "course_navigation",
                message_type: "LtiResourceLinkRequest",
                target_link_uri: `${toolUrl}/lti/launch`,
                visibility: "admins",
                custom_fields: {
                  canvas_membership_roles: "$Canvas.membership.roles",
                  canvas_lis_membership_roles: "$com.Instructure.membership.roles",
                  canvas_membership_permissions:
                    "$Canvas.membership.permissions<manage_assignments_add,manage_assignments_edit,manage_course_content_add,manage_course_content_edit,manage_course_content_delete>"
                }
              }
            ]
          }
        }
      ],
      custom_fields: {
        canvas_course_id: "$Canvas.course.id",
        canvas_user_id: "$Canvas.user.id",
        canvas_membership_roles: "$Canvas.membership.roles",
        canvas_lis_membership_roles: "$com.Instructure.membership.roles",
        canvas_membership_permissions:
          "$Canvas.membership.permissions<manage_assignments_add,manage_assignments_edit,manage_course_content_add,manage_course_content_edit,manage_course_content_delete>"
      }
    };
  }

  private async handleLogin(request: Request, response: Response, params: Record<string, string>): Promise<void> {
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
    const state = await this.ltiState.createState({ nonce, targetLinkUri });
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
      const { classicQuizzes, contentItems: content } = await this.assessments.refreshCourseContent(courseId, userId);
      const newQuizzes = content.filter((item) => item.contentType === "NEW_QUIZ");
      const quizzes = [...classicQuizzes.map(quizView), ...newQuizzes.map(contentView)];
      const quizSebSettings: Record<string, unknown> = {};
      for (const quiz of classicQuizzes) {
        const setting = await this.assessments.getSebSettingForQuiz(quiz.id);
        if (setting) {
          quizSebSettings[quiz.id] = setting;
        }
      }
      for (const item of newQuizzes) {
        const setting = await this.assessments.getContentSebSetting(item.id);
        if (setting) {
          quizSebSettings[item.id] = setting;
        }
      }
      const courseDefaults = await this.courseSettings.getDefaults(courseId);
      return renderAppShell({
        title: "Safe Exam Browser Manager",
        view: "teacher",
        initialData: {
          courseId,
          userId,
          courseName: launchData?.courseName,
          launchData,
          hasApiAuthorization,
          courseDefaults,
          showSetupWizard: !courseDefaults.setupCompleted,
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

  private async renderStudentLaunch(request: Request, launchData: LtiLaunchData): Promise<string> {
    const courseId = launchData.courseId || "";
    const targetContentId =
      launchData.custom?.quiz_id || launchData.custom?.content_id || launchData.resourceLinkId || "";
    const target = targetContentId ? await this.resolveStudentContent(courseId, targetContentId, request) : null;
    if (target?.setting?.sebRequired && !this.sebDetector.isRequestFromSeb(request, target.setting)) {
      return renderAppShell({
        title: "Safe Exam Browser Required",
        view: "seb-required",
        initialData: {
          courseId,
          quizId: target.id,
          configUrl: target.configUrl,
          sebConfigUrl: target.configUrl,
          sebLaunchUrl: target.sebLaunchUrl
        }
      });
    }
    return renderAppShell({
      title: "Safe Exam Browser Quizzes",
      view: "student",
      initialData: {
        courseId,
        courseName: launchData.courseName,
        studentName: launchData.fullName,
        launchData,
        setupCheckConfigUrl: "/seb/check/config.seb",
        setupCheckLaunchUrl: sebSchemeUrl(request, "/seb/check/config.seb", this.config.getApplicationBaseUrl()),
        quizzes: courseId ? await this.enabledStudentQuizzes(courseId, request) : []
      }
    });
  }

  private async enabledStudentQuizzes(courseId: string, request: Request): Promise<Array<Record<string, unknown>>> {
    const [classicQuizzes, contentItems] = await Promise.all([
      this.assessments.getQuizzesForCourse(courseId),
      this.assessments.getCachedContentForCourse(courseId)
    ]);
    const rows: Array<Record<string, unknown>> = [];
    for (const quiz of classicQuizzes) {
      const setting = await this.assessments.getSebSettingForQuiz(quiz.id);
      if (setting?.sebRequired && setting.enabled) {
        rows.push(
          studentQuizView(
            request,
            this.config.getApplicationBaseUrl(),
            courseId,
            quiz.id,
            quiz.title,
            "Classic Quiz",
            quiz.htmlUrl
          )
        );
      }
    }
    for (const item of contentItems.filter((entry) => entry.contentType === "NEW_QUIZ")) {
      const setting = await this.assessments.getContentSebSetting(item.id);
      if (setting?.sebRequired && setting.enabled) {
        rows.push(
          studentQuizView(
            request,
            this.config.getApplicationBaseUrl(),
            courseId,
            item.id,
            item.title,
            "New Quiz",
            item.htmlUrl
          )
        );
      }
    }
    return rows.sort((left, right) => String(left.title).localeCompare(String(right.title)));
  }

  private async resolveStudentContent(
    courseId: string,
    contentId: string,
    request: Request
  ): Promise<
    | (Record<string, unknown> & {
        id: string;
        setting: QuizSebSetting | ContentSebSetting | null;
        configUrl: string;
        sebLaunchUrl: string;
      })
    | null
  > {
    const parsedNewQuiz = parseNewQuizContentId(contentId);
    if (parsedNewQuiz || contentId.startsWith("newquiz:")) {
      const content = await this.assessments.getContentItem(contentId);
      const setting = await this.assessments.getContentSebSetting(contentId);
      if (!content && !setting) {
        return null;
      }
      return {
        ...studentQuizView(
          request,
          this.config.getApplicationBaseUrl(),
          courseId || parsedNewQuiz?.courseId || setting?.courseId || "",
          contentId,
          content?.title || "New Quiz",
          "New Quiz",
          content?.htmlUrl || setting?.htmlUrl || null
        ),
        setting
      };
    }
    const quizId = contentId.startsWith("classicquiz_") ? contentId.slice("classicquiz_".length) : contentId;
    const quiz = await this.assessments.getQuiz(quizId);
    const setting = await this.assessments.getSebSettingForQuiz(quizId);
    if (!quiz && !setting) {
      return null;
    }
    return {
      ...studentQuizView(
        request,
        this.config.getApplicationBaseUrl(),
        courseId || quiz?.courseId || setting?.courseId || "",
        quizId,
        quiz?.title || "Canvas Quiz",
        "Classic Quiz",
        quiz?.htmlUrl || null
      ),
      setting
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

function studentQuizView(
  request: Request,
  baseUrl: string | undefined,
  courseId: string,
  contentId: string,
  title: string,
  quizTypeDisplay: string,
  htmlUrl?: string | null
): Record<string, unknown> & { id: string; configUrl: string; sebLaunchUrl: string } {
  const configUrl = `/seb/config/${encodeURIComponent(courseId)}/${encodeURIComponent(contentId)}.seb`;
  return {
    id: contentId,
    title,
    quizTypeDisplay,
    htmlUrl,
    configUrl,
    sebLaunchUrl: sebSchemeUrl(request, configUrl, baseUrl)
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
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
