import { randomUUID } from "node:crypto";
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type {
  AdminCourseConnectionRecord,
  AdminToolPresetRecord,
  AdminToolPresetAssignmentRecord,
  AssessmentRecord,
  ExternalToolConfig
} from "../../shared/models.js";
import {
  normalizeExternalToolAccessRules,
  normalizeExternalTools,
  parseNewQuizContentId,
  YOUTUBE_VIDEO_TOOL_PRESET
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";
import { apiError } from "../http/api-error.js";
import { toSebSettingView } from "../http/seb-response.js";
import { AdminAuthorizationService } from "../services/admin-authorization.service.js";
import {
  AssessmentAccessCodeConsistencyError,
  AssessmentOperationLockLostError,
  AssessmentOperationInProgressError,
  AssessmentService,
  CourseMutationInProgressError,
  CourseMutationOperationLockLostError,
  CourseResetAssessmentIdentityError,
  CourseResetCompensationError,
  CourseResetInProgressError,
  CourseResetOutcomeUnknownError,
  CourseResetOperationLockLostError
} from "../services/assessment.service.js";
import {
  CanvasApiService,
  type CanvasAdminCourse,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError,
  isCanvasApiRequestError
} from "../services/canvas-api.service.js";
import { CourseSettingsService } from "../services/course-settings.service.js";
import { canonicalSebConfigContentId } from "../services/seb-config-grant.service.js";
import type { VerifiedAccountAdminPrincipal } from "../security/verified-lti-principal.js";

const ADMIN_PAGE_SIZE = 25;
const ADMIN_BULK_LIMIT = 50;
const ADMIN_RECONCILE_BATCH_SIZE = 12;

@Controller("/api/admin")
export class AdminController {
  private readonly indexedRoots = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly repositories: RepositoryProvider,
    private readonly authorization: AdminAuthorizationService,
    private readonly canvasApi: CanvasApiService,
    private readonly assessments: AssessmentService,
    private readonly courseSettings: CourseSettingsService
  ) {}

  @Get("/summary")
  async summary(@Req() request: Request): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request);
    await this.ensureLegacyCourseConnections(principal);
    const [account, permissions, summary, presets, assignments] = await Promise.all([
      this.canvasApi.getAdminAccount(principal.rootAccountId, principal.canvasUserId),
      this.canvasApi.getAdminPermissions(principal.rootAccountId, principal.canvasUserId),
      this.repositories.value.adminCourseConnections.summarizeForRoot(principal.rootAccountId),
      this.repositories.value.adminToolPresets.find([
        { field: "rootAccountId", op: "==", value: principal.rootAccountId }
      ]),
      this.repositories.value.adminToolPresetAssignments.find([
        { field: "rootAccountId", op: "==", value: principal.rootAccountId }
      ])
    ]);
    return {
      success: true,
      account,
      permissions,
      summary: {
        ...summary,
        configuredCourseCount: summary.courseCount,
        toolPresetCount: presets.length,
        pendingPresetAssignmentCount: assignments.filter((assignment) => assignment.status === "pending").length,
        failedPresetAssignmentCount: assignments.filter((assignment) => assignment.status === "failed").length
      }
    };
  }

  @Get("/courses")
  async listCourses(
    @Req() request: Request,
    @Query("search") search?: unknown,
    @Query("cursor") cursor?: unknown,
    @Query("limit") rawLimit?: unknown
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request);
    await this.ensureLegacyCourseConnections(principal);
    const limit = normalizedPageSize(rawLimit);
    const after = decodeCourseCursor(cursor);
    const courses = await this.repositories.value.adminCourseConnections.listForRoot(principal.rootAccountId, {
      search: normalizedSearch(search),
      afterName: after?.name,
      afterCourseId: after?.courseId,
      limit: limit + 1
    });
    const hasMore = courses.length > limit;
    const items = courses.slice(0, limit);
    const last = items.at(-1);
    return {
      success: true,
      courses: items.map(adminCourseListView),
      nextCursor: hasMore && last ? encodeCourseCursor(last) : null
    };
  }

  @Get("/courses/:courseId")
  async courseDetail(@Req() request: Request, @Param("courseId") courseId: string): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId);
    const connection = await this.requireCourseConnection(principal, courseId);
    const [local, assessments, assignments] = await Promise.all([
      this.repositories.value.courses.get(courseId),
      this.repositories.value.assessments.find([{ field: "courseId", op: "==", value: courseId }]),
      this.repositories.value.adminToolPresetAssignments.find([
        { field: "rootAccountId", op: "==", value: principal.rootAccountId },
        { field: "courseId", op: "==", value: courseId }
      ])
    ]);
    return {
      success: true,
      course: {
        ...adminCourseListView(connection),
        setupCompleted: local?.setupCompleted === true,
        hasCourseDefaults: !!local,
        adminToolPresetIds: assignments
          .filter((assignment) => assignment.desiredAssigned)
          .map((assignment) => assignment.presetId),
        assessments: assessments.map(adminAssessmentView)
      }
    };
  }

  @Get("/course-catalog")
  async courseCatalog(
    @Req() request: Request,
    @Query("search") search?: unknown,
    @Query("termId") termId?: unknown,
    @Query("cursor") cursor?: unknown,
    @Query("includeUnpublished") includeUnpublished?: unknown,
    @Query("withEnrollments") withEnrollments?: unknown
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request);
    const page = decodeCanvasPageCursor(cursor);
    const result = await this.canvasApi.getAdminCoursesPage(principal.rootAccountId, principal.canvasUserId, {
      page,
      perPage: ADMIN_PAGE_SIZE,
      search: normalizedSearch(search),
      termId: scalarQueryString(termId),
      includeUnpublished: includeUnpublished === "true",
      withEnrollments: withEnrollments !== "false"
    });
    const connected = await this.repositories.value.adminCourseConnections.find([
      { field: "rootAccountId", op: "==", value: principal.rootAccountId },
      { field: "courseId", op: "in", value: result.courses.map((course) => course.id) }
    ]);
    const connectedIds = new Set(connected.map((course) => course.courseId));
    return {
      success: true,
      courses: result.courses.map((course) => ({ ...course, connected: connectedIds.has(course.id) })),
      nextCursor: result.nextPage ? encodeCanvasPageCursor(result.nextPage) : null
    };
  }

  @Get("/terms")
  async terms(@Req() request: Request): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request);
    return {
      success: true,
      terms: await this.canvasApi.getAdminEnrollmentTerms(principal.rootAccountId, principal.canvasUserId)
    };
  }

  @Post("/courses/connect")
  async connectCourses(@Req() request: Request, @Body() body: unknown): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request, true);
    const courseIds = normalizedCourseIds(body);
    const results: Array<Record<string, unknown>> = [];
    for (const courseId of courseIds) {
      try {
        const { course: canvasCourse } = await this.authorization.requireAdminForCourse(request, courseId, true);
        const rootAccountId = await this.resolveCourseRootAccount(canvasCourse, principal.canvasUserId);
        if (rootAccountId !== principal.rootAccountId) {
          results.push({ courseId, success: false, error: "Course is outside this root account" });
          continue;
        }
        const connection = await this.assessments.withCourseWriteLock(courseId, async () => {
          const refreshed = await this.assessments.refreshCourseContent(
            courseId,
            principal.canvasUserId,
            "account_admin",
            { courseWriteLockHeld: true }
          );
          return this.saveCourseConnection(principal, canvasCourse, refreshed.assessments);
        });
        results.push({ courseId, success: true, course: adminCourseListView(connection) });
      } catch (error) {
        results.push({ courseId, success: false, error: safeErrorDetail(error) });
      }
    }
    return {
      success: results.every((result) => result.success === true),
      connectedCount: results.filter((result) => result.success === true).length,
      results
    };
  }

  @Post("/tool-presets")
  async createToolPreset(@Req() request: Request, @Body() body: unknown): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request, true);
    const existing = await this.repositories.value.adminToolPresets.find([
      { field: "rootAccountId", op: "==", value: principal.rootAccountId }
    ]);
    if (existing.length >= 32) {
      return apiError(409, "This account already has the maximum of 32 school tool presets", {
        error_code: "ADMIN_TOOL_PRESET_LIMIT"
      });
    }
    const input = normalizedToolPresetInput(body);
    const id = randomUUID();
    const saved = await this.repositories.value.adminToolPresets.save(id, {
      id,
      rootAccountId: principal.rootAccountId,
      name: input.name,
      description: input.description,
      tool: input.tool,
      createdByUserId: principal.canvasUserId,
      updatedByUserId: principal.canvasUserId
    });
    return { success: true, preset: await this.adminToolPresetView(saved) };
  }

  @Get("/tool-presets")
  async toolPresets(@Req() request: Request): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request);
    const presets = await this.repositories.value.adminToolPresets.find([
      { field: "rootAccountId", op: "==", value: principal.rootAccountId }
    ]);
    return { success: true, presets: await Promise.all(presets.map((preset) => this.adminToolPresetView(preset))) };
  }

  @Put("/tool-presets/:presetId")
  async updateToolPreset(
    @Req() request: Request,
    @Param("presetId") presetId: string,
    @Body() body: unknown
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request, true);
    const existing = await this.requireToolPreset(principal, presetId);
    const input = normalizedToolPresetInput(body);
    const saved = await this.repositories.value.adminToolPresets.save(presetId, {
      ...existing,
      name: input.name,
      description: input.description,
      tool: input.tool,
      updatedByUserId: principal.canvasUserId
    });
    const assignments = await this.repositories.value.adminToolPresetAssignments.find([
      { field: "rootAccountId", op: "==", value: principal.rootAccountId },
      { field: "presetId", op: "==", value: presetId }
    ]);
    await Promise.all(
      assignments
        .filter((assignment) => assignment.desiredAssigned)
        .map((assignment) =>
          this.repositories.value.adminToolPresetAssignments.update(assignment.id, (current) =>
            current
              ? {
                  ...current,
                  status: "pending" as const,
                  error: null,
                  updatedByUserId: principal.canvasUserId
                }
              : null
          )
        )
    );
    return { success: true, preset: await this.adminToolPresetView(saved) };
  }

  @Delete("/tool-presets/:presetId")
  async deleteToolPreset(
    @Req() request: Request,
    @Param("presetId") presetId: string
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request, true);
    const existing = await this.requireToolPreset(principal, presetId);
    const assignments = await this.repositories.value.adminToolPresetAssignments.find([
      { field: "rootAccountId", op: "==", value: principal.rootAccountId },
      { field: "presetId", op: "==", value: presetId }
    ]);
    if (assignments.some((assignment) => assignment.desiredAssigned || assignment.status !== "applied")) {
      return apiError(409, "Remove this preset from its courses before deleting it", {
        error_code: "ADMIN_TOOL_PRESET_ASSIGNED"
      });
    }
    await Promise.all(
      assignments.map((assignment) => this.repositories.value.adminToolPresetAssignments.delete(assignment.id))
    );
    await this.repositories.value.adminToolPresets.delete(existing.id);
    return { success: true };
  }

  @Put("/tool-presets/:presetId/courses/:courseId")
  async assignToolPreset(
    @Req() request: Request,
    @Param("presetId") presetId: string,
    @Param("courseId") courseId: string,
    @Body() body: unknown
  ): Promise<Record<string, unknown>> {
    const assigned =
      !!body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      typeof (body as { assigned?: unknown }).assigned === "boolean"
        ? (body as { assigned: boolean }).assigned
        : null;
    if (assigned === null) {
      return apiError(400, "assigned must be a boolean");
    }
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    const preset = await this.requireToolPreset(principal, presetId);
    await this.saveAssignmentIntent(principal, preset.id, courseId, assigned);
    const rollout = await this.reconcilePresetAssignments(request, principal, preset, false, 1);
    if (rollout.failed) {
      return apiError(502, "The course could not be updated. The assignment was saved and can be retried.", {
        error_code: "ADMIN_TOOL_PRESET_ROLLOUT_FAILED"
      });
    }
    return { success: rollout.failed === 0, preset: await this.adminToolPresetView(preset), rollout };
  }

  @Put("/tool-presets/:presetId/assignments")
  async assignToolPresetBulk(
    @Req() request: Request,
    @Param("presetId") presetId: string,
    @Body() body: unknown
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request, true);
    const preset = await this.requireToolPreset(principal, presetId);
    const input = normalizedBulkAssignmentInput(body);
    let courseIds = input.courseIds;
    if (input.all) {
      const connections = await this.repositories.value.adminCourseConnections.find([
        { field: "rootAccountId", op: "==", value: principal.rootAccountId }
      ]);
      courseIds = connections.map((course) => course.courseId);
    }
    if (courseIds.length > 2_000) {
      return apiError(409, "A rollout may contain at most 2,000 connected courses", {
        error_code: "ADMIN_TOOL_PRESET_ROLLOUT_LIMIT"
      });
    }
    await Promise.all(
      courseIds.map((courseId) => this.saveAssignmentIntent(principal, preset.id, courseId, input.assigned))
    );
    const rollout = await this.reconcilePresetAssignments(
      request,
      principal,
      preset,
      false,
      ADMIN_RECONCILE_BATCH_SIZE
    );
    return {
      success: rollout.failed === 0,
      queuedCount: courseIds.length,
      preset: await this.adminToolPresetView(preset),
      rollout
    };
  }

  @Post("/tool-presets/:presetId/assignments/reconcile")
  async reconcileToolPreset(
    @Req() request: Request,
    @Param("presetId") presetId: string,
    @Body() body: unknown
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request, true);
    const preset = await this.requireToolPreset(principal, presetId);
    const retryFailed =
      !!body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as { retryFailed?: unknown }).retryFailed === true;
    const rollout = await this.reconcilePresetAssignments(
      request,
      principal,
      preset,
      retryFailed,
      ADMIN_RECONCILE_BATCH_SIZE
    );
    return {
      success: rollout.failed === 0,
      preset: await this.adminToolPresetView(preset),
      rollout
    };
  }

  @Post("/courses/:courseId/refresh")
  async refreshCourse(@Req() request: Request, @Param("courseId") courseId: string): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    const result = await this.assessments.withCourseWriteLock(courseId, async () => {
      const refreshed = await this.assessments.refreshCourseContent(courseId, principal.canvasUserId, "account_admin", {
        courseWriteLockHeld: true
      });
      await this.updateConnectionCounts(principal, courseId, refreshed.assessments);
      return refreshed;
    });
    return {
      success: true,
      assessmentCount: result.assessments.length,
      assessments: result.assessments.map(adminAssessmentView)
    };
  }

  @Post("/courses/:courseId/reset")
  async resetCourse(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Body() body: unknown
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    await this.requireCourseConnection(principal, courseId);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body as { confirmation?: unknown }).confirmation !== courseId
    ) {
      return apiError(400, "Enter the Canvas course ID to confirm this reset", {
        error_code: "ADMIN_COURSE_RESET_CONFIRMATION_REQUIRED"
      });
    }
    try {
      const result = await this.assessments.resetCourseForAdmin(
        courseId,
        principal.canvasUserId,
        principal.rootAccountId
      );
      return {
        success: true,
        message:
          "Canvas assessment access codes were removed and the local course setup was reset. Canvas authorization was preserved.",
        ...result
      };
    } catch (error) {
      if (error instanceof CourseResetInProgressError) {
        return apiError(409, "This course is already being reset. Wait for it to finish before trying again.", {
          error_code: "COURSE_RESET_IN_PROGRESS"
        });
      }
      if (error instanceof CourseResetAssessmentIdentityError) {
        return apiError(
          409,
          "Canvas did not provide an assessment identifier required for reset. Course records were not deleted; refresh the course and retry.",
          {
            error_code: "ADMIN_COURSE_RESET_ASSESSMENT_IDENTITY_UNAVAILABLE"
          }
        );
      }
      if (error instanceof CourseResetCompensationError) {
        return apiError(
          409,
          "The reset stopped, but one or more prior Canvas access codes could not be restored. Refresh the course and verify every assessment before retrying.",
          {
            error_code: "ADMIN_COURSE_RESET_ROLLBACK_VERIFY_REQUIRED"
          }
        );
      }
      if (error instanceof CourseResetOutcomeUnknownError) {
        return apiError(
          409,
          "The database reset outcome could not be confirmed and may have completed. Refresh the local course state and verify every Canvas assessment access code before retrying.",
          {
            error_code: "ADMIN_COURSE_RESET_VERIFY_REQUIRED"
          }
        );
      }
      if (error instanceof AssessmentAccessCodeConsistencyError) {
        return apiError(
          409,
          "A saved enabled assessment has no recoverable Canvas access code. Course records were not deleted; verify the assessment and reconcile its access code before retrying.",
          {
            error_code: "ADMIN_COURSE_RESET_VERIFY_REQUIRED"
          }
        );
      }
      if (
        error instanceof AssessmentOperationLockLostError ||
        error instanceof CourseMutationOperationLockLostError ||
        error instanceof CourseResetOperationLockLostError
      ) {
        return apiError(
          409,
          "The reset could not confirm operation-lock ownership through completion. It may have completed; refresh the course and verify Canvas assessment access codes before retrying.",
          {
            error_code: "ADMIN_COURSE_RESET_VERIFY_REQUIRED"
          }
        );
      }
      if (error instanceof AssessmentOperationInProgressError || error instanceof CourseMutationInProgressError) {
        return apiError(
          409,
          "An assessment update is already in progress. Wait for it to finish, refresh the course, and retry; course records were not deleted.",
          {
            error_code: "ADMIN_COURSE_RESET_ASSESSMENT_BUSY"
          }
        );
      }
      if (isCanvasApiAuthorizationError(error)) {
        return apiError(
          401,
          "Canvas authorization expired before every assessment could be disabled. Reconnect Canvas and retry; course records were not deleted.",
          {
            error_code: "CANVAS_AUTHORIZATION_REQUIRED"
          }
        );
      }
      if (isCanvasApiPermissionError(error)) {
        return apiError(
          403,
          "Canvas denied access to at least one assessment. Check the administrator Developer Key scopes and course permissions, then retry; course records were not deleted.",
          {
            error_code: "CANVAS_PERMISSION_DENIED"
          }
        );
      }
      if (isCanvasApiRequestError(error)) {
        return apiError(
          502,
          "Canvas could not disable every assessment. Course records were not deleted; wait a moment, refresh the course, and retry the reset.",
          {
            error_code: "ADMIN_COURSE_RESET_CANVAS_FAILED"
          }
        );
      }
      throw error;
    }
  }

  @Post("/courses/:courseId/passwords/reveal")
  async revealCoursePasswords(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("courseId") courseId: string
  ): Promise<Record<string, unknown>> {
    await this.authorization.requireAdminForCourse(request, courseId, true);
    setSecretResponseHeaders(response);
    const defaults = await this.courseSettings.getDefaults(courseId);
    const effectiveQuitPassword = defaults.quitPassword || this.config.value.seb.defaultQuitPassword || null;
    return {
      success: true,
      expiresInSeconds: 30,
      passwords: {
        start: { value: defaults.startPassword || null, source: defaults.startPassword ? "course" : "none" },
        exit: {
          value: effectiveQuitPassword,
          source: defaults.quitPassword ? "course" : this.config.value.seb.defaultQuitPassword ? "managed" : "none"
        }
      }
    };
  }

  @Post("/courses/:courseId/assessments/:assessmentId/passwords/reveal")
  async revealAssessmentPasswords(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("courseId") courseId: string,
    @Param("assessmentId") assessmentId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    const assessment = await this.requireAssessment(courseId, assessmentId);
    setSecretResponseHeaders(response);
    const effectiveQuitPassword = assessment.seb.quitPassword || this.config.value.seb.defaultQuitPassword || null;
    void principal;
    return {
      success: true,
      expiresInSeconds: 30,
      passwords: {
        start: {
          value: assessment.seb.startPassword || null,
          source: assessment.seb.startPassword
            ? assessment.seb.startPasswordOverride
              ? "assessment"
              : "course"
            : "none"
        },
        exit: {
          value: effectiveQuitPassword,
          source: assessment.seb.quitPassword
            ? assessment.seb.quitPasswordOverride
              ? "assessment"
              : "course"
            : this.config.value.seb.defaultQuitPassword
              ? "managed"
              : "none"
        },
        accessCode: { value: assessment.seb.accessCode || null, source: assessment.seb.accessCode ? "canvas" : "none" }
      }
    };
  }

  @Post("/courses/:courseId/quit-password/rotate")
  async rotateCourseQuitPassword(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("courseId") courseId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    setSecretResponseHeaders(response);
    void principal;
    const password = await this.courseSettings.rotateQuitPassword(courseId);
    return {
      success: true,
      expiresInSeconds: 30,
      passwords: { exit: { value: password, source: "course" } }
    };
  }

  @Post("/courses/:courseId/assessments/:assessmentId/quit-password/reset")
  async resetAssessmentQuitPassword(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("assessmentId") assessmentId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    await this.requireAssessment(courseId, assessmentId);
    void principal;
    const setting = await this.courseSettings.resetQuizQuitPasswordToDefault(courseId, assessmentId);
    if (!setting) {
      return apiError(404, "No Safe Online Exam setting was found for this assessment", {
        error_code: "ASSESSMENT_SETTING_NOT_FOUND"
      });
    }
    return { success: true, setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword) };
  }

  @Post("/courses/:courseId/assessments/:assessmentId/regenerate-code")
  async regenerateAccessCode(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("assessmentId") assessmentId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    const assessment = await this.requireAssessment(courseId, assessmentId);
    const setting =
      assessment.contentType === "NEW_QUIZ"
        ? await this.assessments.regenerateContentAccessCode(
            courseId,
            assessment.id,
            requiredAssignmentId(assessment),
            principal.canvasUserId,
            "account_admin"
          )
        : await this.assessments.regenerateQuizAccessCode(
            courseId,
            requiredQuizId(assessment),
            principal.canvasUserId,
            "account_admin"
          );
    if (!setting) {
      return apiError(409, "Safe Online Exam is not enabled for this assessment", { error_code: "SEB_NOT_ENABLED" });
    }
    return { success: true, setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword) };
  }

  @Post("/courses/:courseId/assessments/:assessmentId/reset-defaults")
  async resetAssessmentDefaults(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("assessmentId") assessmentId: string
  ): Promise<Record<string, unknown>> {
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    const assessment = await this.requireAssessment(courseId, assessmentId);
    void principal;
    const setting = await this.courseSettings.resetQuizToDefaults(courseId, assessment.id);
    if (!setting) {
      return apiError(404, "No Safe Online Exam setting was found for this assessment", {
        error_code: "ASSESSMENT_SETTING_NOT_FOUND"
      });
    }
    return { success: true, setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword) };
  }

  @Put("/courses/:courseId/assessments/:assessmentId/seb")
  async setSebRequirement(
    @Req() request: Request,
    @Param("courseId") courseId: string,
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown
  ): Promise<Record<string, unknown>> {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof (body as { required?: unknown }).required !== "boolean"
    ) {
      return apiError(400, "required must be a boolean");
    }
    const required = (body as { required: boolean }).required;
    const { principal } = await this.authorization.requireAdminForCourse(request, courseId, true);
    return this.assessments.withCourseWriteLock(courseId, async () => {
      const assessment = await this.requireAssessment(courseId, assessmentId);
      const setting =
        assessment.contentType === "NEW_QUIZ"
          ? required
            ? await this.assessments.enableContentSebWithAccessCode(
                courseId,
                assessment.id,
                requiredAssignmentId(assessment),
                principal.canvasUserId,
                undefined,
                "account_admin",
                { courseWriteLockHeld: true }
              )
            : await this.assessments.disableContentSebWithAccessCode(
                courseId,
                assessment.id,
                requiredAssignmentId(assessment),
                principal.canvasUserId,
                "account_admin",
                { courseWriteLockHeld: true }
              )
          : required
            ? await this.assessments.enableSebWithAccessCode(
                courseId,
                requiredQuizId(assessment),
                principal.canvasUserId,
                undefined,
                "account_admin",
                { courseWriteLockHeld: true }
              )
            : await this.assessments.disableSebWithAccessCode(
                courseId,
                requiredQuizId(assessment),
                principal.canvasUserId,
                "account_admin",
                { courseWriteLockHeld: true }
              );
      const assessments = await this.repositories.value.assessments.find([
        { field: "courseId", op: "==", value: courseId }
      ]);
      await this.updateConnectionCounts(principal, courseId, assessments);
      return { success: true, setting: toSebSettingView(setting, this.config.value.seb.defaultQuitPassword) };
    });
  }

  private async requireAssessment(courseId: string, assessmentId: string): Promise<AssessmentRecord> {
    const canonicalId = canonicalSebConfigContentId(assessmentId);
    if (!canonicalId) {
      return apiError(404, "Assessment not found", { error_code: "ASSESSMENT_NOT_FOUND" });
    }
    const assessment = await this.assessments.getAssessmentRecord(canonicalId);
    if (!assessment || assessment.courseId !== courseId) {
      return apiError(404, "Assessment not found", { error_code: "ASSESSMENT_NOT_FOUND" });
    }
    return assessment;
  }

  private async requireToolPreset(
    principal: VerifiedAccountAdminPrincipal,
    presetId: string
  ): Promise<AdminToolPresetRecord> {
    if (!/^[a-f0-9-]{36}$/iu.test(presetId)) {
      return apiError(404, "School tool preset not found", { error_code: "ADMIN_TOOL_PRESET_NOT_FOUND" });
    }
    const preset = await this.repositories.value.adminToolPresets.get(presetId);
    if (!preset || preset.rootAccountId !== principal.rootAccountId) {
      return apiError(404, "School tool preset not found", { error_code: "ADMIN_TOOL_PRESET_NOT_FOUND" });
    }
    return preset;
  }

  private async ensureLegacyCourseConnections(principal: VerifiedAccountAdminPrincipal): Promise<void> {
    if (this.indexedRoots.has(principal.rootAccountId)) {
      return;
    }
    const [localCourses, localAssessments, existing] = await Promise.all([
      this.repositories.value.courses.find(),
      this.repositories.value.assessments.find(),
      this.repositories.value.adminCourseConnections.find([
        { field: "rootAccountId", op: "==", value: principal.rootAccountId }
      ])
    ]);
    const existingIds = new Set(existing.map((course) => course.courseId));
    const assessmentsByCourse = groupAssessments(localAssessments);
    const courseIds = [
      ...new Set([...localCourses.map((course) => course.courseId), ...localAssessments.map((item) => item.courseId)])
    ].filter((courseId) => isNumericCanvasId(courseId) && !existingIds.has(courseId));
    for (let offset = 0; offset < courseIds.length; offset += 8) {
      const batch = courseIds.slice(offset, offset + 8);
      await Promise.all(
        batch.map(async (courseId) => {
          try {
            const course = await this.canvasApi.getAdminCourse(courseId, principal.canvasUserId);
            if ((await this.resolveCourseRootAccount(course, principal.canvasUserId)) === principal.rootAccountId) {
              await this.saveCourseConnection(principal, course, assessmentsByCourse.get(courseId) || []);
            }
          } catch (error) {
            if ((isCanvasApiRequestError(error) && error.status === 404) || isCanvasApiPermissionError(error)) {
              return;
            }
            throw error;
          }
        })
      );
    }
    this.indexedRoots.add(principal.rootAccountId);
  }

  private async resolveCourseRootAccount(course: CanvasAdminCourse, canvasUserId: string): Promise<string> {
    return course.rootAccountId || (await this.canvasApi.getAdminAccount(course.accountId, canvasUserId)).rootAccountId;
  }

  private async saveCourseConnection(
    principal: VerifiedAccountAdminPrincipal,
    course: CanvasAdminCourse,
    assessments: AssessmentRecord[]
  ): Promise<AdminCourseConnectionRecord> {
    const now = new Date().toISOString();
    const id = `${principal.rootAccountId}:${course.id}`;
    const previous = await this.repositories.value.adminCourseConnections.get(id);
    return this.repositories.value.adminCourseConnections.save(id, {
      id,
      rootAccountId: principal.rootAccountId,
      canvasOrigin: this.canvasApi.getCanvasDomain(),
      courseId: course.id,
      name: course.name,
      courseCode: course.courseCode,
      accountId: course.accountId,
      workflowState: course.workflowState,
      termId: course.termId,
      termName: course.termName,
      teacherNames: course.teacherNames,
      ...assessmentCounts(assessments),
      connectedByUserId: previous?.connectedByUserId || principal.canvasUserId,
      lastCanvasCheckedAt: now,
      lastRefreshedAt: now,
      createdAt: previous?.createdAt || now
    });
  }

  private async updateConnectionCounts(
    principal: VerifiedAccountAdminPrincipal,
    courseId: string,
    assessments: AssessmentRecord[]
  ): Promise<void> {
    const id = `${principal.rootAccountId}:${courseId}`;
    await this.repositories.value.adminCourseConnections.update(id, (current) =>
      current ? { ...current, ...assessmentCounts(assessments), lastRefreshedAt: new Date().toISOString() } : null
    );
  }

  private async refreshConnectionCounts(principal: VerifiedAccountAdminPrincipal, courseId: string): Promise<void> {
    await this.assessments.withCourseWriteLock(courseId, async () => {
      const assessments = await this.repositories.value.assessments.find([
        { field: "courseId", op: "==", value: courseId }
      ]);
      await this.updateConnectionCounts(principal, courseId, assessments);
    });
  }

  private async requireCourseConnection(
    principal: VerifiedAccountAdminPrincipal,
    courseId: string
  ): Promise<AdminCourseConnectionRecord> {
    const connection = await this.repositories.value.adminCourseConnections.get(
      `${principal.rootAccountId}:${courseId}`
    );
    if (!connection || connection.rootAccountId !== principal.rootAccountId) {
      return apiError(404, "Connected course not found", { error_code: "ADMIN_COURSE_NOT_CONNECTED" });
    }
    return connection;
  }

  private async saveAssignmentIntent(
    principal: VerifiedAccountAdminPrincipal,
    presetId: string,
    courseId: string,
    desiredAssigned: boolean
  ): Promise<AdminToolPresetAssignmentRecord> {
    return this.assessments.withCourseWriteLock(courseId, async () => {
      await this.requireCourseConnection(principal, courseId);
      const id = `${presetId}:${courseId}`;
      const current = await this.repositories.value.adminToolPresetAssignments.get(id);
      return this.repositories.value.adminToolPresetAssignments.save(id, {
        id,
        rootAccountId: principal.rootAccountId,
        presetId,
        courseId,
        desiredAssigned,
        status: "pending",
        error: null,
        appliedPresetUpdatedAt: current?.appliedPresetUpdatedAt || null,
        updatedByUserId: principal.canvasUserId,
        createdAt: current?.createdAt || null
      });
    });
  }

  private async reconcilePresetAssignments(
    request: Request,
    principal: VerifiedAccountAdminPrincipal,
    preset: AdminToolPresetRecord,
    retryFailed: boolean,
    limit: number
  ): Promise<{ processed: number; applied: number; failed: number; pending: number }> {
    const assignments = await this.repositories.value.adminToolPresetAssignments.find([
      { field: "rootAccountId", op: "==", value: principal.rootAccountId },
      { field: "presetId", op: "==", value: preset.id }
    ]);
    const eligible = assignments
      .filter((assignment) => assignment.status === "pending" || (retryFailed && assignment.status === "failed"))
      .slice(0, Math.max(1, limit));
    const results = await Promise.all(
      eligible.map(async (assignment) => {
        const lockId = `admin-tool-preset:${assignment.id}`;
        const ownerId = randomUUID();
        if (!(await this.repositories.value.operationLocks.acquire(lockId, ownerId, 120_000))) {
          return null;
        }
        try {
          return await this.assessments.withCourseWriteLock(assignment.courseId, async () => {
            const current = await this.repositories.value.adminToolPresetAssignments.get(assignment.id);
            if (!current || (current.status !== "pending" && !(retryFailed && current.status === "failed"))) {
              return null;
            }
            try {
              await this.authorization.requireAdminForCourse(request, current.courseId, true);
              if (current.desiredAssigned) {
                await this.courseSettings.pushAdminToolPreset(current.courseId, preset, {
                  courseWriteLockHeld: true
                });
              } else {
                await this.courseSettings.removeAdminToolPreset(current.courseId, preset.id, {
                  courseWriteLockHeld: true
                });
              }
              await this.repositories.value.adminToolPresetAssignments.update(current.id, (latest) =>
                latest
                  ? {
                      ...latest,
                      status: "applied",
                      error: null,
                      appliedPresetUpdatedAt: preset.updatedAt || new Date().toISOString()
                    }
                  : null
              );
              return true;
            } catch (error) {
              await this.repositories.value.adminToolPresetAssignments.update(current.id, (latest) =>
                latest ? { ...latest, status: "failed", error: safeErrorDetail(error) } : null
              );
              return false;
            }
          });
        } catch {
          return null;
        } finally {
          await this.repositories.value.operationLocks.release(lockId, ownerId);
        }
      })
    );
    const remaining = await this.repositories.value.adminToolPresetAssignments.find([
      { field: "rootAccountId", op: "==", value: principal.rootAccountId },
      { field: "presetId", op: "==", value: preset.id }
    ]);
    return {
      processed: results.filter((result) => result !== null).length,
      applied: results.filter(Boolean).length,
      failed: remaining.filter((assignment) => assignment.status === "failed").length,
      pending: remaining.filter((assignment) => assignment.status === "pending").length
    };
  }

  private async adminToolPresetView(record: AdminToolPresetRecord) {
    const assignments = await this.repositories.value.adminToolPresetAssignments.find([
      { field: "rootAccountId", op: "==", value: record.rootAccountId },
      { field: "presetId", op: "==", value: record.id }
    ]);
    const assignedCourseIds = assignments
      .filter((assignment) => assignment.desiredAssigned)
      .map((assignment) => assignment.courseId);
    return {
      id: record.id,
      name: record.name,
      description: record.description || null,
      tool: record.tool,
      assignedCourseIds,
      assignedCourseCount: assignedCourseIds.length,
      pendingAssignmentCount: assignments.filter((assignment) => assignment.status === "pending").length,
      failedAssignmentCount: assignments.filter((assignment) => assignment.status === "failed").length,
      updatedAt: record.updatedAt || null
    };
  }
}

