import { Controller, Get, Param, Post, Put, Body, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ContentItem, ContentSebSetting, StructuredSebConfigRequest } from "../../shared/models.js";
import {
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  defaultQuizSebSetting,
  normalizeCourseSebDefaults,
  normalizeExternalTools,
  normalizeUrlRules,
  parseNewQuizContentId,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { verifyActionToken } from "../http/action-token.js";
import { apiError, noUserSession } from "../http/api-error.js";
import { AssessmentService, generateAccessCode, generateBrowserExamKey } from "../services/assessment.service.js";
import {
  type CanvasApiPermissionError,
  CanvasApiService,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError
} from "../services/canvas-api.service.js";
import { CourseSettingsService } from "../services/course-settings.service.js";
import { DeepLinkModuleService } from "../services/deep-link-module.service.js";

@Controller("/api/quizzes")
export class QuizController {
  constructor(
    private readonly config: AppConfig,
    private readonly assessments: AssessmentService,
    private readonly canvasApi: CanvasApiService,
    private readonly courseSettings: CourseSettingsService,
    private readonly deepLinkModules: DeepLinkModuleService
  ) {}

  @Post("/course/:courseId/refresh")
  async refresh(@Req() request: Request, @Param("courseId") courseId: string): Promise<Record<string, unknown>> {
    const userId = userIdFromRequest(request, this.config);
    if (!userId) {
      return noUserSession();
    }
    try {
      const { classicQuizzes: quizzes } = await this.assessments.refreshCourseContent(courseId, userId);
      return {
        success: true,
        message: "Quiz data refreshed successfully",
        quizCount: quizzes.length,
        quizzes: quizzes.map((quiz) => ({ id: quiz.id, title: quiz.title, canvasQuizId: quiz.canvasQuizId }))
      };
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return canvasAuthorizationRequired(courseId, userId);
      }
      if (isCanvasApiPermissionError(error)) {
        return canvasPermissionDenied(error);
      }
      throw error;
    }
  }

  @Get("/course/:courseId/defaults")
  async getCourseDefaults(
    @Req() request: Request,
    @Param("courseId") courseId: string
  ): Promise<Record<string, unknown>> {
    if (!isAuthorizedCourseRequest(request, this.config, courseId)) {
      return noUserSession();
    }
    return { success: true, defaults: await this.courseSettings.getDefaults(courseId) };
  }

  @Put("/course/:courseId/defaults")
  async saveCourseDefaults(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Body() body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!isAuthorizedCourseRequest(request, this.config, courseId)) {
      return noUserSession();
    }
    const defaults = await this.courseSettings.saveDefaults(
      courseId,
      normalizeCourseSebDefaults({
        courseId,
        quitPassword: typeof body.quitPassword === "string" ? body.quitPassword : null,
        startPassword: typeof body.startPassword === "string" ? body.startPassword : null,
        urlRules: Array.isArray(body.urlRules) ? (body.urlRules as any) : [],
        externalTools: Array.isArray(body.externalTools) ? (body.externalTools as any) : [],
        setupCompleted: body.setupCompleted !== false
      })
    );
    return { success: true, defaults };
  }

  @Put("/:quizId/seb")
  async updateSebRequirement(
    @Req() request: Request,
    @Param("quizId") quizId: string,
    @Body() body: Record<string, boolean>
  ): Promise<Record<string, unknown>> {
    const userId = userIdFromRequest(request, this.config);
    const courseId = courseIdFromRequest(request, this.config);
    if (!userId || !courseId) {
      return noUserSession();
    }
    const required = !!body.required;
    try {
      if (required) {
        const setting = await this.assessments.enableSebWithAccessCode(
          courseId,
          quizId,
          userId,
          await this.courseSettings.getDefaults(courseId)
        );
        return { success: true, setting };
      }
      const setting = await this.assessments.disableSebWithAccessCode(courseId, quizId, userId);
      return { success: true, setting };
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return canvasAuthorizationRequired(courseId, userId);
      }
      if (isCanvasApiPermissionError(error)) {
        return canvasPermissionDenied(error);
      }
      throw error;
    }
  }

  @Post("/seb-config-structured")
  async saveStructured(
    @Req() request: Request,
    @Body() body: StructuredSebConfigRequest,
    @Query("userId") userId?: string
  ): Promise<Record<string, unknown>> {
    const sessionUser = userIdFromRequest(request, this.config);
    if (!sessionUser) {
      return noUserSession();
    }
    if (userId && userId !== sessionUser) {
      return apiError(403, "User mismatch");
    }
    const contentId = body.contentId || body.quizId;
    if (!contentId) {
      return apiError(400, "quizId or contentId is required");
    }
    const parsed = parseNewQuizContentId(contentId);
    const courseId = body.courseId || parsed?.courseId || courseIdFromRequest(request, this.config);
    const defaults = courseId ? await this.courseSettings.getDefaults(courseId) : null;
    if (parsed) {
      const setting = await this.getOrCreateNewQuizSetting(contentId, parsed.courseId, parsed.assignmentId);
      const saved = await this.assessments.saveContentSebSetting(
        applyCourseDefaultsToContentSetting(
          {
            ...setting,
            ssoDomains: body.ssoDomains || [],
            educationalToolDomains: body.educationalToolDomains || [],
            customDomains: body.customDomains || urlRulesToAllowedEntries(body.urlRules),
            urlRules: normalizeUrlRules(body.urlRules),
            externalTools: normalizeExternalTools(body.externalTools),
            externalToolUrl: body.externalToolUrl || setting.externalToolUrl || null,
            quitPassword: normalizeBlank(body.quitPassword),
            startPassword: normalizeBlank(body.startPassword),
            usesCourseDefaults: body.usesCourseDefaults === true,
            quitPasswordOverride: body.quitPasswordOverride === true,
            startPasswordOverride: body.startPasswordOverride === true,
            sebRequired: true,
            enabled: setting.enabled,
            browserExamKey: setting.browserExamKey || generateBrowserExamKey()
          },
          defaults
        )
      );
      return { success: true, setting: saved };
    }
    const setting = body.quizId ? await this.assessments.getSebSettingForQuiz(body.quizId) : null;
    const saved = body.quizId
      ? await this.assessments.saveQuizSebSetting(
          applyCourseDefaultsToQuizSetting(
            {
              ...defaultQuizSebSetting(body.quizId, courseId),
              ...setting,
              id: setting?.id || body.quizId,
              quizId: body.quizId,
              courseId: courseId || setting?.courseId || null,
              ssoDomains: body.ssoDomains || [],
              educationalToolDomains: body.educationalToolDomains || [],
              customDomains: body.customDomains || urlRulesToAllowedEntries(body.urlRules),
              urlRules: normalizeUrlRules(body.urlRules),
              externalTools: normalizeExternalTools(body.externalTools),
              externalToolUrl: body.externalToolUrl || setting?.externalToolUrl || null,
              quitPassword: normalizeBlank(body.quitPassword),
              startPassword: normalizeBlank(body.startPassword),
              usesCourseDefaults: body.usesCourseDefaults === true,
              quitPasswordOverride: body.quitPasswordOverride === true,
              startPasswordOverride: body.startPasswordOverride === true,
              sebRequired: true,
              enabled: setting?.enabled ?? true,
              browserExamKey: setting?.browserExamKey || generateBrowserExamKey()
            },
            defaults
          )
        )
      : await this.assessments.updateSebConfigurationStructured(body, true);
    return { success: true, setting: saved };
  }

  @Get()
  async getQuizzes(@Req() request: Request): Promise<unknown> {
    const courseId = courseIdFromRequest(request, this.config);
    if (!courseId) {
      return noUserSession(403);
    }
    return this.assessments.getQuizzesForCourse(courseId);
  }

  @Get("/seb-settings")
  async getSettings(@Req() request: Request): Promise<Record<string, unknown>> {
    const courseId = courseIdFromRequest(request, this.config);
    if (!courseId) {
      return noUserSession(403);
    }
    const quizzes = await this.assessments.getQuizzesForCourse(courseId);
    const settings: Record<string, unknown> = {};
    for (const quiz of quizzes) {
      const setting = await this.assessments.getSebSettingForQuiz(quiz.id);
      if (setting) {
        settings[quiz.id] = setting;
      }
    }
    return settings;
  }

  @Get("/:quizId")
  async getQuiz(@Param("quizId") quizId: string): Promise<unknown> {
    return this.assessments.getQuiz(quizId);
  }

  @Post("/:courseId/:quizId/seb/enable")
  async enable(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const userId = userIdFromRequest(request, this.config);
    if (!userId) {
      return noUserSession();
    }
    try {
      const parsed = parseNewQuizContentId(quizId);
      if (parsed) {
        const setting = await this.enableNewQuiz(courseId, quizId, parsed.assignmentId, userId);
        return { success: true, message: "SEB enabled successfully with access code enforcement", setting };
      }
      const setting = await this.assessments.enableSebWithAccessCode(
        courseId,
        quizId,
        userId,
        await this.courseSettings.getDefaults(courseId)
      );
      const quiz = await this.assessments.getQuiz(quizId);
      const moduleItemUpdated = quiz
        ? await this.deepLinkModules.createOrUpdateModuleItemForQuiz(courseId, quiz, userId, true)
        : false;
      return {
        success: true,
        message: "SEB enabled successfully with access code enforcement",
        moduleItemUpdated,
        setting
      };
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return canvasAuthorizationRequired(courseId, userId);
      }
      if (isCanvasApiPermissionError(error)) {
        return canvasPermissionDenied(error);
      }
      throw error;
    }
  }

  @Post("/:courseId/:quizId/seb/reset-defaults")
  async resetDefaults(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const userId = userIdFromRequest(request, this.config);
    if (!userId) {
      return noUserSession();
    }
    const setting = await this.courseSettings.resetQuizToDefaults(courseId, quizId);
    if (!setting) {
      return apiError(404, "No SEB setting found for this quiz");
    }
    return { success: true, setting };
  }

  @Post("/:courseId/:quizId/seb/disable")
  async disable(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const userId = userIdFromRequest(request, this.config);
    if (!userId) {
      return noUserSession();
    }
    try {
      const parsed = parseNewQuizContentId(quizId);
      if (parsed) {
        const setting = await this.disableNewQuiz(courseId, quizId, parsed.assignmentId, userId);
        return { success: true, message: "SEB disabled successfully", setting };
      }
      const setting = await this.assessments.disableSebWithAccessCode(courseId, quizId, userId);
      const quiz = await this.assessments.getQuiz(quizId);
      const moduleItemRestored = quiz
        ? await this.deepLinkModules.createOrUpdateModuleItemForQuiz(courseId, quiz, userId, false)
        : false;
      return { success: true, message: "SEB disabled successfully", moduleItemRestored, setting };
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return canvasAuthorizationRequired(courseId, userId);
      }
      if (isCanvasApiPermissionError(error)) {
        return canvasPermissionDenied(error);
      }
      throw error;
    }
  }

  @Get("/:courseId/:quizId/seb/config")
  redirectConfig(
    @Res() response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): void {
    response.redirect(302, `/seb/config/${courseId}/${quizId}.seb`);
  }

  @Post("/:courseId/:quizId/seb/regenerate-code")
  async regenerate(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const userId = userIdFromRequest(request, this.config);
    if (!userId) {
      return noUserSession();
    }
    try {
      const accessCode = generateAccessCode();
      const parsed = parseNewQuizContentId(quizId);
      if (parsed) {
        const setting = await this.assessments.getContentSebSetting(quizId);
        if (!setting?.sebRequired) {
          return apiError(404, "SEB is not enabled for this quiz");
        }
        await this.canvasApi.setNewQuizAccessCode(courseId, parsed.assignmentId, accessCode, userId);
        await this.assessments.saveContentSebSetting({ ...setting, accessCode, configKey: null });
        return {
          success: true,
          message: "SEB access code regenerated. Students must download a fresh configuration file."
        };
      }
      const setting = await this.assessments.getSebSettingForQuiz(quizId);
      if (!setting?.sebRequired) {
        return apiError(404, "SEB is not enabled for this quiz");
      }
      await this.canvasApi.setQuizAccessCode(courseId, quizId, accessCode, userId);
      await this.assessments.saveQuizSebSetting({ ...setting, accessCode, configKey: null });
      return {
        success: true,
        message: "SEB access code regenerated. Students must download a fresh configuration file."
      };
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return canvasAuthorizationRequired(courseId, userId);
      }
      if (isCanvasApiPermissionError(error)) {
        return canvasPermissionDenied(error);
      }
      throw error;
    }
  }

  @Get("/:courseId/:quizId/seb/status")
  async status(@Req() request: Request, @Param("quizId") quizId: string): Promise<Record<string, unknown>> {
    if (!userIdFromRequest(request, this.config)) {
      return { authenticated: false };
    }
    const parsed = parseNewQuizContentId(quizId);
    if (parsed) {
      const setting = await this.assessments.getContentSebSetting(quizId);
      return {
        authenticated: true,
        canvasDomain: this.config.getCanvasDomain().replace(/^https?:\/\//u, ""),
        sebEnabled: !!setting?.sebRequired,
        hasAccessCode: !!setting?.accessCode,
        configValid: !!(setting?.sebRequired && setting.accessCode),
        ssoDomains: setting?.ssoDomains || [],
        educationalToolDomains: setting?.educationalToolDomains || [],
        customDomains: setting?.customDomains || [],
        externalTools: normalizeExternalTools(setting?.externalTools)
      };
    }
    const setting = await this.assessments.getSebSettingForQuiz(quizId);
    return {
      authenticated: true,
      sebEnabled: !!setting?.sebRequired,
      hasAccessCode: !!setting?.accessCode,
      configValid: await this.assessments.validateSebConfiguration(quizId),
      canvasDomain: setting?.canvasDomain || this.config.getCanvasDomain().replace(/^https?:\/\//u, ""),
      ssoDomains: setting?.ssoDomains || [],
      educationalToolDomains: setting?.educationalToolDomains || [],
      customDomains: setting?.customDomains || [],
      externalTools: normalizeExternalTools(setting?.externalTools),
      allowedSites: setting?.allowedSites
    };
  }

  private async enableNewQuiz(
    courseId: string,
    contentId: string,
    assignmentId: string,
    userId: string
  ): Promise<ContentSebSetting> {
    const accessCode = generateAccessCode();
    await this.canvasApi.setNewQuizAccessCode(courseId, assignmentId, accessCode, userId);
    const setting = await this.getOrCreateNewQuizSetting(contentId, courseId, assignmentId);
    const saved = await this.assessments.saveContentSebSetting(
      applyCourseDefaultsToContentSetting(
        {
          ...setting,
          sebRequired: true,
          enabled: true,
          accessCode,
          configKey: null,
          externalToolUrl: `${this.config.getRequiredToolUrl()}/seb/launch/${contentId}`,
          browserExamKey: setting.browserExamKey || generateBrowserExamKey()
        },
        await this.courseSettings.getDefaults(courseId)
      )
    );
    await this.deepLinkModules.createOrUpdateModuleItemForContent(
      courseId,
      buildNewQuizContent(contentId, courseId, assignmentId, saved),
      userId,
      true
    );
    return saved;
  }

  private async disableNewQuiz(
    courseId: string,
    contentId: string,
    assignmentId: string,
    userId: string
  ): Promise<ContentSebSetting> {
    const setting = await this.getOrCreateNewQuizSetting(contentId, courseId, assignmentId);
    if (setting.accessCode) {
      await this.canvasApi.removeNewQuizAccessCode(courseId, assignmentId, userId);
    }
    const saved = await this.assessments.saveContentSebSetting({
      ...setting,
      sebRequired: false,
      enabled: false,
      accessCode: null,
      configKey: null,
      externalToolUrl: null
    });
    await this.deepLinkModules.createOrUpdateModuleItemForContent(
      courseId,
      buildNewQuizContent(contentId, courseId, assignmentId, saved),
      userId,
      false
    );
    return saved;
  }

  private async getOrCreateNewQuizSetting(
    contentId: string,
    courseId: string,
    assignmentId: string
  ): Promise<ContentSebSetting> {
    return this.assessments.getOrCreateContentSebSetting(contentId, courseId, assignmentId);
  }
}

function buildNewQuizContent(
  contentId: string,
  courseId: string,
  assignmentId: string,
  setting: ContentSebSetting
): ContentItem {
  return {
    id: contentId,
    courseId,
    canvasId: assignmentId,
    assignmentId,
    contentType: "NEW_QUIZ",
    title: "New Quiz",
    htmlUrl: setting.htmlUrl || null,
    canvasLaunchUrl: setting.canvasLaunchUrl || null,
    externalToolUrl: setting.externalToolUrl || null
  };
}

function userIdFromRequest(request: Request, config: AppConfig): string | undefined {
  return (
    request.session?.launchData?.userId ||
    request.session?.userId ||
    request.session?.canvas_user_id ||
    request.session?.user_id ||
    actionTokenPayload(request, config)?.userId
  );
}

function courseIdFromRequest(request: Request, config: AppConfig): string | undefined {
  return (
    request.session?.launchData?.courseId ||
    request.session?.courseId ||
    request.session?.canvas_course_id ||
    actionTokenPayload(request, config)?.courseId
  );
}

function actionTokenPayload(request: Request, config: AppConfig): { userId: string; courseId: string } | null {
  const headerValue = request.header("x-auth-token");
  return verifyActionToken(config, headerValue);
}

function isAuthorizedCourseRequest(request: Request, config: AppConfig, courseId: string): boolean {
  const userId = userIdFromRequest(request, config);
  const resolvedCourseId = courseIdFromRequest(request, config);
  return !!userId && resolvedCourseId === courseId;
}

function normalizeBlank(value?: string | null): string | null {
  return value?.trim() ? value : null;
}

function canvasAuthorizationRequired(courseId: string, userId: string): Record<string, unknown> {
  return {
    success: false,
    requiresAuth: true,
    message: "Canvas rejected the saved authorization. Reauthorize Canvas access to continue.",
    authUrl: `/api/oauth2reauthorize?course_id=${encodeURIComponent(courseId)}&user_id=${encodeURIComponent(userId)}&redirect_url=${encodeURIComponent(`/lti/launch?course_id=${courseId}&user_id=${userId}`)}`
  };
}

function canvasPermissionDenied(error: CanvasApiPermissionError): Record<string, unknown> {
  return {
    success: false,
    error_code: "CANVAS_PERMISSION_DENIED",
    message:
      "Canvas denied this update. The saved Canvas authorization is valid, but Canvas rejected the write request. Confirm the Canvas API Developer Key allows quiz and module write scopes, then reauthorize Canvas.",
    canvasStatus: error.status,
    canvasPath: safeCanvasPath(error.url),
    canvasMessage: summarizeCanvasMessage(error.responseBody)
  };
}

function summarizeCanvasMessage(responseBody: string): string | null {
  try {
    const parsed = JSON.parse(responseBody) as { errors?: Array<{ message?: string }> };
    return (
      parsed.errors
        ?.map((entry) => entry.message)
        .filter(Boolean)
        .join("; ") || null
    );
  } catch {
    return responseBody.slice(0, 300) || null;
  }
}

function safeCanvasPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
