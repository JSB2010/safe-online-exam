import { randomUUID } from "node:crypto";
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { setSecretResponseHeaders } from "../http/response-headers.js";
import type {
  AdminCourseConnectionRecord,
  AdminToolPresetRecord,
  AdminToolPresetAssignmentRecord,
  AssessmentRecord
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
  CourseResetOperationLockLostError,
  type OperationLease
} from "../services/assessment.service.js";
import {
  CanvasApiService,
  type CanvasAdminCourse,
  type CanvasEnrollmentTerm,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError,
  isCanvasApiRequestError
} from "../services/canvas-api.service.js";
import { CourseSettingsService } from "../services/course-settings.service.js";
import { canonicalSebConfigContentId } from "../services/seb-config-grant.service.js";
import type { VerifiedAccountAdminPrincipal } from "../security/verified-lti-principal.js";
import {
  adminAssessmentView,
  ADMIN_COURSE_STATUS_TTL_MS,
  ADMIN_PAGE_SIZE,
  ADMIN_RECONCILE_BATCH_SIZE,
  adminCourseListView,
  assessmentCounts,
  currentEnrollmentTerm,
  decodeCanvasPageCursor,
  decodeCourseCursor,
  encodeCanvasPageCursor,
  encodeCourseCursor,
  groupAssessments,
  isNumericCanvasId,
  normalizedBulkAssignmentInput,
  normalizedCourseIds,
  normalizedOperationalTermId,
  normalizedPageSize,
  normalizedSearch,
  normalizedToolPresetInput,
  requiredAssignmentId,
  requiredQuizId,
  safeErrorDetail,
  scalarQueryString
} from "./admin-controller-helpers.js";

@Controller("/api/admin")
export class AdminController {
  private readonly indexedRoots = new Set<string>();
  private readonly courseStatusReconciliations = new Map<string, Promise<void>>();

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
    await this.reconcileCourseStatuses(principal);
    const operationalTerm = await this.resolveOperationalTerm(principal);
    const [account, permissions, summary, presets, assignments] = await Promise.all([
      this.canvasApi.getAdminAccount(principal.rootAccountId, principal.canvasUserId),
      this.canvasApi.getAdminPermissions(principal.rootAccountId, principal.canvasUserId),
      this.repositories.value.adminCourseConnections.summarizeForRoot(principal.rootAccountId, {
        termId: operationalTerm?.id
      }),
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
      operationalTerm,
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
    @Query("limit") rawLimit?: unknown,
    @Query("includePast") rawIncludePast?: unknown
  ): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request);
    await this.ensureLegacyCourseConnections(principal);
    await this.reconcileCourseStatuses(principal);
    const operationalTerm = await this.resolveOperationalTerm(principal);
    const includePast = rawIncludePast === "true";
    const limit = normalizedPageSize(rawLimit);
    const after = decodeCourseCursor(cursor);
    const courses = await this.repositories.value.adminCourseConnections.listForRoot(principal.rootAccountId, {
      search: normalizedSearch(search),
      termId: operationalTerm?.id,
      includePast,
      afterName: after?.name,
      afterCourseId: after?.courseId,
      limit: limit + 1
    });
    const hasMore = courses.length > limit;
    const items = courses.slice(0, limit);
    const last = items.at(-1);
    return {
      success: true,
      operationalTerm,
      includePast,
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
    const terms = await this.canvasApi.getAdminEnrollmentTerms(principal.rootAccountId, principal.canvasUserId);
    return {
      success: true,
      terms,
      operationalTerm: await this.resolveOperationalTerm(principal, terms)
    };
  }