function groupAssessments(assessments: AssessmentRecord[]): Map<string, AssessmentRecord[]> {
  const grouped = new Map<string, AssessmentRecord[]>();
  for (const assessment of assessments) {
    const values = grouped.get(assessment.courseId) || [];
    values.push(assessment);
    grouped.set(assessment.courseId, values);
  }
  return grouped;
}

function assessmentCounts(assessments: AssessmentRecord[]): {
  assessmentCount: number;
  enabledAssessmentCount: number;
  issueCount: number;
} {
  return {
    assessmentCount: assessments.length,
    enabledAssessmentCount: assessments.filter((assessment) => assessment.seb.required === true).length,
    issueCount: assessments.filter(
      (assessment) =>
        assessment.canvasVerification?.status === "missing" || assessment.canvasVerification?.status === "stale"
    ).length
  };
}

function adminCourseListView(course: AdminCourseConnectionRecord) {
  return {
    id: course.courseId,
    name: course.name,
    courseCode: course.courseCode || null,
    accountId: course.accountId,
    workflowState: course.workflowState || null,
    termId: course.termId || null,
    termName: course.termName || null,
    teacherNames: course.teacherNames,
    assessmentCount: course.assessmentCount,
    enabledAssessmentCount: course.enabledAssessmentCount,
    issueCount: course.issueCount,
    lastRefreshedAt: course.lastRefreshedAt || null
  };
}

