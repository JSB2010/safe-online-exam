import { Controller, Get, Param, Post, Put, Body, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ExternalToolConfig, StructuredSebConfigRequest } from "../../shared/models.js";
import { setSecretResponseHeaders } from "../http/response-headers.js";
import {
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  defaultQuizSebSetting,
  legacyDomainsToUrlRules,
  normalizeCourseExternalTools,
  normalizeConcreteDomains,
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
  CanvasApiService,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError
} from "../services/canvas-api.service.js";
import { CourseSettingsService } from "../services/course-settings.service.js";
import { hasEffectiveSebQuitPassword } from "../services/seb-quit-password.js";
import {
  assertSafePolicyInput,
  canvasAuthorizationRequired,
  canvasPermissionDenied,
  COURSE_TOOL_COPY_CONCURRENCY,
  copyTargetCourseIds,
  courseSecretUpdate,
  courseToolCopyCourseView,
  courseToolCopyFailureCode,
  isDefined,
  mapWithConcurrency,
  passwordRevealResponse,
  requestedExternalToolIds,
  requestedQuizOnlyTools,
  secretUpdate
} from "./quiz-controller-helpers.js";

@Controller("/api/quizzes")
export class QuizController {
  constructor(
    private readonly config: AppConfig,
    private readonly assessments: AssessmentService,
    private readonly courseSettings: CourseSettingsService,
    private readonly authorization: AssessmentAuthorizationService,
    private readonly canvasApi: CanvasApiService
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
    const hasToolCatalog = Array.isArray(body.externalTools);
    const defaults = await this.courseSettings.saveDefaults(courseId, {
      courseId,
      quitPassword: courseSecretUpdate(body, "quitPassword"),
      startPassword: courseSecretUpdate(body, "startPassword"),
      urlRules: Array.isArray(body.urlRules) ? normalizeUrlRules(body.urlRules as any) : undefined,
      externalTools: hasToolCatalog ? normalizeCourseExternalTools(body.externalTools as any) : undefined,
      externalToolsInitialized: hasToolCatalog ? true : undefined,
      setupCompleted: body.setupCompleted !== false
    });
    return {
      success: true,
      defaults: toCourseDefaultsView(defaults, this.config.value.seb.defaultQuitPassword)
    };
  }

