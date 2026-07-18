import { Controller, Get, Param, Post, Put, Body, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ExternalToolConfig, StructuredSebConfigRequest } from "../../shared/models.js";
import {
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  defaultQuizSebSetting,
  legacyDomainsToUrlRules,
  normalizeCourseSebDefaults,
  normalizeConcreteDomains,
  normalizeExternalToolAccessRules,
  normalizeExternalToolIds,
  normalizeExternalTools,
  normalizeUrlRules,
  parseNewQuizContentId,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { apiError } from "../http/api-error.js";
import { toCourseDefaultsView, toSebSettingView } from "../http/seb-response.js";
import { AssessmentAuthorizationService } from "../services/assessment-authorization.service.js";
import { AssessmentService } from "../services/assessment.service.js";
import {
  type CanvasApiPermissionError,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError
} from "../services/canvas-api.service.js";
import { CourseSettingsService } from "../services/course-settings.service.js";
import { hasEffectiveSebQuitPassword } from "../services/seb-quit-password.js";

@Controller("/api/quizzes")
export class QuizController {
  constructor(
    private readonly config: AppConfig,
    private readonly assessments: AssessmentService,
    private readonly courseSettings: CourseSettingsService,
    private readonly authorization: AssessmentAuthorizationService
  ) {}

  @Post("/course/:courseId/refresh")
  async refresh(@Req() request: Request, @Param("courseId") courseId: string): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireInstructorForCourse(request, courseId, true);
    const userId = principal.canvasUserId;
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
    this.authorization.requireInstructorForCourse(request, courseId);
    return {
      success: true,
      defaults: toCourseDefaultsView(
        await this.courseSettings.getDefaults(courseId),
        this.config.value.seb.defaultQuitPassword
      )
    };
  }

  @Put("/course/:courseId/defaults")
  async saveCourseDefaults(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Body() body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    this.authorization.requireInstructorForCourse(request, courseId, true);
    assertSafePolicyInput(body);
    const existing = await this.courseSettings.getDefaults(courseId);
    const hasToolCatalog = Array.isArray(body.externalTools);
    const defaults = await this.courseSettings.saveDefaults(
      courseId,
      normalizeCourseSebDefaults({
        courseId,
        quitPassword: secretUpdate(body, "quitPassword", existing.quitPassword),
        startPassword: secretUpdate(body, "startPassword", existing.startPassword),
        urlRules: Array.isArray(body.urlRules) ? (body.urlRules as any) : [],
        externalTools: hasToolCatalog ? (body.externalTools as any) : existing.externalTools,
        externalToolsInitialized: hasToolCatalog || existing.externalToolsInitialized === true,
        setupCompleted: body.setupCompleted !== false
      })
    );
    return {
      success: true,
      defaults: toCourseDefaultsView(defaults, this.config.value.seb.defaultQuitPassword)
    };
  }

  @Post("/course/:courseId/passwords/reveal")
  async revealCoursePasswords(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("courseId") courseId: string
  ): Promise<Record<string, unknown>> {
    this.authorization.requireInstructorForCourse(request, courseId, true);
    setPasswordRevealHeaders(response);
    const defaults = await this.courseSettings.getDefaults(courseId);
    return passwordRevealResponse(
      defaults.startPassword || null,
      defaults.startPassword ? "course" : "none",
      defaults.quitPassword || null,
      defaults.quitPassword ? "course" : this.config.value.seb.defaultQuitPassword ? "managed" : "none"
    );
  }

  @Post("/:courseId/:quizId/passwords/reveal")
  async revealAssessmentPasswords(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const { assessment } = await this.authorization.requireInstructorForAssessment(request, courseId, quizId, true);
    setPasswordRevealHeaders(response);
    const startPassword = assessment.seb.startPassword || null;
    const quitPassword = assessment.seb.quitPassword || null;
    return passwordRevealResponse(
      startPassword,
      startPassword ? (assessment.seb.startPasswordOverride ? "assessment" : "course") : "none",
      quitPassword,
      quitPassword
        ? assessment.seb.quitPasswordOverride
          ? "assessment"
          : "course"
        : this.config.value.seb.defaultQuitPassword
          ? "managed"
          : "none"
    );
  }

  @Put("/:quizId/seb")
  async updateSebRequirement(
    @Req() request: Request,
    @Param("quizId") quizId: string,
    @Body() body: Record<string, boolean>
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireInstructor(request, true);
    assertSafePolicyInput(body as unknown as Record<string, unknown>);
    const courseId = principal.courseId;
    const userId = principal.canvasUserId;
    await this.authorization.requireInstructorForAssessment(request, courseId, quizId, true);
    const required = !!body.required;
    try {
      if (required) {
        const setting = await this.assessments.enableSebWithAccessCode(
          courseId,
          quizId,
          userId,
          await this.courseSettings.getDefaults(courseId)
        );
        return {
          success: true,
          setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
        };
      }
      const setting = await this.assessments.disableSebWithAccessCode(courseId, quizId, userId);
      return {
        success: true,
        setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
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

  @Post("/seb-config-structured")
  async saveStructured(
    @Req() request: Request,
    @Body() body: StructuredSebConfigRequest,
    @Query("userId") userId?: string
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireInstructor(request, true);
    const sessionUser = principal.canvasUserId;
    if (userId && userId !== sessionUser) {
      return apiError(403, "User mismatch");
    }
    if (Object.hasOwn(body, "externalTools")) {
      return apiError(400, "Exam tool definitions are managed in Course settings", {
        error_code: "QUIZ_TOOL_DEFINITIONS_NOT_ALLOWED"
      });
    }
    assertSafePolicyInput(body as unknown as Record<string, unknown>);
    const contentId = body.contentId || body.quizId;
    if (!contentId) {
      return apiError(400, "quizId or contentId is required");
    }
    const parsed = parseNewQuizContentId(contentId);
    const courseId = principal.courseId;
    if ((body.courseId && body.courseId !== courseId) || (parsed && parsed.courseId !== courseId)) {
      return apiError(403, "Course mismatch");
    }
    await this.authorization.requireInstructorForAssessment(request, courseId, contentId, true);
    const defaults = await this.courseSettings.getDefaults(courseId);
    const urlRules = Array.isArray(body.urlRules)
      ? normalizeUrlRules(body.urlRules)
      : legacyDomainsToUrlRules(body.customDomains);
    const ssoDomains = normalizeConcreteDomains(body.ssoDomains);
    const educationalToolDomains = normalizeConcreteDomains(body.educationalToolDomains);
    if (parsed) {
      const setting = await this.assessments.getContentSebSetting(contentId);
      if (!setting) {
        return apiError(404, "Assessment not found");
      }
      const externalToolIds = requestedExternalToolIds(body, setting.externalToolIds);
      const saved = await this.assessments.saveContentSebSetting(
        applyCourseDefaultsToContentSetting(
          {
            ...setting,
            ssoDomains,
            educationalToolDomains,
            customDomains: urlRulesToAllowedEntries(urlRules),
            urlRules,
            externalTools: setting.externalTools,
            quizOnlyExternalTools: requestedQuizOnlyTools(body, setting.quizOnlyExternalTools),
            externalToolIds,
            externalToolUrl: body.externalToolUrl || setting.externalToolUrl || null,
            quitPassword: secretUpdate(
              body as unknown as Record<string, unknown>,
              "quitPassword",
              setting.quitPassword
            ),
            startPassword: secretUpdate(
              body as unknown as Record<string, unknown>,
              "startPassword",
              setting.startPassword
            ),
            usesCourseDefaults: body.usesCourseDefaults === true,
            quitPasswordOverride: body.quitPasswordOverride === true,
            startPasswordOverride: body.startPasswordOverride === true,
            // Saving policy must not bypass the Canvas access-code commit workflow.
            sebRequired: setting.sebRequired,
            enabled: setting.enabled
          },
          defaults
        )
      );
      return {
        success: true,
        setting: toSebSettingView(saved, this.config.value.seb.defaultQuitPassword)
      };
    }
    const setting = body.quizId ? await this.assessments.getSebSettingForQuiz(body.quizId) : null;
    if (!body.quizId || !setting) {
      return apiError(404, "Assessment not found");
    }
    const externalToolIds = requestedExternalToolIds(body, setting.externalToolIds);
    const saved = await this.assessments.saveQuizSebSetting(
      applyCourseDefaultsToQuizSetting(
        {
          ...defaultQuizSebSetting(body.quizId, courseId),
          ...setting,
          id: setting?.id || body.quizId,
          quizId: body.quizId,
          courseId: courseId || setting?.courseId || null,
          ssoDomains,
          educationalToolDomains,
          customDomains: urlRulesToAllowedEntries(urlRules),
          urlRules,
          externalTools: setting.externalTools,
          quizOnlyExternalTools: requestedQuizOnlyTools(body, setting.quizOnlyExternalTools),
          externalToolIds,
          externalToolUrl: body.externalToolUrl || setting?.externalToolUrl || null,
          quitPassword: secretUpdate(body as unknown as Record<string, unknown>, "quitPassword", setting.quitPassword),
          startPassword: secretUpdate(
            body as unknown as Record<string, unknown>,
            "startPassword",
            setting.startPassword
          ),
          usesCourseDefaults: body.usesCourseDefaults === true,
          quitPasswordOverride: body.quitPasswordOverride === true,
          startPasswordOverride: body.startPasswordOverride === true,
          // Saving policy must not bypass the Canvas access-code commit workflow.
          sebRequired: setting.sebRequired,
          enabled: setting.enabled
        },
        defaults
      )
    );
    return {
      success: true,
      setting: toSebSettingView(saved, this.config.value.seb.defaultQuitPassword)
    };
  }

  @Get()
  async getQuizzes(@Req() request: Request): Promise<unknown> {
    const principal = this.authorization.requireInstructor(request);
    return this.assessments.getQuizzesForCourse(principal.courseId);
  }

  @Get("/seb-settings")
  async getSettings(@Req() request: Request): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireInstructor(request);
    const courseId = principal.courseId;
    const quizzes = await this.assessments.getQuizzesForCourse(courseId);
    const settings: Record<string, unknown> = {};
    for (const quiz of quizzes) {
      const setting = await this.assessments.getSebSettingForQuiz(quiz.id);
      if (setting) {
        settings[quiz.id] = toSebSettingView(setting, this.config.value.seb.defaultQuitPassword);
      }
    }
    return settings;
  }

  @Get("/:quizId")
  async getQuiz(@Req() request: Request, @Param("quizId") quizId: string): Promise<unknown> {
    const principal = this.authorization.requireInstructor(request);
    await this.authorization.requireInstructorForAssessment(request, principal.courseId, quizId);
    return this.assessments.getQuiz(quizId);
  }

  @Post("/:courseId/:quizId/seb/enable")
  async enable(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireInstructorForAssessment(request, courseId, quizId, true);
    const userId = principal.canvasUserId;
    try {
      const parsed = parseNewQuizContentId(quizId);
      if (parsed) {
        const setting = await this.assessments.enableContentSebWithAccessCode(
          courseId,
          quizId,
          parsed.assignmentId,
          userId,
          await this.courseSettings.getDefaults(courseId)
        );
        return {
          success: true,
          message: "SEB enabled.",
          setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
        };
      }
      const setting = await this.assessments.enableSebWithAccessCode(
        courseId,
        quizId,
        userId,
        await this.courseSettings.getDefaults(courseId)
      );
      return {
        success: true,
        message: "SEB enabled.",
        setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
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
    await this.authorization.requireInstructorForAssessment(request, courseId, quizId, true);
    const setting = await this.courseSettings.resetQuizToDefaults(courseId, quizId);
    if (!setting) {
      return apiError(404, "No SEB setting found for this quiz");
    }
    return {
      success: true,
      setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
    };
  }

  @Post("/:courseId/:quizId/seb/disable")
  async disable(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireInstructorForAssessment(request, courseId, quizId, true);
    const userId = principal.canvasUserId;
    try {
      const parsed = parseNewQuizContentId(quizId);
      if (parsed) {
        const setting = await this.assessments.disableContentSebWithAccessCode(
          courseId,
          quizId,
          parsed.assignmentId,
          userId
        );
        return {
          success: true,
          message: "SEB disabled.",
          setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
        };
      }
      const setting = await this.assessments.disableSebWithAccessCode(courseId, quizId, userId);
      return {
        success: true,
        message: "SEB disabled.",
        setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
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

  @Get("/:courseId/:quizId/seb/config")
  redirectConfig(
    @Res() response: Response,
    @Param("courseId") _courseId: string,
    @Param("quizId") quizId: string
  ): void {
    response.redirect(302, `/seb/launch/${encodeURIComponent(quizId)}`);
  }

  @Post("/:courseId/:quizId/seb/regenerate-code")
  async regenerate(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireInstructorForAssessment(request, courseId, quizId, true);
    const userId = principal.canvasUserId;
    try {
      const parsed = parseNewQuizContentId(quizId);
      const setting = parsed
        ? await this.assessments.regenerateContentAccessCode(courseId, quizId, parsed.assignmentId, userId)
        : await this.assessments.regenerateQuizAccessCode(courseId, quizId, userId);
      if (!setting) {
        return apiError(404, "SEB is not enabled for this quiz");
      }
      return {
        success: true,
        message: "SEB access code regenerated. Students should reopen the quiz from Canvas."
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
  async status(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("quizId") quizId: string
  ): Promise<Record<string, unknown>> {
    await this.authorization.requireInstructorForAssessment(request, courseId, quizId);
    const parsed = parseNewQuizContentId(quizId);
    if (parsed) {
      const setting = await this.assessments.getContentSebSetting(quizId);
      return {
        authenticated: true,
        canvasDomain: this.config.getCanvasDomain().replace(/^https?:\/\//u, ""),
        sebEnabled: !!setting?.sebRequired,
        hasAccessCode: !!setting?.accessCode,
        configValid: !!(
          setting?.sebRequired &&
          setting.accessCode &&
          hasEffectiveSebQuitPassword(setting.quitPassword, this.config.value.seb.defaultQuitPassword)
        ),
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
      externalTools: normalizeExternalTools(setting?.externalTools)
    };
  }
}

function secretUpdate(
  body: Record<string, unknown>,
  key: "quitPassword" | "startPassword",
  existing: string | null | undefined
): string | null {
  if (!Object.hasOwn(body, key)) {
    return existing || null;
  }
  const value = body[key];
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.trim() ? value : existing || null;
}

function assertSafePolicyInput(body: Record<string, unknown>): void {
  const rules = Array.isArray(body.urlRules) ? body.urlRules : [];
  if (rules.some((rule) => normalizeUrlRules([rule as any]).length !== 1)) {
    apiError(
      400,
      "Allowed URLs must be exact HTTPS URLs or concrete domains; regex and wildcard rules are not allowed",
      {
        error_code: "INVALID_SEB_URL_POLICY"
      }
    );
  }
  for (const key of ["ssoDomains", "educationalToolDomains", "customDomains"] as const) {
    const values = Array.isArray(body[key]) ? (body[key] as unknown[]) : [];
    if (
      values.some(
        (value) =>
          typeof value !== "string" ||
          (key === "customDomains"
            ? legacyDomainsToUrlRules([value]).length !== 1
            : normalizeConcreteDomains([value]).length !== 1)
      )
    ) {
      apiError(400, "SEB domain rules must use concrete hostnames without wildcards", {
        error_code: "INVALID_SEB_DOMAIN_POLICY"
      });
    }
  }
  const tools = [
    ...(Array.isArray(body.externalTools) ? (body.externalTools as Array<Record<string, unknown>>) : []),
    ...(Array.isArray(body.quizOnlyExternalTools) ? (body.quizOnlyExternalTools as Array<Record<string, unknown>>) : [])
  ];
  if (
    tools.some(
      (tool) =>
        tool.matchType === "regex" ||
        typeof tool.allowedPattern === "string" ||
        typeof tool.url !== "string" ||
        !tool.url.trim().startsWith("https://") ||
        // Responses retain legacy `allowedDomains` as a derived compatibility
        // field. Current custom tools submit it beside authoritative rules.
        (Array.isArray(tool.allowedDomains) &&
          tool.allowedDomains.length > 0 &&
          !tool.preset &&
          !(Array.isArray(tool.allowedRules) && tool.allowedRules.length > 0)) ||
        (Array.isArray(tool.allowedRules) &&
          (tool.allowedRules as unknown[]).some(
            (rule) =>
              normalizeExternalToolAccessRules([rule as any]).length !== 1 ||
              ((rule as { match?: unknown; broadDomainConfirmed?: unknown }).match === "domain" &&
                (rule as { broadDomainConfirmed?: unknown }).broadDomainConfirmed !== true)
          )) ||
        normalizeExternalTools([tool as any]).length !== 1
    )
  ) {
    apiError(400, "External tools must use an exact HTTPS launch URL and explicit safe resource paths", {
      error_code: "INVALID_SEB_TOOL_POLICY"
    });
  }
}

function requestedQuizOnlyTools(
  body: StructuredSebConfigRequest,
  existing?: ExternalToolConfig[] | null
): ExternalToolConfig[] {
  if (!Object.hasOwn(body, "quizOnlyExternalTools")) {
    return normalizeExternalTools(existing);
  }
  if (!Array.isArray(body.quizOnlyExternalTools)) {
    return apiError(400, "Quiz-only exam tools must be a list", {
      error_code: "INVALID_SEB_TOOL_POLICY"
    });
  }
  return normalizeExternalTools(body.quizOnlyExternalTools).map((tool) => ({
    ...tool,
    enabled: true,
    managedByAdmin: false,
    adminPresetId: null
  }));
}

function requestedExternalToolIds(
  body: StructuredSebConfigRequest,
  existing?: string[] | null
): string[] | null | undefined {
  if (!Object.hasOwn(body, "externalToolIds")) {
    return existing;
  }
  if (body.externalToolIds !== null && !Array.isArray(body.externalToolIds)) {
    apiError(400, "Exam tool selections must be a list of course tool ids", {
      error_code: "INVALID_SEB_TOOL_SELECTION"
    });
  }
  return normalizeExternalToolIds(body.externalToolIds);
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
      "Canvas denied this update. The saved Canvas authorization is valid, but Canvas rejected the write request. Confirm the Canvas API Developer Key allows quiz access-code write scopes, then reauthorize Canvas.",
    canvasStatus: error.status,
    canvasPath: safeCanvasPath(error.url)
  };
}

function safeCanvasPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

type PasswordSource = "assessment" | "course" | "managed" | "none";

function passwordRevealResponse(
  startPassword: string | null,
  startSource: PasswordSource,
  quitPassword: string | null,
  quitSource: PasswordSource
): Record<string, unknown> {
  return {
    success: true,
    expiresInSeconds: 30,
    passwords: {
      start: { value: startPassword, source: startSource },
      // A managed server default is intentionally never returned to the browser.
      exit: { value: quitSource === "managed" ? null : quitPassword, source: quitSource }
    }
  };
}

function setPasswordRevealHeaders(response: Response): void {
  response.setHeader("cache-control", "private, no-store, max-age=0");
  response.setHeader("pragma", "no-cache");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
}
