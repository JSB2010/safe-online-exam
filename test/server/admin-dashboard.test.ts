// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { AdminController } from "../../src/server/controllers/admin.controller.js";
import { createInMemoryRepositories } from "../../src/server/data/in-memory-repositories.js";
import { AdminAuthorizationService } from "../../src/server/services/admin-authorization.service.js";
import {
  AssessmentAccessCodeConsistencyError,
  AssessmentOperationLockLostError,
  AssessmentOperationInProgressError,
  CourseMutationOperationLockLostError,
  CourseResetAssessmentIdentityError,
  CourseResetCompensationError,
  CourseResetOutcomeUnknownError,
  CourseResetOperationLockLostError
} from "../../src/server/services/assessment.service.js";
import { CanvasApiRequestError } from "../../src/server/services/canvas-api.service.js";

const administratorRole = "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator";

describe("AdminAuthorizationService", () => {
  it("binds account administrators to courses in their signed root account", async () => {
    const canvasApi = {
      getAdminCourse: vi.fn().mockResolvedValue(canvasCourse()),
      getAdminAccount: vi.fn(),
      getAdminPermissions: vi.fn().mockResolvedValue({ manage_course_content_edit: true })
    };
    const service = new AdminAuthorizationService(configDouble() as any, canvasApi as any);

    await expect(service.requireAdminForCourse(adminRequest(), "101")).resolves.toMatchObject({
      principal: { contextType: "account", rootAccountId: "7" },
      course: { id: "101", rootAccountId: "7" }
    });
    expect(canvasApi.getAdminCourse).toHaveBeenCalledWith("101", "42");
  });

  it("rejects invalid principals, cross-account courses, and missing Canvas permissions", async () => {
    const canvasApi = {
      getAdminCourse: vi.fn().mockResolvedValue({ ...canvasCourse(), accountId: "9", rootAccountId: "9" }),
      getAdminAccount: vi.fn(),
      getAdminPermissions: vi.fn().mockResolvedValue({ manage_course_content_edit: false })
    };
    const service = new AdminAuthorizationService(configDouble() as any, canvasApi as any);

    expect(() => service.requireAdmin(courseRequest())).toThrow("Root-account administrator access is required");
    await expect(service.requireAdminForCourse(adminRequest(), "not-a-course")).rejects.toThrow("Course not found");
    await expect(service.requireAdminForCourse(adminRequest(), "101")).rejects.toThrow(
      "Administrator access is not valid for this course"
    );
  });
});