function normalizedPageSize(value: unknown): number {
  if (typeof value !== "string" || !/^[0-9]{1,3}$/u.test(value)) {
    return ADMIN_PAGE_SIZE;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : ADMIN_PAGE_SIZE;
}

function normalizedSearch(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/gu, " ").slice(0, 120);
  return normalized || undefined;
}

function scalarQueryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function encodeCourseCursor(course: Pick<AdminCourseConnectionRecord, "name" | "courseId">): string {
  return Buffer.from(JSON.stringify({ name: course.name, courseId: course.courseId }), "utf8").toString("base64url");
}

function decodeCourseCursor(value: unknown): { name: string; courseId: string } | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,1000}$/u.test(value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof parsed.name === "string" && typeof parsed.courseId === "string"
      ? { name: parsed.name.slice(0, 200), courseId: parsed.courseId.slice(0, 40) }
      : null;
  } catch {
    return null;
  }
}

function encodeCanvasPageCursor(page: number): string {
  return Buffer.from(String(page), "utf8").toString("base64url");
}

function decodeCanvasPageCursor(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/u.test(value)) {
    return 1;
  }
  try {
    const page = Number(Buffer.from(value, "base64url").toString("utf8"));
    return Number.isSafeInteger(page) && page > 0 && page <= 10_000 ? page : 1;
  } catch {
    return 1;
  }
}

