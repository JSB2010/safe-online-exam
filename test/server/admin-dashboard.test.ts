// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { AdminController } from "../../src/server/controllers/admin.controller.js";
import { createInMemoryRepositories } from "../../src/server/data/in-memory-repositories.js";
import { AdminAuthorizationService } from "../../src/server/services/admin-authorization.service.js";

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
    expect(assessments.refreshCourseContent).toHaveBeenCalledWith("101", "42", "account_admin");
    await expect(repositories.adminCourseConnections.get("7:101")).resolves.toMatchObject({
      rootAccountId: "7",
      courseId: "101",
      name: "Biology"
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

  it("rejects deprecated or unconfirmed broad resource policy in school presets", async () => {
    const controller = controllerDouble(createInMemoryRepositories(), canvasApiDouble());
    await expect(
      controller.createToolPreset({} as any, {
        name: "Unsafe tool",
        tool: { url: "https://tool.example.edu", allowedDomains: ["domain:tool.example.edu"] }
      })
    ).rejects.toThrow("Preset resources must use explicit HTTPS URLs or confirmed domains");
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
    resetQuizToDefaults: vi.fn()
  };
  const assessmentService = {
    getAssessmentRecord: (id: string) => repositories.assessments.get(id),
    refreshCourseContent: vi.fn().mockResolvedValue({ assessments: [] }),
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