describe("AdminController", () => {
  it("indexes legacy configured courses once and serves split summary, list, and detail resources", async () => {
    const repositories = createInMemoryRepositories({
      courses: {
        "101": {
          id: "101",
          courseId: "101",
          setupCompleted: true,
          sebDefaults: { urlRules: [], externalTools: [] }
        }
      },
      assessments: { classicquiz_501: assessmentRecord() }
    });
    const canvasApi = canvasApiDouble();
    const controller = controllerDouble(repositories, canvasApi);

    await expect(controller.summary({} as any)).resolves.toMatchObject({
      account: { id: "7", name: "Example School" },
      summary: {
        courseCount: 1,
        configuredCourseCount: 1,
        assessmentCount: 1,
        enabledAssessmentCount: 1
      }
    });
    await expect(controller.listCourses({} as any)).resolves.toMatchObject({
      courses: [expect.objectContaining({ id: "101", name: "Biology", assessmentCount: 1 })],
      nextCursor: null
    });
    await expect(controller.courseDetail({} as any, "101")).resolves.toMatchObject({
      course: {
        id: "101",
        setupCompleted: true,
        assessments: [expect.objectContaining({ id: "classicquiz_501", sebRequired: true })]
      }
    });
    expect(canvasApi.getAdminCourse).toHaveBeenCalledTimes(1);
  });

  it("connects selected Canvas courses and synchronizes assessments without enumerating the institution", async () => {
    const repositories = createInMemoryRepositories();
    const assessments = {
      refreshCourseContent: vi.fn().mockResolvedValue({ assessments: [assessmentRecord()] })
    };
    const canvasApi = canvasApiDouble();
    const controller = controllerDouble(repositories, canvasApi, assessments);

    await expect(controller.connectCourses({} as any, { courseIds: ["101"] })).resolves.toMatchObject({
      success: true,
      connectedCount: 1,
      results: [{ courseId: "101", success: true }]
    });
    expect(assessments.refreshCourseContent).toHaveBeenCalledWith("101", "42", "account_admin", {
      courseWriteLockHeld: true
    });
    await expect(repositories.adminCourseConnections.get("7:101")).resolves.toMatchObject({
      rootAccountId: "7",
      courseId: "101",
      name: "Biology"
    });
  });

  it("requires exact confirmation and delegates the admin-only course reset without touching OAuth directly", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") },
      oauthTokens: { "42": { id: "42", userId: "42", accessToken: "preserved-token" } }
    });
    const resetCourseForAdmin = vi.fn().mockResolvedValue({
      disabledAssessmentCount: 2,
      deletedAssessmentCount: 2,
      deletedTransientStateCount: 1,
      deletedCourseRecordCount: 1,
      deletedPresetAssignmentCount: 1
    });
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "wrong" })).rejects.toThrow(
      "Enter the Canvas course ID"
    );
    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).resolves.toMatchObject({
      success: true,
      disabledAssessmentCount: 2,
      deletedAssessmentCount: 2,
      deletedPresetAssignmentCount: 1
    });
    expect(resetCourseForAdmin).toHaveBeenCalledWith("101", "42", "7");
    await expect(repositories.oauthTokens.get("42")).resolves.toMatchObject({ accessToken: "preserved-token" });
  });

  it("returns an actionable conflict when an assessment update blocks a course reset", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const resetCourseForAdmin = vi.fn().mockRejectedValue(new AssessmentOperationInProgressError());
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        error_code: "ADMIN_COURSE_RESET_ASSESSMENT_BUSY",
        message: expect.stringContaining("course records were not deleted")
      })
    });
  });

  it.each([
    new AssessmentOperationLockLostError(),
    new CourseMutationOperationLockLostError(),
    new CourseResetOperationLockLostError()
  ])("requires reset verification when any operation lease is lost", async (lockError) => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const resetCourseForAdmin = vi.fn().mockRejectedValue(lockError);
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        error_code: "ADMIN_COURSE_RESET_VERIFY_REQUIRED",
        message: expect.stringContaining("verify Canvas assessment access codes")
      })
    });
  });

  it("reports a bounded upstream failure when Canvas reset discovery fails", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const resetCourseForAdmin = vi
      .fn()
      .mockRejectedValue(new CanvasApiRequestError("Canvas unavailable", "42", "", 502));
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).rejects.toMatchObject({
      status: 502,
      response: expect.objectContaining({
        error_code: "ADMIN_COURSE_RESET_CANVAS_FAILED",
        message: expect.stringContaining("Course records were not deleted")
      })
    });
  });

  it("keeps local records when Canvas omits an assessment identity required for reset", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const resetCourseForAdmin = vi.fn().mockRejectedValue(new CourseResetAssessmentIdentityError());
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        error_code: "ADMIN_COURSE_RESET_ASSESSMENT_IDENTITY_UNAVAILABLE",
        message: expect.stringContaining("Course records were not deleted")
      })
    });
  });

  it("requires manual verification when a stopped reset cannot restore every Canvas access code", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const resetCourseForAdmin = vi
      .fn()
      .mockRejectedValue(new CourseResetCompensationError(new Error("reset failed"), [new Error("rollback failed")]));
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        error_code: "ADMIN_COURSE_RESET_ROLLBACK_VERIFY_REQUIRED",
        message: expect.stringContaining("verify every assessment")
      })
    });
  });

  it("requires manual verification when the database reset outcome is unknown", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const resetCourseForAdmin = vi
      .fn()
      .mockRejectedValue(new CourseResetOutcomeUnknownError(new Error("commit lost"), new Error("read failed")));
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        error_code: "ADMIN_COURSE_RESET_VERIFY_REQUIRED",
        message: expect.stringContaining("may have completed")
      })
    });
  });

  it("requires reconciliation before reset when an enabled assessment has no stored access code", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const resetCourseForAdmin = vi
      .fn()
      .mockRejectedValue(new AssessmentAccessCodeConsistencyError("missing access code"));
    const controller = controllerDouble(repositories, canvasApiDouble(), { resetCourseForAdmin });

    await expect(controller.resetCourse({} as any, "101", { confirmation: "101" })).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        error_code: "ADMIN_COURSE_RESET_VERIFY_REQUIRED",
        message: expect.stringContaining("Course records were not deleted")
      })
    });
  });

  it("reveals assessment secrets with no audit repository or persistence side effect", async () => {
    const repositories = createInMemoryRepositories({ assessments: { classicquiz_501: assessmentRecord() } });
    const response = { setHeader: vi.fn() };
    const controller = controllerDouble(repositories, canvasApiDouble());

    await expect(
      controller.revealAssessmentPasswords({} as any, response as any, "101", "classicquiz_501")
    ).resolves.toMatchObject({
      passwords: {
        start: { value: "start-secret" },
        exit: { value: "exit-secret" },
        accessCode: { value: "canvas-secret" }
      }
    });
    expect(Object.keys(repositories)).not.toContain("adminAuditLogs");
    expect(response.setHeader).toHaveBeenCalledWith("cache-control", "private, no-store, max-age=0");
  });

  it("rotates the course exit password through the leased course-settings operation", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    const rotateQuitPassword = vi.fn().mockResolvedValue("generated-exit-passphrase");
    const courseSettings = {
      getDefaults: vi.fn().mockResolvedValue({}),
      resetQuizToDefaults: vi.fn(),
      rotateQuitPassword
    };
    const response = { setHeader: vi.fn() };
    const controller = controllerDouble(repositories, canvasApiDouble(), {}, null, courseSettings);

    await expect(controller.rotateCourseQuitPassword({} as any, response as any, "101")).resolves.toMatchObject({
      success: true,
      passwords: { exit: { value: "generated-exit-passphrase", source: "course" } }
    });
    expect(rotateQuitPassword).toHaveBeenCalledWith("101");
    expect(response.setHeader).toHaveBeenCalledWith("cache-control", "private, no-store, max-age=0");
  });

  it("tracks bulk preset rollout state and retries each course independently", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: {
        "7:101": connectionRecord("101", "Biology"),
        "7:102": connectionRecord("102", "Chemistry")
      }
    });
    const courseSettings = {
      getDefaults: vi.fn().mockResolvedValue({}),
      resetQuizToDefaults: vi.fn(),
      pushAdminToolPreset: vi.fn().mockResolvedValue({}),
      removeAdminToolPreset: vi.fn().mockResolvedValue({})
    };
    const controller = controllerDouble(repositories, canvasApiDouble(), undefined, null, courseSettings);
    const created = await controller.createToolPreset({} as any, {
      name: "School Desmos",
      description: "Approved graphing calculator",
      tool: {
        url: "https://www.desmos.com/calculator",
        allowedRules: [{ id: "assets", match: "path", value: "https://www.desmos.com/assets/*" }]
      }
    });
    const presetId = String((created.preset as { id: string }).id);

    await expect(
      controller.assignToolPresetBulk({} as any, presetId, {
        assigned: true,
        all: true,
        courseIds: []
      })
    ).resolves.toMatchObject({
      queuedCount: 2,
      rollout: { applied: 2, failed: 0, pending: 0 }
    });
    expect(courseSettings.pushAdminToolPreset).toHaveBeenCalledTimes(2);
    await expect(controller.toolPresets({} as any)).resolves.toMatchObject({
      presets: [{ assignedCourseCount: 2, pendingAssignmentCount: 0, failedAssignmentCount: 0 }]
    });
  });

  it("does not recreate a preset assignment deleted before its course lease is acquired", async () => {
    const presetId = "00000000-0000-4000-8000-000000000001";
    const assignmentId = `${presetId}:101`;
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") },
      adminToolPresetAssignments: {
        [assignmentId]: {
          id: assignmentId,
          rootAccountId: "7",
          presetId,
          courseId: "101",
          desiredAssigned: true,
          status: "pending",
          updatedByUserId: "42"
        }
      }
    });
    const withCourseWriteLock = vi.fn(async (_courseId: string, action: () => Promise<unknown>) => {
      await repositories.adminToolPresetAssignments.delete(assignmentId);
      return action();
    });
    const courseSettings = {
      getDefaults: vi.fn().mockResolvedValue({}),
      resetQuizToDefaults: vi.fn(),
      pushAdminToolPreset: vi.fn(),
      removeAdminToolPreset: vi.fn()
    };
    const controller = controllerDouble(repositories, canvasApiDouble(), { withCourseWriteLock }, null, courseSettings);
    const preset = {
      id: presetId,
      rootAccountId: "7",
      name: "School Desmos",
      tool: { id: "desmos", label: "Desmos", url: "https://www.desmos.com/calculator", enabled: false },
      createdByUserId: "42",
      updatedByUserId: "42"
    };

    await expect(
      (controller as any).reconcilePresetAssignments({} as any, adminPrincipal(), preset, false, 1)
    ).resolves.toEqual({ processed: 0, applied: 0, failed: 0, pending: 0 });
    expect(courseSettings.pushAdminToolPreset).not.toHaveBeenCalled();
    await expect(repositories.adminToolPresetAssignments.get(assignmentId)).resolves.toBeNull();
  });

  it("updates administrator connection counts inside the refresh course lease", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") }
    });
    let lockActive = false;
    const withCourseWriteLock = vi.fn(async (_courseId: string, action: () => Promise<unknown>) => {
      lockActive = true;
      try {
        return await action();
      } finally {
        lockActive = false;
      }
    });
    const originalUpdate = repositories.adminCourseConnections.update.bind(repositories.adminCourseConnections);
    vi.spyOn(repositories.adminCourseConnections, "update").mockImplementation((id, updater) => {
      expect(lockActive).toBe(true);
      return originalUpdate(id, updater);
    });
    const refreshCourseContent = vi.fn().mockResolvedValue({ assessments: [assessmentRecord()] });
    const controller = controllerDouble(repositories, canvasApiDouble(), {
      withCourseWriteLock,
      refreshCourseContent
    });

    await expect(controller.refreshCourse({} as any, "101")).resolves.toMatchObject({ assessmentCount: 1 });
    expect(refreshCourseContent).toHaveBeenCalledWith("101", "42", "account_admin", {
      courseWriteLockHeld: true
    });
    await expect(repositories.adminCourseConnections.get("7:101")).resolves.toMatchObject({
      assessmentCount: 1,
      enabledAssessmentCount: 1
    });
  });

  it("keeps an administrator SEB toggle and its connection counts in one course lease", async () => {
    const disabledAssessment = assessmentRecord();
    disabledAssessment.seb = {
      ...disabledAssessment.seb,
      required: false,
      enabled: false,
      accessCode: null
    };
    const repositories = createInMemoryRepositories({
      adminCourseConnections: { "7:101": connectionRecord("101", "Biology") },
      assessments: { classicquiz_501: disabledAssessment }
    });
    let lockActive = false;
    const withCourseWriteLock = vi.fn(async (_courseId: string, action: () => Promise<unknown>) => {
      lockActive = true;
      try {
        return await action();
      } finally {
        lockActive = false;
      }
    });
    const enableSebWithAccessCode = vi.fn(async () => {
      expect(lockActive).toBe(true);
      await repositories.assessments.update("classicquiz_501", (current) =>
        current
          ? {
              ...current,
              seb: { ...current.seb, required: true, enabled: true, accessCode: "NEW-CANVAS-CODE" }
            }
          : null
      );
      return {
        quizId: "501",
        courseId: "101",
        sebRequired: true,
        enabled: true,
        accessCode: "NEW-CANVAS-CODE",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      };
    });
    const originalConnectionUpdate = repositories.adminCourseConnections.update.bind(
      repositories.adminCourseConnections
    );
    vi.spyOn(repositories.adminCourseConnections, "update").mockImplementation((id, updater) => {
      expect(lockActive).toBe(true);
      return originalConnectionUpdate(id, updater);
    });
    const controller = controllerDouble(repositories, canvasApiDouble(), {
      withCourseWriteLock,
      enableSebWithAccessCode
    });

    await expect(
      controller.setSebRequirement({} as any, "101", "classicquiz_501", { required: true })
    ).resolves.toMatchObject({ success: true, setting: { sebRequired: true } });

    expect(withCourseWriteLock).toHaveBeenCalledOnce();
    expect(enableSebWithAccessCode).toHaveBeenCalledWith("101", "501", "42", undefined, "account_admin", {
      courseWriteLockHeld: true
    });
    await expect(repositories.adminCourseConnections.get("7:101")).resolves.toMatchObject({
      assessmentCount: 1,
      enabledAssessmentCount: 1
    });
  });

  it("creates a school YouTube video preset with the bounded player definition", async () => {
    const controller = controllerDouble(createInMemoryRepositories(), canvasApiDouble());

    await expect(
      controller.createToolPreset({} as any, {
        name: "Cell division video",
        description: "Approved public video",
        tool: {
          url: "https://youtu.be/qZ7OjpjGVGs",
          preset: "youtube-video",
          allowedRules: []
        }
      })
    ).resolves.toMatchObject({
      preset: {
        tool: {
          preset: "youtube-video",
          url: "https://www.youtube.com/embed/qZ7OjpjGVGs?rel=0",
          allowedRules: []
        }
      }
    });
  });

  it("rejects deprecated or unconfirmed broad resource policy in school presets", async () => {
    const controller = controllerDouble(createInMemoryRepositories(), canvasApiDouble());
    await expect(
      controller.createToolPreset({} as any, {
        name: "Unsafe tool",
        tool: { url: "https://tool.example.edu", allowedDomains: ["domain:tool.example.edu"] }
      })
    ).rejects.toThrow("Preset resources must use explicit HTTPS URLs or confirmed domains");
  });

  it("treats non-scalar admin query parameters as invalid instead of coercing them", async () => {
    const repositories = createInMemoryRepositories({
      adminCourseConnections: {
        "7:101": connectionRecord("101", "Biology"),
        "7:102": connectionRecord("102", "Chemistry")
      }
    });
    const getAdminCoursesPage = vi.fn().mockResolvedValue({ courses: [], nextPage: null });
    const controller = controllerDouble(repositories, { ...canvasApiDouble(), getAdminCoursesPage });

    await expect(
      controller.listCourses({} as any, ["Biology"] as any, { cursor: "invalid" } as any, ["1"] as any)
    ).resolves.toMatchObject({
      courses: [expect.objectContaining({ id: "101" }), expect.objectContaining({ id: "102" })],
      nextCursor: null
    });

    await controller.courseCatalog(
      {} as any,
      ["Biology"] as any,
      ["22"] as any,
      { cursor: "invalid" } as any,
      ["true"] as any,
      ["false"] as any
    );
    expect(getAdminCoursesPage).toHaveBeenCalledWith("7", "42", {
      page: 1,
      perPage: 25,
      search: undefined,
      termId: undefined,
      includeUnpublished: false,
      withEnrollments: true
    });
  });
});