function normalizedCourseIds(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "Provide one or more Canvas course IDs or course URLs");
  }
  const input = body as { courseIds?: unknown; input?: unknown };
  const rawValues = Array.isArray(input.courseIds)
    ? input.courseIds
    : typeof input.input === "string"
      ? input.input.split(/[\s,]+/u)
      : [];
  const courseIds = Array.from(
    new Set(
      rawValues
        .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
        .map((value) => {
          const normalized = String(value).trim();
          return /^\d+$/u.test(normalized) ? normalized : normalized.match(/\/courses\/(\d+)(?:[/?#]|$)/u)?.[1] || "";
        })
        .filter(isNumericCanvasId)
    )
  );
  if (!courseIds.length || courseIds.length > ADMIN_BULK_LIMIT) {
    return apiError(400, `Provide between 1 and ${ADMIN_BULK_LIMIT} valid Canvas course IDs or URLs`, {
      error_code: "INVALID_ADMIN_COURSE_IDS"
    });
  }
  return courseIds;
}

function normalizedBulkAssignmentInput(body: unknown): {
  assigned: boolean;
  all: boolean;
  courseIds: string[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "A bulk assignment selection is required");
  }
  const input = body as { assigned?: unknown; all?: unknown; courseIds?: unknown };
  if (typeof input.assigned !== "boolean" || typeof input.all !== "boolean") {
    return apiError(400, "assigned and all must be booleans");
  }
  const courseIds = Array.isArray(input.courseIds)
    ? Array.from(
        new Set(
          input.courseIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(isNumericCanvasId)
        )
      )
    : [];
  if (!input.all && !courseIds.length) {
    return apiError(400, "Select at least one connected course");
  }
  return { assigned: input.assigned, all: input.all, courseIds };
}

function adminAssessmentView(assessment: AssessmentRecord) {
  return {
    id: assessment.id,
    courseId: assessment.courseId,
    contentType: assessment.contentType,
    title: assessment.canvas.title || "Untitled assessment",
    htmlUrl: assessment.canvas.htmlUrl || null,
    published: assessment.canvas.published === true,
    sebRequired: assessment.seb.required === true,
    enabled: assessment.seb.enabled === true,
    hasAccessCode: !!assessment.seb.accessCode,
    hasStartPassword: !!assessment.seb.startPassword,
    hasQuitPassword: !!assessment.seb.quitPassword,
    usesCourseDefaults: assessment.seb.usesCourseDefaults === true,
    verificationStatus: assessment.canvasVerification?.status || "unverified",
    updatedAt: assessment.updatedAt || null
  };
}

function normalizedToolPresetInput(body: unknown): {
  name: string;
  description: string | null;
  tool: ExternalToolConfig;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "A school tool preset is required");
  }
  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/gu, " ") : "";
  const description = typeof input.description === "string" ? input.description.trim().replace(/\s+/gu, " ") : "";
  if (!name || name.length > 80 || description.length > 240) {
    return apiError(400, "Preset names must be 1–80 characters and descriptions must be at most 240 characters", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  if (!input.tool || typeof input.tool !== "object" || Array.isArray(input.tool)) {
    return apiError(400, "A valid external tool definition is required", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  const rawTool = input.tool as Record<string, unknown>;
  const rawRules = Array.isArray(rawTool.allowedRules) ? rawTool.allowedRules : [];
  if (
    Object.hasOwn(rawTool, "allowedDomains") ||
    Object.hasOwn(rawTool, "matchType") ||
    Object.hasOwn(rawTool, "allowedPattern") ||
    rawRules.length > 12 ||
    rawRules.some(
      (rule) =>
        !rule ||
        typeof rule !== "object" ||
        Array.isArray(rule) ||
        normalizeExternalToolAccessRules([rule as any]).length !== 1 ||
        ((rule as { match?: unknown }).match === "domain" &&
          (rule as { broadDomainConfirmed?: unknown }).broadDomainConfirmed !== true)
    )
  ) {
    return apiError(400, "Preset resources must use explicit HTTPS URLs or confirmed domains", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  const [tool] = normalizeExternalTools([
    {
      ...(rawTool as unknown as ExternalToolConfig),
      id: "school-preset-template",
      label: name,
      enabled: false,
      preset: rawTool.preset === YOUTUBE_VIDEO_TOOL_PRESET ? YOUTUBE_VIDEO_TOOL_PRESET : null,
      adminPresetId: null,
      managedByAdmin: false
    }
  ]);
  if (!tool || typeof rawTool.url !== "string" || !rawTool.url.trim().startsWith("https://")) {
    return apiError(400, "Preset tools require an exact HTTPS launch URL and safe resource rules", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  return { name, description: description || null, tool };
}

function requiredQuizId(assessment: AssessmentRecord): string {
  const value = assessment.canvas.quizId || assessment.canvas.id;
  if (!value) {
    return apiError(409, "Classic Quiz identifier is unavailable", { error_code: "ASSESSMENT_ID_UNAVAILABLE" });
  }
  return value;
}

function requiredAssignmentId(assessment: AssessmentRecord): string {
  const parsed = parseNewQuizContentId(assessment.id);
  const value = assessment.canvas.assignmentId || parsed?.assignmentId;
  if (!value) {
    return apiError(409, "New Quiz assignment identifier is unavailable", {
      error_code: "ASSESSMENT_ID_UNAVAILABLE"
    });
  }
  return value;
}

function setSecretResponseHeaders(response: Response): void {
  response.setHeader("cache-control", "private, no-store, max-age=0");
  response.setHeader("pragma", "no-cache");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
}

function isNumericCanvasId(value: string): boolean {
  return /^\d+$/u.test(value);
}

function safeErrorDetail(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    return `HTTP ${String((error as { status?: unknown }).status || "error")}`;
  }
  return error instanceof Error ? error.name : "Unknown error";
}