  @Put("/terms/operational")
  async updateOperationalTerm(@Req() request: Request, @Body() body: unknown): Promise<Record<string, unknown>> {
    const principal = this.authorization.requireAdmin(request, true);
    const termId = normalizedOperationalTermId(body);
    const terms = await this.canvasApi.getAdminEnrollmentTerms(principal.rootAccountId, principal.canvasUserId);
    const selected = terms.find((term) => term.id === termId);
    if (!selected) {
      return apiError(400, "Select an active Canvas enrollment term", {
        error_code: "INVALID_OPERATIONAL_TERM"
      });
    }
    const previous = await this.repositories.value.adminAccountSettings.get(principal.rootAccountId);
    await this.repositories.value.adminAccountSettings.save(principal.rootAccountId, {
      id: principal.rootAccountId,
      rootAccountId: principal.rootAccountId,
      operationalTermId: selected.id,
      updatedByUserId: principal.canvasUserId,
      createdAt: previous?.createdAt || null
    });
    return { success: true, operationalTerm: selected };
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
        const connection = await this.assessments.withCourseWriteLock(courseId, async (operationLease) => {
          const refreshed = await this.assessments.refreshCourseContent(
            courseId,
            principal.canvasUserId,
            "account_admin",
            { courseWriteLockHeld: true, operationLease }
          );
          operationLease.assertActive();
          return this.saveCourseConnection(principal, canvasCourse, refreshed.assessments, operationLease);
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
    const { principal, course } = await this.authorization.requireAdminForCourse(request, courseId, true);
    const result = await this.assessments.withCourseWriteLock(courseId, async (operationLease) => {
      const refreshed = await this.assessments.refreshCourseContent(courseId, principal.canvasUserId, "account_admin", {
        courseWriteLockHeld: true,
        operationLease
      });
      operationLease.assertActive();
      await this.saveCourseConnection(principal, course, refreshed.assessments, operationLease);
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
    return this.assessments.withCourseWriteLock(courseId, async (operationLease) => {
      const assessment = await this.requireAssessment(courseId, assessmentId);
      operationLease.assertActive();
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
                { courseWriteLockHeld: true, operationLease }
              )
            : await this.assessments.disableContentSebWithAccessCode(
                courseId,
                assessment.id,
                requiredAssignmentId(assessment),
                principal.canvasUserId,
                "account_admin",
                { courseWriteLockHeld: true, operationLease }
              )
          : required
            ? await this.assessments.enableSebWithAccessCode(
                courseId,
                requiredQuizId(assessment),
                principal.canvasUserId,
                undefined,
                "account_admin",
                { courseWriteLockHeld: true, operationLease }
              )
            : await this.assessments.disableSebWithAccessCode(
                courseId,
                requiredQuizId(assessment),
                principal.canvasUserId,
                "account_admin",
                { courseWriteLockHeld: true, operationLease }
              );
      const assessments = await this.repositories.value.assessments.find([
        { field: "courseId", op: "==", value: courseId }
      ]);
      operationLease.assertActive();
      await this.updateConnectionCounts(principal, courseId, assessments, operationLease);
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

  private async resolveOperationalTerm(
    principal: VerifiedAccountAdminPrincipal,
    providedTerms?: CanvasEnrollmentTerm[]
  ): Promise<CanvasEnrollmentTerm | null> {
    const terms =
      providedTerms || (await this.canvasApi.getAdminEnrollmentTerms(principal.rootAccountId, principal.canvasUserId));
    const existing = await this.repositories.value.adminAccountSettings.get(principal.rootAccountId);
    const selected = terms.find((term) => term.id === existing?.operationalTermId) || currentEnrollmentTerm(terms);
    if (!selected) {
      return null;
    }
    if (existing?.operationalTermId !== selected.id) {
      await this.repositories.value.adminAccountSettings.save(principal.rootAccountId, {
        id: principal.rootAccountId,
        rootAccountId: principal.rootAccountId,
        operationalTermId: selected.id,
        updatedByUserId: principal.canvasUserId,
        createdAt: existing?.createdAt || null
      });
    }
    return selected;
  }

  private async reconcileCourseStatuses(principal: VerifiedAccountAdminPrincipal): Promise<void> {
    const active = this.courseStatusReconciliations.get(principal.rootAccountId);
    if (active) {
      return active;
    }
    const reconciliation = this.performCourseStatusReconciliation(principal).finally(() => {
      this.courseStatusReconciliations.delete(principal.rootAccountId);
    });
    this.courseStatusReconciliations.set(principal.rootAccountId, reconciliation);
    return reconciliation;
  }

  private async performCourseStatusReconciliation(principal: VerifiedAccountAdminPrincipal): Promise<void> {
    const cutoff = Date.now() - ADMIN_COURSE_STATUS_TTL_MS;
    const connections = await this.repositories.value.adminCourseConnections.find(
      [{ field: "rootAccountId", op: "==", value: principal.rootAccountId }],
      { orderBy: "updatedAt", direction: "asc", limit: 100 }
    );
    const candidates = connections
      .filter(
        (connection) =>
          typeof connection.concluded !== "boolean" ||
          !connection.lastCanvasCheckedAt ||
          Date.parse(connection.lastCanvasCheckedAt) < cutoff
      )
      .sort((left, right) => Number(typeof left.concluded === "boolean") - Number(typeof right.concluded === "boolean"))
      .slice(0, ADMIN_RECONCILE_BATCH_SIZE);
    await Promise.all(
      candidates.map(async (connection) => {
        try {
          const course = await this.canvasApi.getAdminCourse(connection.courseId, principal.canvasUserId);
          const now = new Date().toISOString();
          await this.repositories.value.adminCourseConnections.update(connection.id, (current) =>
            current
              ? {
                  ...current,
                  name: course.name,
                  courseCode: course.courseCode,
                  accountId: course.accountId,
                  workflowState: course.workflowState,
                  concluded: course.concluded,
                  termId: course.termId,
                  termName: course.termName,
                  teacherNames: course.teacherNames,
                  lastCanvasCheckedAt: now
                }
              : null
          );
        } catch (error) {
          if ((isCanvasApiRequestError(error) && error.status === 404) || isCanvasApiPermissionError(error)) {
            return;
          }
          throw error;
        }
      })
    );
  }

  private async saveCourseConnection(
    principal: VerifiedAccountAdminPrincipal,
    course: CanvasAdminCourse,
    assessments: AssessmentRecord[],
    operationLease?: OperationLease
  ): Promise<AdminCourseConnectionRecord> {
    const now = new Date().toISOString();
    const id = `${principal.rootAccountId}:${course.id}`;
    const previous = await this.repositories.value.adminCourseConnections.get(id);
    operationLease?.assertActive();
    return this.repositories.value.adminCourseConnections.save(id, {
      id,
      rootAccountId: principal.rootAccountId,
      canvasOrigin: this.canvasApi.getCanvasDomain(),
      courseId: course.id,
      name: course.name,
      courseCode: course.courseCode,
      accountId: course.accountId,
      workflowState: course.workflowState,
      concluded: course.concluded,
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
    assessments: AssessmentRecord[],
    operationLease?: OperationLease
  ): Promise<void> {
    const id = `${principal.rootAccountId}:${courseId}`;
    operationLease?.assertActive();
    await this.repositories.value.adminCourseConnections.update(id, (current) =>
      current ? { ...current, ...assessmentCounts(assessments), lastRefreshedAt: new Date().toISOString() } : null
    );
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
    return this.assessments.withCourseWriteLock(courseId, async (operationLease) => {
      await this.requireCourseConnection(principal, courseId);
      const id = `${presetId}:${courseId}`;
      const current = await this.repositories.value.adminToolPresetAssignments.get(id);
      operationLease.assertActive();
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
          return await this.assessments.withCourseWriteLock(assignment.courseId, async (operationLease) => {
            const current = await this.repositories.value.adminToolPresetAssignments.get(assignment.id);
            if (!current || (current.status !== "pending" && !(retryFailed && current.status === "failed"))) {
              return null;
            }
            try {
              await this.authorization.requireAdminForCourse(request, current.courseId, true);
              operationLease.assertActive();
              if (current.desiredAssigned) {
                await this.courseSettings.pushAdminToolPreset(current.courseId, preset, {
                  courseWriteLockHeld: true,
                  operationLease
                });
              } else {
                await this.courseSettings.removeAdminToolPreset(current.courseId, preset.id, {
                  courseWriteLockHeld: true,
                  operationLease
                });
              }
              operationLease.assertActive();
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
              operationLease.assertActive();
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