function controllerDouble(
  repositories: any,
  canvasApi: any,
  assessments: any = {},
  defaultQuitPassword: string | null = null,
  courseSettingsOverride?: any
) {
  const authorization = {
    requireAdmin: vi.fn().mockReturnValue(adminPrincipal()),
    requireAdminForCourse: vi.fn().mockImplementation(async (_request: unknown, courseId: string) => ({
      principal: adminPrincipal(),
      course: { ...canvasCourse(), id: courseId }
    }))
  };
  const courseSettings = courseSettingsOverride || {
    getDefaults: vi.fn().mockResolvedValue({}),
    resetQuizToDefaults: vi.fn(),
    rotateQuitPassword: vi.fn()
  };
  const assessmentService = {
    getAssessmentRecord: (id: string) => repositories.assessments.get(id),
    refreshCourseContent: vi.fn().mockResolvedValue({ assessments: [] }),
    withCourseWriteLock: vi.fn(async (_courseId: string, action: () => Promise<unknown>) => action()),
    ...assessments
  };
  return new AdminController(
    configDouble(defaultQuitPassword) as any,
    { value: repositories } as any,
    authorization as any,
    canvasApi as any,
    assessmentService as any,
    courseSettings as any
  );
}

function canvasApiDouble() {
  return {
    getCanvasDomain: () => "https://canvas.example.edu",
    getAdminAccount: vi.fn().mockResolvedValue({ id: "7", name: "Example School", rootAccountId: "7" }),
    getAdminCourse: vi.fn().mockResolvedValue(canvasCourse()),
    getAdminPermissions: vi.fn().mockResolvedValue({ manage_course_content_edit: true })
  };
}