  @Get("/course/:courseId/exam-tools/:toolId/copy-targets")
  async getCourseToolCopyTargets(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("toolId") toolId: string
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireInstructorForCourse(request, courseId);
    await this.requireCopyableCourseTool(courseId, toolId);
    try {
      const courses = await this.canvasApi.getInstructorCourses(principal.canvasUserId);
      return {
        success: true,
        courses: courses.filter((course) => course.id !== courseId).map((course) => courseToolCopyCourseView(course))
      };
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return canvasAuthorizationRequired(courseId, principal.canvasUserId);
      }
      if (isCanvasApiPermissionError(error)) {
        return canvasPermissionDenied(error);
      }
      throw error;
    }
  }

  @Post("/course/:courseId/exam-tools/:toolId/copy")
  async copyCourseTool(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("toolId") toolId: string,
    @Body() body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireInstructorForCourse(request, courseId, true);
    const targetCourseIds = copyTargetCourseIds(body);
    if (targetCourseIds.includes(courseId)) {
      return apiError(400, "Choose a different course to copy this exam tool.", {
        error_code: "COURSE_TOOL_COPY_SOURCE_SELECTED"
      });
    }
    try {
      // Snapshot each reset generation before either the source read or the
      // live Canvas authorization call. A reset that completes while those
      // awaits are in flight must fence the later target mutation.
      const resetGenerations = new Map(
        await Promise.all(
          targetCourseIds.map(
            async (targetCourseId) =>
              [targetCourseId, await this.courseSettings.getCourseResetGeneration(targetCourseId)] as const
          )
        )
      );
      const sourceTool = await this.requireCopyableCourseTool(courseId, toolId);
      // Re-read the live Canvas list immediately before mutation. The picker is
      // only a convenience view; it is not an authorization grant.
      const availableCourses = await this.canvasApi.getInstructorCourses(principal.canvasUserId);
      const availableById = new Map(availableCourses.map((course) => [course.id, course]));
      const targetCourses = targetCourseIds.map((id) => availableById.get(id)).filter(isDefined);
      if (targetCourses.length !== targetCourseIds.length) {
        return apiError(403, "One or more selected courses are no longer available to you as an instructor.", {
          error_code: "COURSE_TOOL_COPY_TARGET_DENIED"
        });
      }

      const results = await mapWithConcurrency(targetCourses, COURSE_TOOL_COPY_CONCURRENCY, async (course) => {
        try {
          const copied = await this.courseSettings.copyInstructorToolToCourse(
            course.id,
            sourceTool,
            resetGenerations.get(course.id) || ""
          );
          return { ...courseToolCopyCourseView(course), status: copied.status };
        } catch (error) {
          return {
            ...courseToolCopyCourseView(course),
            status: "failed" as const,
            errorCode: courseToolCopyFailureCode(error)
          };
        }
      });
      const copied = results.filter((result) => result.status === "copied");
      const alreadyPresent = results.filter((result) => result.status === "already_present");
      const failed = results.filter((result) => result.status === "failed");
      return {
        success: failed.length === 0,
        copied,
        alreadyPresent,
        failed
      };
    } catch (error) {
      if (isCanvasApiAuthorizationError(error)) {
        return canvasAuthorizationRequired(courseId, principal.canvasUserId);
      }
      if (isCanvasApiPermissionError(error)) {
        return canvasPermissionDenied(error);
      }
      throw error;
    }
  }

  @Post("/course/:courseId/passwords/reveal")
  async revealCoursePasswords(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("courseId") courseId: string
  ): Promise<Record<string, unknown>> {
    this.authorization.requireInstructorForCourse(request, courseId, true);
    setSecretResponseHeaders(response);
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
    setSecretResponseHeaders(response);
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
        const setting = await this.assessments.enableSebWithAccessCode(courseId, quizId, userId);
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
    const urlRules = Array.isArray(body.urlRules)
      ? normalizeUrlRules(body.urlRules)
      : legacyDomainsToUrlRules(body.customDomains);
    const ssoDomains = normalizeConcreteDomains(body.ssoDomains);
    const educationalToolDomains = normalizeConcreteDomains(body.educationalToolDomains);
    if (parsed) {
      const saved = await this.assessments.withAssessmentLock(
        contentId,
        async (operationLease) => {
          const [setting, defaults] = await Promise.all([
            this.assessments.getContentSebSetting(contentId),
            this.courseSettings.getDefaults(courseId)
          ]);
          if (!setting) {
            return null;
          }
          operationLease.assertActive();
          const externalToolIds = requestedExternalToolIds(body, setting.externalToolIds);
          return this.assessments.saveContentSebSetting(
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
        },
        courseId
      );
      if (!saved) {
        return apiError(404, "Assessment not found");
      }
      return {
        success: true,
        setting: toSebSettingView(saved, this.config.value.seb.defaultQuitPassword)
      };
    }
    if (!body.quizId) {
      return apiError(404, "Assessment not found");
    }
    const quizId = body.quizId;
    const saved = await this.assessments.withAssessmentLock(
      quizId,
      async (operationLease) => {
        const [setting, defaults] = await Promise.all([
          this.assessments.getSebSettingForQuiz(quizId),
          this.courseSettings.getDefaults(courseId)
        ]);
        if (!setting) {
          return null;
        }
        operationLease.assertActive();
        const externalToolIds = requestedExternalToolIds(body, setting.externalToolIds);
        return this.assessments.saveQuizSebSetting(
          applyCourseDefaultsToQuizSetting(
            {
              ...defaultQuizSebSetting(quizId, courseId),
              ...setting,
              id: setting?.id || quizId,
              quizId,
              courseId: courseId || setting?.courseId || null,
              ssoDomains,
              educationalToolDomains,
              customDomains: urlRulesToAllowedEntries(urlRules),
              urlRules,
              externalTools: setting.externalTools,
              quizOnlyExternalTools: requestedQuizOnlyTools(body, setting.quizOnlyExternalTools),
              externalToolIds,
              externalToolUrl: body.externalToolUrl || setting?.externalToolUrl || null,
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
      },
      courseId
    );
    if (!saved) {
      return apiError(404, "Assessment not found");
    }
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
          userId
        );
        return {
          success: true,
          message: "Safe Online Exam enabled.",
          setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
        };
      }
      const setting = await this.assessments.enableSebWithAccessCode(courseId, quizId, userId);
      return {
        success: true,
        message: "Safe Online Exam enabled.",
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
      return apiError(404, "No Safe Online Exam setting found for this quiz");
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
          message: "Safe Online Exam disabled.",
          setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword)
        };
      }
      const setting = await this.assessments.disableSebWithAccessCode(courseId, quizId, userId);
      return {
        success: true,
        message: "Safe Online Exam disabled.",
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
        return apiError(404, "Safe Online Exam is not enabled for this quiz");
      }
      return {
        success: true,
        message: "Safe Online Exam access code regenerated. Students should reopen the quiz from Canvas."
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

  private async requireCopyableCourseTool(courseId: string, toolId: string): Promise<ExternalToolConfig> {
    const tool = (await this.courseSettings.getDefaults(courseId)).externalTools.find((entry) => entry.id === toolId);
    if (!tool) {
      return apiError(404, "Exam tool not found", { error_code: "COURSE_TOOL_NOT_FOUND" });
    }
    if (tool.managedByAdmin === true || tool.adminPresetId) {
      return apiError(409, "School-managed exam tools cannot be copied from course settings.", {
        error_code: "COURSE_TOOL_COPY_NOT_ALLOWED"
      });
    }
    return tool;
  }
}