function canvasCourse() {
  return {
    id: "101",
    name: "Biology",
    courseCode: "BIO-101",
    accountId: "7",
    rootAccountId: "7",
    workflowState: "available",
    termId: "22",
    termName: "Fall 2026",
    teacherNames: ["Teacher One"]
  };
}

function connectionRecord(courseId: string, name: string) {
  return {
    id: `7:${courseId}`,
    rootAccountId: "7",
    canvasOrigin: "https://canvas.example.edu",
    courseId,
    name,
    courseCode: null,
    accountId: "7",
    workflowState: "available",
    termId: "22",
    termName: "Fall 2026",
    teacherNames: [],
    assessmentCount: 0,
    enabledAssessmentCount: 0,
    issueCount: 0,
    connectedByUserId: "42"
  };
}

function assessmentRecord() {
  return {
    id: "classicquiz_501",
    courseId: "101",
    contentType: "CLASSIC_QUIZ" as const,
    canvas: { id: "501", quizId: "501", title: "Midterm", published: true },
    seb: {
      required: true,
      enabled: true,
      accessCode: "canvas-secret",
      configKey: null,
      quitPassword: "exit-secret",
      startPassword: "start-secret",
      usesCourseDefaults: false,
      quitPasswordOverride: true,
      startPasswordOverride: true,
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: [],
      quizOnlyExternalTools: [],
      externalToolIds: null
    }
  };
}

function adminPrincipal() {
  return {
    version: 1 as const,
    contextType: "account" as const,
    issuer: "https://canvas.example.edu",
    deploymentId: "deployment-1",
    subject: "admin-subject",
    canvasUserId: "42",
    courseId: "" as const,
    accountId: "7",
    rootAccountId: "7",
    isRootAccountAdmin: true as const,
    roles: [administratorRole],
    custom: {},
    authenticatedAt: "2026-07-16T00:00:00.000Z"
  };
}

function adminRequest() {
  return {
    sessionID: "session-1",
    session: { verifiedLtiPrincipal: adminPrincipal() },
    header: (name: string) => (name.toLowerCase() === "origin" ? "https://tool.example.edu" : undefined)
  } as any;
}

function courseRequest() {
  return {
    sessionID: "session-1",
    session: {
      verifiedLtiPrincipal: {
        ...adminPrincipal(),
        contextType: "course",
        courseId: "101",
        isRootAccountAdmin: false
      }
    },
    header: () => undefined
  } as any;
}

function configDouble(defaultQuitPassword: string | null = null) {
  return {
    getRequiredToolUrl: () => "https://tool.example.edu",
    value: { seb: { defaultQuitPassword } }
  };
}
