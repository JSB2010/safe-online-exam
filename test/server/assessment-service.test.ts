import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentWithContentSebSetting, assessmentWithQuizSebSetting } from "../../src/shared/models.js";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import {
  ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS,
  ASSESSMENT_VERIFICATION_MAX_AGE_MS,
  AssessmentOperationInProgressError,
  AssessmentOperationLockLostError,
  AssessmentAccessCodeConsistencyError,
  AssessmentService,
  CourseMutationInProgressError,
  CourseResetAssessmentIdentityError,
  CourseResetCompensationError,
  CourseResetInProgressError
} from "../../src/server/services/assessment.service.js";
import { CanvasApiService } from "../../src/server/services/canvas-api.service.js";

const originalServerQuitPassword = process.env.SEB_QUIT_PASSWORD;
const originalLegacyServerQuitPassword = process.env.DEFAULT_SEB_QUIT_PASSWORD;

beforeEach(() => {
  process.env.SEB_QUIT_PASSWORD = "managed-server-exit";
});

afterEach(() => {
  if (originalServerQuitPassword === undefined) {
    delete process.env.SEB_QUIT_PASSWORD;
  } else {
    process.env.SEB_QUIT_PASSWORD = originalServerQuitPassword;
  }
  if (originalLegacyServerQuitPassword === undefined) {
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
  } else {
    process.env.DEFAULT_SEB_QUIT_PASSWORD = originalLegacyServerQuitPassword;
  }
});

describe("AssessmentService", () => {
  it("rejects passwordless enablement before changing the Canvas access code", async () => {
    delete process.env.SEB_QUIT_PASSWORD;
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    await expect(service.enableSebWithAccessCode("course-1", "quiz-1", "user-1")).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_QUIT_PASSWORD_REQUIRED" }),
      status: 400
    });
    expect(canvas.setQuizAccessCode).not.toHaveBeenCalled();
    await expect(repos.value.assessments.get("classicquiz_quiz-1")).resolves.toBeNull();
  });

  it("rejects access-code rotation for legacy passwordless assessments before changing Canvas", async () => {
    delete process.env.SEB_QUIT_PASSWORD;
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
    const repositories = createInMemoryRepositories();
    const repos = { value: repositories } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      setNewQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    await repositories.assessments.save(
      "classicquiz_quiz-1",
      assessmentWithQuizSebSetting(null, {
        quizId: "quiz-1",
        courseId: "course-1",
        sebRequired: true,
        enabled: true,
        accessCode: "OLD-CLASSIC-CODE",
        quitPassword: null,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    await repositories.assessments.save(
      "newquiz:course-1:assignment-1",
      assessmentWithContentSebSetting(null, {
        contentId: "newquiz:course-1:assignment-1",
        courseId: "course-1",
        assignmentId: "assignment-1",
        contentType: "NEW_QUIZ",
        sebRequired: true,
        enabled: true,
        accessCode: "OLD-NEW-CODE",
        quitPassword: null,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    const service = new AssessmentService(repos, canvas);

    await expect(service.regenerateQuizAccessCode("course-1", "quiz-1", "user-1")).rejects.toMatchObject({
      status: 400
    });
    await expect(
      service.regenerateContentAccessCode("course-1", "newquiz:course-1:assignment-1", "assignment-1", "user-1")
    ).rejects.toMatchObject({ status: 400 });
    expect(canvas.setQuizAccessCode).not.toHaveBeenCalled();
    expect(canvas.setNewQuizAccessCode).not.toHaveBeenCalled();
  });

  it("accepts the managed server quit password without persisting or returning it", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    const enabled = await service.enableSebWithAccessCode("course-1", "quiz-1", "user-1");

    expect(enabled.sebRequired).toBe(true);
    expect(enabled.quitPassword).toBeNull();
    expect(JSON.stringify(enabled)).not.toContain("managed-server-exit");
  });

  it("rejects inherited and managed-default start/exit password collisions before changing Canvas", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    await expect(
      service.enableSebWithAccessCode("course-1", "quiz-1", "user-1", {
        id: "course-1",
        courseId: "course-1",
        quitPassword: "shared-course-passphrase",
        startPassword: "shared-course-passphrase",
        setupCompleted: true,
        urlRules: [],
        externalTools: []
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_PASSWORD_REUSE" }),
      status: 400
    });
    expect(canvas.setQuizAccessCode).not.toHaveBeenCalled();

    await expect(
      service.saveQuizSebSetting({
        quizId: "quiz-2",
        courseId: "course-1",
        sebRequired: false,
        enabled: false,
        quitPassword: null,
        startPassword: "managed-server-exit",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_PASSWORD_REUSE" }),
      status: 400
    });
    await expect(repos.value.assessments.get("classicquiz_quiz-2")).resolves.toBeNull();
  });

  it("preserves a quiz-specific quit password when re-enabling a disabled assessment", async () => {
    delete process.env.SEB_QUIT_PASSWORD;
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: false,
      enabled: false,
      quitPassword: "quiz-exit-secret",
      quitPasswordOverride: true,
      usesCourseDefaults: false,
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });

    await expect(service.enableSebWithAccessCode("course-1", "quiz-1", "user-1")).resolves.toMatchObject({
      sebRequired: true,
      enabled: true,
      quitPassword: "quiz-exit-secret",
      quitPasswordOverride: true
    });
    expect(canvas.setQuizAccessCode).toHaveBeenCalledOnce();
  });

  it("treats blank write-only assessment password updates as no change", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new AssessmentService(repos, {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService);
    const existing = await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: false,
      enabled: false,
      quitPassword: "unique-quit-passphrase",
      startPassword: "unique-start-passphrase",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });

    await expect(
      service.saveQuizSebSetting({ ...existing, quitPassword: "   ", startPassword: "\t" })
    ).resolves.toMatchObject({
      quitPassword: "unique-quit-passphrase",
      startPassword: "unique-start-passphrase"
    });
  });

  it("rejects newly supplied weak assessment start and exit passwords at both persistence boundaries", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new AssessmentService(repos, {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService);
    const common = {
      courseId: "course-1",
      sebRequired: false,
      enabled: false,
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    };

    await expect(
      service.saveQuizSebSetting({ ...common, quizId: "quiz-weak-exit", quitPassword: "password1234" })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_PASSWORD_POLICY_VIOLATION" }),
      status: 400
    });
    await expect(
      service.saveContentSebSetting({
        ...common,
        contentId: "newquiz:course-1:weak-start",
        startPassword: "password1"
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_PASSWORD_POLICY_VIOLATION" }),
      status: 400
    });
    await expect(repos.value.assessments.get("classicquiz_quiz-weak-exit")).resolves.toBeNull();
    await expect(repos.value.assessments.get("newquiz:course-1:weak-start")).resolves.toBeNull();
  });

  it("rejects passwordless active settings at both assessment persistence boundaries", async () => {
    delete process.env.SEB_QUIT_PASSWORD;
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    const common = {
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      quitPassword: " ",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    };

    await expect(service.saveQuizSebSetting({ ...common, quizId: "quiz-1" })).rejects.toMatchObject({
      status: 400
    });
    await expect(
      service.saveContentSebSetting({ ...common, contentId: "newquiz:course-1:assignment-1" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(repos.value.assessments.get("classicquiz_quiz-1")).resolves.toBeNull();
    await expect(repos.value.assessments.get("newquiz:course-1:assignment-1")).resolves.toBeNull();

    await expect(
      service.saveQuizSebSetting({ ...common, quizId: "quiz-1", sebRequired: false, enabled: false })
    ).resolves.toMatchObject({ sebRequired: false, enabled: false });
  });

  it("refreshes Classic Quiz and New Quiz content into unified assessment records", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse: vi
        .fn()
        .mockResolvedValue([{ id: "42", title: "Classic Quiz", courseId: "course-7", published: true }]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([
        {
          id: "newquiz:course-7:99",
          courseId: "course-7",
          canvasId: "99",
          assignmentId: "99",
          contentType: "NEW_QUIZ",
          title: "New Quiz",
          published: true
        }
      ])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    const content = await service.refreshCourseContent("course-7", "user-1");

    expect(content.classicQuizzes.map((quiz) => quiz.id)).toEqual(["42"]);
    expect(content.contentItems.map((item) => item.id)).toEqual(["classicquiz_42", "newquiz:course-7:99"]);
    await expect(repos.value.assessments.get("classicquiz_42")).resolves.toMatchObject({
      id: "classicquiz_42",
      contentType: "CLASSIC_QUIZ",
      canvas: { quizId: "42", title: "Classic Quiz" },
      canvasVerification: {
        status: "verified",
        checkedAt: expect.any(String),
        lastVerifiedAt: expect.any(String)
      }
    });
    await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(true);
    await expect(service.isAssessmentAvailableForLearner("course-7", "newquiz:course-7:99")).resolves.toBe(true);
    await expect(service.getQuiz("42")).resolves.toMatchObject({ id: "42", title: "Classic Quiz" });
    await expect(service.getContentSebSetting("newquiz:course-7:99")).resolves.toMatchObject({
      contentId: "newquiz:course-7:99",
      contentType: "NEW_QUIZ"
    });
  });

  it("tombstones assessments omitted from a successful complete Canvas refresh without deleting instructor settings", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse: vi
        .fn()
        .mockResolvedValueOnce([{ id: "42", title: "Classic Quiz", courseId: "course-7", published: true }])
        .mockResolvedValueOnce([]),
      getNewQuizAssignments: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: "newquiz:course-7:99",
            courseId: "course-7",
            canvasId: "99",
            assignmentId: "99",
            contentType: "NEW_QUIZ",
            title: "New Quiz",
            published: true
          }
        ])
        .mockResolvedValueOnce([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    await service.refreshCourseContent("course-7", "user-1");
    await service.saveQuizSebSetting({
      quizId: "42",
      courseId: "course-7",
      sebRequired: true,
      enabled: true,
      accessCode: "CLASSIC-ACCESS",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });
    await service.saveContentSebSetting({
      contentId: "newquiz:course-7:99",
      courseId: "course-7",
      canvasId: "99",
      assignmentId: "99",
      contentType: "NEW_QUIZ",
      sebRequired: true,
      enabled: true,
      accessCode: "NEW-ACCESS",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });

    const refreshed = await service.refreshCourseContent("course-7", "user-1");

    expect(refreshed.contentItems).toEqual([]);
    await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);
    await expect(service.isAssessmentAvailableForLearner("course-7", "newquiz:course-7:99")).resolves.toBe(false);
    await expect(repos.value.assessments.get("classicquiz_42")).resolves.toMatchObject({
      seb: { accessCode: "CLASSIC-ACCESS", enabled: true },
      canvasVerification: { status: "missing", lastVerifiedAt: expect.any(String) }
    });
    await expect(repos.value.assessments.get("newquiz:course-7:99")).resolves.toMatchObject({
      seb: { accessCode: "NEW-ACCESS", enabled: true },
      canvasVerification: { status: "missing", lastVerifiedAt: expect.any(String) }
    });
  });

  it("keeps cached New Quiz data for instructors but marks it stale after transient discovery failure", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const getNewQuizAssignments = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "newquiz:course-7:99",
          courseId: "course-7",
          canvasId: "99",
          assignmentId: "99",
          contentType: "NEW_QUIZ",
          title: "New Quiz",
          published: true
        }
      ])
      .mockRejectedValueOnce(new Error("New Quiz API unavailable"));
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    await service.refreshCourseContent("course-7", "user-1");
    const before = await repos.value.assessments.get("newquiz:course-7:99");
    const refreshed = await service.refreshCourseContent("course-7", "user-1");

    expect(refreshed.contentItems).toEqual([expect.objectContaining({ id: "newquiz:course-7:99" })]);
    await expect(service.isAssessmentAvailableForLearner("course-7", "newquiz:course-7:99")).resolves.toBe(false);
    await expect(repos.value.assessments.get("newquiz:course-7:99")).resolves.toMatchObject({
      canvasVerification: {
        status: "stale",
        lastVerifiedAt: before?.canvasVerification?.lastVerifiedAt
      }
    });
  });

  it("fails all cached learner availability closed when course discovery aborts before New Quiz discovery", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const getQuizzesForCourse = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Classic Quiz API unavailable"));
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse,
      getNewQuizAssignments: vi.fn().mockResolvedValue([
        {
          id: "newquiz:course-7:99",
          courseId: "course-7",
          canvasId: "99",
          assignmentId: "99",
          contentType: "NEW_QUIZ",
          title: "New Quiz",
          published: true
        }
      ])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    await service.refreshCourseContent("course-7", "user-1");
    await expect(service.isAssessmentAvailableForLearner("course-7", "newquiz:course-7:99")).resolves.toBe(true);
    await expect(service.refreshCourseContent("course-7", "user-1")).rejects.toThrow("Classic Quiz API unavailable");
    await expect(service.isAssessmentAvailableForLearner("course-7", "newquiz:course-7:99")).resolves.toBe(false);
    await expect(repos.value.assessments.get("newquiz:course-7:99")).resolves.toMatchObject({
      canvasVerification: { status: "stale", lastVerifiedAt: expect.any(String) }
    });
  });

  it("treats legacy assessment records without authoritative Canvas verification as unavailable to learners", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    await repos.value.assessments.save(
      "classicquiz_42",
      assessmentWithQuizSebSetting(null, {
        quizId: "42",
        courseId: "course-7",
        sebRequired: true,
        enabled: true,
        accessCode: "LEGACY-ACCESS",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );

    await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);
  });

  it("requires Canvas publication and an open availability window for learner use", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const getQuizzesForCourse = vi
      .fn()
      .mockResolvedValueOnce([{ id: "42", title: "Unpublished", courseId: "course-7", published: false }])
      .mockResolvedValueOnce([
        {
          id: "42",
          title: "Locked",
          courseId: "course-7",
          published: true,
          unlockAt: new Date(Date.now() + 60_000).toISOString()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "42",
          title: "Available",
          courseId: "course-7",
          published: true,
          unlockAt: new Date(Date.now() - 60_000).toISOString(),
          lockAt: new Date(Date.now() + 60_000).toISOString()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "42",
          title: "Closed",
          courseId: "course-7",
          published: true,
          lockAt: new Date(Date.now() - 1).toISOString()
        }
      ]);
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse,
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    await service.refreshCourseContent("course-7", "user-1");
    await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);
    await service.refreshCourseContent("course-7", "user-1");
    await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);
    await service.refreshCourseContent("course-7", "user-1");
    await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(true);
    await service.refreshCourseContent("course-7", "user-1");
    await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);
  });

  it("expires learner verification at the 24-hour boundary and rejects malformed or future-dated timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    try {
      const repositories = createInMemoryRepositories();
      const repos = { value: repositories } as RepositoryProvider;
      const canvas = {
        getQuizzesForCourse: vi.fn().mockResolvedValue([]),
        getNewQuizAssignments: vi.fn().mockResolvedValue([])
      } as unknown as CanvasApiService;
      const service = new AssessmentService(repos, canvas);
      const base = assessmentWithQuizSebSetting(null, {
        quizId: "42",
        courseId: "course-7",
        sebRequired: true,
        enabled: true,
        accessCode: "ACCESS",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      });
      const saveVerification = async (checkedAt: string, lastVerifiedAt = checkedAt): Promise<void> => {
        await repositories.assessments.save("classicquiz_42", {
          ...base,
          canvas: { ...base.canvas, published: true },
          canvasVerification: { status: "verified", checkedAt, lastVerifiedAt }
        });
      };
      const now = Date.now();

      await saveVerification(new Date(now - ASSESSMENT_VERIFICATION_MAX_AGE_MS).toISOString());
      await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(true);

      await saveVerification(new Date(now - ASSESSMENT_VERIFICATION_MAX_AGE_MS - 1).toISOString());
      await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);

      await saveVerification("not-a-timestamp");
      await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);

      await saveVerification(new Date(now + ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS + 1).toISOString());
      await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);

      await saveVerification(new Date(now).toISOString(), new Date(now - 1).toISOString());
      await expect(service.isAssessmentAvailableForLearner("course-7", "classicquiz_42")).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears legacy and refreshed raw New Quiz metadata before storage or return", async () => {
    const secretMetadata = {
      quiz_settings: { student_access_code: "CANVAS-ACCESS-SECRET" },
      config_key: "CANVAS-CONFIG-SECRET"
    };
    const repos = {
      value: createInMemoryRepositories({
        assessments: {
          "newquiz:course-7:99": {
            id: "newquiz:course-7:99",
            courseId: "course-7",
            contentType: "NEW_QUIZ",
            canvas: { id: "99", assignmentId: "99", title: "Legacy New Quiz", metadata: secretMetadata },
            seb: {
              required: false,
              enabled: false,
              usesCourseDefaults: true,
              quitPasswordOverride: false,
              startPasswordOverride: false,
              ssoDomains: [],
              educationalToolDomains: [],
              customDomains: [],
              urlRules: [],
              externalTools: []
            }
          }
        }
      })
    } as RepositoryProvider;
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([
        {
          id: "newquiz:course-7:99",
          courseId: "course-7",
          canvasId: "99",
          assignmentId: "99",
          contentType: "NEW_QUIZ",
          title: "Refreshed New Quiz",
          metadata: secretMetadata
        }
      ])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    const refreshed = await service.refreshCourseContent("course-7", "user-1");
    const stored = await repos.value.assessments.get("newquiz:course-7:99");

    expect(stored?.canvas.metadata).toBeNull();
    expect(JSON.stringify(stored)).not.toContain("CANVAS-ACCESS-SECRET");
    expect(JSON.stringify(stored)).not.toContain("CANVAS-CONFIG-SECRET");
    expect(JSON.stringify(refreshed.contentItems)).not.toContain("CANVAS-ACCESS-SECRET");
    expect(JSON.stringify(refreshed.contentItems)).not.toContain("CANVAS-CONFIG-SECRET");
  });

  it("preserves SEB state during Canvas metadata refreshes", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse: vi
        .fn()
        .mockResolvedValue([
          { id: "42", title: "Updated Classic Quiz", courseId: "course-7", htmlUrl: "https://canvas.example.edu/q/42" }
        ]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    await service.saveQuizSebSetting({
      quizId: "42",
      courseId: "course-7",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });

    await service.refreshCourseContent("course-7", "user-1");

    await expect(service.getSebSettingForQuiz("42")).resolves.toMatchObject({
      accessCode: "ACCESS",
      configKey: "config-key"
    });
    await expect(service.getQuiz("42")).resolves.toMatchObject({
      title: "Updated Classic Quiz",
      htmlUrl: "https://canvas.example.edu/q/42"
    });
  });

  it("keeps cached New Quiz content when New Quiz discovery fails after Classic Quiz refresh", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse: vi.fn().mockResolvedValue([{ id: "42", title: "Classic Quiz", courseId: "course-7" }]),
      getNewQuizAssignments: vi.fn().mockRejectedValue(new Error("New Quiz API unavailable"))
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    await service.saveContentSebSetting({
      contentId: "newquiz:course-7:99",
      courseId: "course-7",
      canvasId: "99",
      assignmentId: "99",
      contentType: "NEW_QUIZ",
      sebRequired: true,
      enabled: true,
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });

    const content = await service.refreshCourseContent("course-7", "user-1");

    expect(content.classicQuizzes.map((quiz) => quiz.id)).toEqual(["42"]);
    expect(content.contentItems.map((item) => item.id)).toEqual(["classicquiz_42", "newquiz:course-7:99"]);
  });

  it("fails closed when loading unsafe URL policy from a persisted assessment", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    const record = await repos.value.assessments.save("newquiz:course-7:99", {
      id: "newquiz:course-7:99",
      courseId: "course-7",
      contentType: "NEW_QUIZ",
      canvas: {
        id: "99",
        assignmentId: "99",
        title: "Persisted New Quiz"
      },
      seb: {
        required: true,
        enabled: true,
        usesCourseDefaults: false,
        quitPasswordOverride: false,
        startPasswordOverride: false,
        ssoDomains: ["*.*", "login.example.edu"],
        educationalToolDomains: ["*.edu", "tools.example.edu"],
        customDomains: ["regex:^https://.+$", "*.*", "domain:docs.example.edu"],
        urlRules: [],
        externalTools: [
          {
            id: "regex-tool",
            label: "Unsafe tool",
            url: "https://evil.example.edu/",
            enabled: true,
            matchType: "regex",
            allowedPattern: "^https://.+$",
            allowedDomains: ["regex:^https://.+$"]
          },
          {
            id: "desmos-calculator",
            label: "Changed",
            url: "https://evil.example.edu/",
            enabled: true,
            preset: "desmos-calculator",
            allowedDomains: ["regex:^https://.+$"]
          }
        ]
      }
    });
    expect(record).not.toBeNull();

    await expect(service.getContentSebSetting("newquiz:course-7:99")).resolves.toMatchObject({
      ssoDomains: ["login.example.edu"],
      educationalToolDomains: ["tools.example.edu"],
      customDomains: ["domain:docs.example.edu"],
      urlRules: [{ match: "domain", value: "docs.example.edu" }],
      externalTools: [
        expect.objectContaining({
          id: "desmos-graphing",
          label: "Desmos Graphing Calculator",
          url: "https://www.desmos.com/calculator",
          enabled: true,
          preset: "desmos-graphing"
        })
      ]
    });
  });

  it("saves structured assessment policy as exact/domain-only canonical data", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new AssessmentService(repos, {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService);

    const saved = await service.updateSebConfigurationStructured({
      quizId: "quiz-1",
      courseId: "course-1",
      usesCourseDefaults: false,
      ssoDomains: ["*.*", "login.example.edu"],
      educationalToolDomains: ["*.edu", "tools.example.edu"],
      customDomains: ["regex:^https://.+$", "*.*"],
      urlRules: [
        { id: "regex", match: "regex", value: "^https://.+$" },
        { id: "wildcard", match: "domain", value: "*.*" },
        { id: "exact", match: "exact", value: "https://tool.example.edu/start" },
        { id: "docs", match: "domain", value: "Docs.Example.Edu" }
      ]
    });

    expect(saved).toMatchObject({
      sebRequired: false,
      enabled: false,
      ssoDomains: ["login.example.edu"],
      educationalToolDomains: ["tools.example.edu"],
      customDomains: ["exact:https://tool.example.edu/start", "domain:docs.example.edu"],
      urlRules: [
        { id: "exact", match: "exact", value: "https://tool.example.edu/start" },
        { id: "docs", match: "domain", value: "docs.example.edu" }
      ],
      externalTools: []
    });
  });

  it("enables and disables SEB with Canvas access codes for Classic Quizzes", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      removeQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    const enabled = await service.enableSebWithAccessCode("course-1", "quiz-1", "user-1");
    expect(enabled.sebRequired).toBe(true);
    expect(enabled.accessCode).toMatch(/^[A-Z0-9]{16}$/u);
    expect(canvas.setQuizAccessCode).toHaveBeenCalled();
    await expect(repos.value.assessments.get("classicquiz_quiz-1")).resolves.toMatchObject({
      seb: { required: true, enabled: true, accessCode: enabled.accessCode }
    });

    const disabled = await service.disableSebWithAccessCode("course-1", "quiz-1", "user-1");
    expect(disabled.sebRequired).toBe(false);
    expect(disabled.accessCode).toBeNull();
    expect(canvas.removeQuizAccessCode).toHaveBeenCalled();
  });

  it("applies course defaults when SEB is enabled for a new Classic Quiz setting", async () => {
    delete process.env.SEB_QUIT_PASSWORD;
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);

    const enabled = await service.enableSebWithAccessCode("course-1", "quiz-1", "user-1", {
      id: "course-1",
      courseId: "course-1",
      quitPassword: "default-exit",
      startPassword: "default-start",
      setupCompleted: true,
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu", enabled: true }]
    });

    expect(enabled.usesCourseDefaults).toBe(true);
    expect(enabled.quitPassword).toBe("default-exit");
    expect(enabled.startPassword).toBe("default-start");
    expect(Buffer.from(enabled.configKeySalt || "", "base64")).toHaveLength(32);
    expect(enabled.urlRules).toEqual([{ id: "docs", match: "domain", value: "docs.example.edu" }]);
    expect(enabled.customDomains).toEqual(["domain:docs.example.edu"]);
    expect(enabled.externalTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "calc",
          label: "Calculator",
          url: "https://calc.example.edu/",
          enabled: true,
          preset: null,
          allowedDomains: []
        })
      ])
    );
  });

  it("invalidates stored Config Keys when SEB-affecting settings change", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: ["domain:docs.example.edu"],
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: []
    });
    await service.saveContentSebSetting({
      contentId: "newquiz:course-1:99",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: ["domain:docs.example.edu"],
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: []
    });

    const quizSaved = await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: ["domain:calc.example.edu"],
      urlRules: [{ id: "calc", match: "domain", value: "calc.example.edu" }],
      externalTools: []
    });
    const contentSaved = await service.saveContentSebSetting({
      contentId: "newquiz:course-1:99",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: ["domain:calc.example.edu"],
      urlRules: [{ id: "calc", match: "domain", value: "calc.example.edu" }],
      externalTools: []
    });

    expect(quizSaved.configKey).toBeNull();
    expect(contentSaved.configKey).toBeNull();
  });

  it("preserves Canvas metadata when saving SEB settings", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi
        .fn()
        .mockResolvedValue([
          { id: "quiz-1", title: "Canvas Title", courseId: "course-1", htmlUrl: "https://canvas.example.edu/q/1" }
        ]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    await service.refreshCourseContent("course-1", "user-1");

    await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });

    await expect(service.getQuiz("quiz-1")).resolves.toMatchObject({
      title: "Canvas Title",
      htmlUrl: "https://canvas.example.edu/q/1"
    });
  });

  it("saves Config Keys only when SEB settings are unchanged", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    const setting = await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: []
    });

    await expect(service.saveQuizConfigKeyIfUnchanged(setting, "config-key")).resolves.toMatchObject({
      configKey: "config-key"
    });
    await service.saveQuizSebSetting({ ...setting, accessCode: "NEW-ACCESS", configKey: null });

    await expect(service.saveQuizConfigKeyIfUnchanged(setting, "stale-config-key")).resolves.toBeNull();
    await expect(service.getSebSettingForQuiz("quiz-1")).resolves.toMatchObject({
      accessCode: "NEW-ACCESS",
      configKey: null
    });
  });

  it("saves New Quiz Config Keys only when SEB settings are unchanged", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    const setting = await service.saveContentSebSetting({
      contentId: "newquiz:course-1:99",
      courseId: "course-1",
      assignmentId: "99",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: []
    });

    await expect(service.saveContentConfigKeyIfUnchanged(setting, "content-config-key")).resolves.toMatchObject({
      configKey: "content-config-key"
    });
    await service.saveContentSebSetting({ ...setting, accessCode: "NEW-ACCESS", configKey: null });

    await expect(service.saveContentConfigKeyIfUnchanged(setting, "stale-content-config-key")).resolves.toBeNull();
  });

  it("initializes Config Key salts only when settings are unchanged", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    const quizSetting = await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      startPassword: "unique-start-passphrase",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: []
    });
    const contentSetting = await service.saveContentSebSetting({
      contentId: "newquiz:course-1:99",
      courseId: "course-1",
      assignmentId: "99",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      startPassword: "unique-start-passphrase",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: []
    });

    await expect(service.ensureQuizConfigKeySaltIfUnchanged(quizSetting)).resolves.toMatchObject({
      configKeySalt: expect.any(String)
    });
    await expect(service.ensureContentConfigKeySaltIfUnchanged(contentSetting)).resolves.toMatchObject({
      configKeySalt: expect.any(String)
    });
    await service.saveQuizSebSetting({ ...quizSetting, accessCode: "NEW-ACCESS" });
    await expect(service.ensureQuizConfigKeySaltIfUnchanged(quizSetting)).resolves.toBeNull();
  });

  it("rejects concurrent assessment lock acquisition", async () => {
    const repositories = createInMemoryRepositories();
    const service = new AssessmentService(
      { value: repositories } as RepositoryProvider,
      {
        getQuizzesForCourse: vi.fn().mockResolvedValue([]),
        getNewQuizAssignments: vi.fn().mockResolvedValue([])
      } as unknown as CanvasApiService
    );
    await repositories.operationLocks.acquire("assessment:classicquiz_quiz-1", "owner-1", 60_000);

    await expect(service.withAssessmentLock("quiz-1", async () => "ok")).rejects.toBeInstanceOf(
      AssessmentOperationInProgressError
    );
  });

  it("runs and releases successful assessment locks", async () => {
    const repositories = createInMemoryRepositories();
    const service = new AssessmentService(
      { value: repositories } as RepositoryProvider,
      {
        getQuizzesForCourse: vi.fn().mockResolvedValue([]),
        getNewQuizAssignments: vi.fn().mockResolvedValue([])
      } as unknown as CanvasApiService
    );

    await expect(service.withAssessmentLock("quiz-1", async () => "ok")).resolves.toBe("ok");
    await expect(repositories.operationLocks.get("assessment:classicquiz_quiz-1")).resolves.toBeNull();
  });

  it("renews a long-running assessment lock and proves ownership again before returning success", async () => {
    vi.useFakeTimers();
    try {
      const repositories = createInMemoryRepositories();
      const renew = vi.spyOn(repositories.operationLocks, "renew");
      const service = new AssessmentService(
        { value: repositories } as RepositoryProvider,
        {
          getQuizzesForCourse: vi.fn().mockResolvedValue([]),
          getNewQuizAssignments: vi.fn().mockResolvedValue([])
        } as unknown as CanvasApiService
      );
      let finishAction!: (value: string) => void;
      let resolveStarted!: () => void;
      const actionStarted = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      const result = service.withAssessmentLock(
        "quiz-1",
        () =>
          new Promise<string>((resolveAction) => {
            finishAction = resolveAction;
            resolveStarted();
          })
      );
      await actionStarted;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(renew).toHaveBeenCalledTimes(1);
      finishAction("ok");
      await vi.advanceTimersByTimeAsync(0);

      await expect(result).resolves.toBe("ok");
      expect(renew).toHaveBeenCalledTimes(2);
      await expect(repositories.operationLocks.get("assessment:classicquiz_quiz-1")).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed instead of reporting success when final lock ownership cannot be renewed", async () => {
    const repositories = createInMemoryRepositories();
    vi.spyOn(repositories.operationLocks, "renew").mockResolvedValue(false);
    const service = new AssessmentService(
      { value: repositories } as RepositoryProvider,
      {
        getQuizzesForCourse: vi.fn().mockResolvedValue([]),
        getNewQuizAssignments: vi.fn().mockResolvedValue([])
      } as unknown as CanvasApiService
    );

    await expect(service.withAssessmentLock("quiz-1", async () => "unsafe-success")).rejects.toBeInstanceOf(
      AssessmentOperationLockLostError
    );
  });

  it("does not release a replacement owner's lock after a background renewal loses ownership", async () => {
    vi.useFakeTimers();
    try {
      const repositories = createInMemoryRepositories();
      vi.spyOn(repositories.operationLocks, "renew").mockImplementation(async (lockId) => {
        await repositories.operationLocks.save(lockId, {
          ownerId: "replacement-owner",
          expiresAt: new Date(Date.now() + 60_000)
        });
        return false;
      });
      const service = new AssessmentService(
        { value: repositories } as RepositoryProvider,
        {
          getQuizzesForCourse: vi.fn().mockResolvedValue([]),
          getNewQuizAssignments: vi.fn().mockResolvedValue([])
        } as unknown as CanvasApiService
      );
      let finishAction!: (value: string) => void;
      let resolveStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      const result = service.withAssessmentLock(
        "quiz-1",
        () =>
          new Promise<string>((resolveAction) => {
            finishAction = resolveAction;
            resolveStarted();
          })
      );
      const rejected = expect(result).rejects.toBeInstanceOf(AssessmentOperationLockLostError);
      await started;

      await vi.advanceTimersByTimeAsync(10_000);
      finishAction("unsafe-success");
      await vi.advanceTimersByTimeAsync(0);

      await rejected;
      await expect(repositories.operationLocks.get("assessment:classicquiz_quiz-1")).resolves.toMatchObject({
        ownerId: "replacement-owner"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables every discovered Classic Quiz and New Quiz before deleting course state", async () => {
    const repositories = createInMemoryRepositories();
    const events: string[] = [];
    const resetCourseState = vi.fn().mockImplementation(async () => {
      events.push("delete-local-state");
      return { assessmentCount: 2, transientStateCount: 1, courseRecordCount: 1 };
    });
    const provider = { value: repositories, resetCourseState } as unknown as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([
        {
          id: "501",
          canvasQuizId: "501",
          courseId: "101",
          title: "Algebra quiz",
          contentType: "CLASSIC_QUIZ",
          published: true
        }
      ]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([
        {
          id: "newquiz:101:601",
          courseId: "101",
          canvasId: "601",
          assignmentId: "601",
          contentType: "NEW_QUIZ",
          title: "Biology quiz",
          published: true
        }
      ]),
      removeQuizAccessCode: vi.fn().mockImplementation(async () => events.push("disable-classic")),
      removeNewQuizAccessCode: vi.fn().mockImplementation(async () => events.push("disable-new"))
    } as unknown as CanvasApiService;
    const service = new AssessmentService(provider, canvas);

    await expect(service.resetCourseForAdmin("101", "42", "7")).resolves.toMatchObject({
      disabledAssessmentCount: 2,
      deletedAssessmentCount: 2
    });
    expect(events).toEqual(["disable-classic", "disable-new", "delete-local-state"]);
    expect(canvas.removeQuizAccessCode).toHaveBeenCalledWith("101", "501", "42", "account_admin");
    expect(canvas.removeNewQuizAccessCode).toHaveBeenCalledWith("101", "601", "42", "account_admin");
    expect(resetCourseState).toHaveBeenCalledWith("101", "7:101");
  });

  it("keeps local course records when Canvas cannot disable every assessment", async () => {
    const repositories = createInMemoryRepositories();
    await repositories.assessments.save(
      "classicquiz_501",
      assessmentWithQuizSebSetting(null, {
        quizId: "501",
        courseId: "101",
        sebRequired: true,
        enabled: true,
        accessCode: "OLD-CLASSIC-CODE",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    await repositories.assessments.save(
      "newquiz:101:601",
      assessmentWithContentSebSetting(null, {
        contentId: "newquiz:101:601",
        courseId: "101",
        assignmentId: "601",
        contentType: "NEW_QUIZ",
        sebRequired: true,
        enabled: true,
        accessCode: "OLD-NEW-CODE",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    const resetCourseState = vi.fn();
    const provider = { value: repositories, resetCourseState } as unknown as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([
        {
          id: "501",
          canvasQuizId: "501",
          courseId: "101",
          title: "Algebra quiz",
          contentType: "CLASSIC_QUIZ",
          published: true
        }
      ]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([
        {
          id: "newquiz:101:601",
          courseId: "101",
          canvasId: "601",
          assignmentId: "601",
          contentType: "NEW_QUIZ",
          title: "Biology quiz",
          published: true
        }
      ]),
      removeQuizAccessCode: vi.fn().mockResolvedValue(undefined),
      removeNewQuizAccessCode: vi.fn().mockRejectedValueOnce(new Error("Canvas unavailable")),
      setQuizAccessCode: vi.fn().mockResolvedValue(undefined),
      setNewQuizAccessCode: vi.fn().mockResolvedValue(undefined)
    } as unknown as CanvasApiService;
    const service = new AssessmentService(provider, canvas);

    await expect(service.resetCourseForAdmin("101", "42", "7")).rejects.toThrow("Canvas unavailable");
    expect(resetCourseState).not.toHaveBeenCalled();
    expect(canvas.setQuizAccessCode).toHaveBeenCalledWith("101", "501", "OLD-CLASSIC-CODE", "42", "account_admin");
    expect(canvas.setNewQuizAccessCode).not.toHaveBeenCalled();
    await expect(repositories.assessments.get("classicquiz_501")).resolves.toMatchObject({
      seb: { required: true, enabled: true, accessCode: "OLD-CLASSIC-CODE" }
    });
    await expect(repositories.assessments.get("newquiz:101:601")).resolves.toMatchObject({
      seb: { required: true, enabled: true, accessCode: "OLD-NEW-CODE" }
    });
  });

  it("refuses a reset before Canvas changes when an enabled assessment has no recoverable access code", async () => {
    const repositories = createInMemoryRepositories();
    await repositories.assessments.save(
      "classicquiz_501",
      assessmentWithQuizSebSetting(null, {
        quizId: "501",
        courseId: "101",
        sebRequired: true,
        enabled: true,
        accessCode: null,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([
        {
          id: "501",
          canvasQuizId: "501",
          courseId: "101",
          title: "Algebra quiz",
          contentType: "CLASSIC_QUIZ",
          published: true
        }
      ]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([]),
      removeQuizAccessCode: vi.fn()
    } as unknown as CanvasApiService;
    const provider = { value: repositories, resetCourseState: vi.fn() } as unknown as RepositoryProvider;
    const service = new AssessmentService(provider, canvas);

    await expect(service.resetCourseForAdmin("101", "42", "7")).rejects.toBeInstanceOf(
      AssessmentAccessCodeConsistencyError
    );
    expect(canvas.removeQuizAccessCode).not.toHaveBeenCalled();
    expect(provider.resetCourseState).not.toHaveBeenCalled();
  });

  it("restores Canvas and local assessment state when final course deletion fails", async () => {
    const repositories = createInMemoryRepositories();
    await repositories.assessments.save(
      "classicquiz_501",
      assessmentWithQuizSebSetting(null, {
        quizId: "501",
        courseId: "101",
        sebRequired: true,
        enabled: true,
        accessCode: "OLD-CLASSIC-CODE",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    const resetCourseState = vi.fn().mockRejectedValue(new Error("Database unavailable"));
    const provider = { value: repositories, resetCourseState } as unknown as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([
        {
          id: "501",
          canvasQuizId: "501",
          courseId: "101",
          title: "Algebra quiz",
          contentType: "CLASSIC_QUIZ",
          published: true
        }
      ]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([]),
      removeQuizAccessCode: vi.fn().mockResolvedValue(undefined),
      setQuizAccessCode: vi.fn().mockResolvedValue(undefined)
    } as unknown as CanvasApiService;
    const service = new AssessmentService(provider, canvas);

    await expect(service.resetCourseForAdmin("101", "42", "7")).rejects.toThrow("Database unavailable");
    expect(canvas.setQuizAccessCode).toHaveBeenCalledWith("101", "501", "OLD-CLASSIC-CODE", "42", "account_admin");
    await expect(repositories.assessments.get("classicquiz_501")).resolves.toMatchObject({
      seb: { required: true, enabled: true, accessCode: "OLD-CLASSIC-CODE" }
    });
  });

  it("fails closed when a stopped course reset cannot restore Canvas state", async () => {
    const repositories = createInMemoryRepositories();
    await repositories.assessments.save(
      "classicquiz_501",
      assessmentWithQuizSebSetting(null, {
        quizId: "501",
        courseId: "101",
        sebRequired: true,
        enabled: true,
        accessCode: "OLD-CLASSIC-CODE",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    const provider = {
      value: repositories,
      resetCourseState: vi.fn().mockRejectedValue(new Error("Database unavailable"))
    } as unknown as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([
        {
          id: "501",
          canvasQuizId: "501",
          courseId: "101",
          title: "Algebra quiz",
          contentType: "CLASSIC_QUIZ",
          published: true
        }
      ]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([]),
      removeQuizAccessCode: vi.fn().mockResolvedValue(undefined),
      setQuizAccessCode: vi.fn().mockRejectedValue(new Error("Canvas rollback unavailable"))
    } as unknown as CanvasApiService;
    const service = new AssessmentService(provider, canvas);

    await expect(service.resetCourseForAdmin("101", "42", "7")).rejects.toBeInstanceOf(CourseResetCompensationError);
    await expect(repositories.assessments.get("classicquiz_501")).resolves.toMatchObject({
      seb: { required: true, enabled: true, accessCode: "OLD-CLASSIC-CODE" }
    });
  });

  it("keeps local course records when New Quiz discovery is incomplete", async () => {
    const repositories = createInMemoryRepositories();
    const resetCourseState = vi.fn();
    const provider = { value: repositories, resetCourseState } as unknown as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockRejectedValue(new Error("New Quiz discovery unavailable")),
      removeQuizAccessCode: vi.fn(),
      removeNewQuizAccessCode: vi.fn()
    } as unknown as CanvasApiService;
    const service = new AssessmentService(provider, canvas);

    await expect(service.resetCourseForAdmin("101", "42", "7")).rejects.toThrow("New Quiz discovery unavailable");
    expect(resetCourseState).not.toHaveBeenCalled();
    expect(canvas.removeQuizAccessCode).not.toHaveBeenCalled();
    expect(canvas.removeNewQuizAccessCode).not.toHaveBeenCalled();
  });

  it("blocks new assessment mutations while a course reset holds its lock", async () => {
    const repositories = createInMemoryRepositories();
    let releaseDiscovery!: () => void;
    let markDiscoveryStarted!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => {
      markDiscoveryStarted = resolve;
    });
    const canvas = {
      getQuizzesForCourse: vi.fn().mockImplementation(
        () =>
          new Promise<[]>((resolve) => {
            releaseDiscovery = () => resolve([]);
            markDiscoveryStarted();
          })
      ),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const provider = {
      value: repositories,
      resetCourseState: vi.fn().mockResolvedValue({
        assessmentCount: 0,
        transientStateCount: 0,
        courseRecordCount: 0
      })
    } as unknown as RepositoryProvider;
    const service = new AssessmentService(provider, canvas);
    const reset = service.resetCourseForAdmin("101", "42", "7");
    await discoveryStarted;

    await expect(service.withAssessmentLock("unrelated", async () => "unsafe", "101")).rejects.toBeInstanceOf(
      CourseResetInProgressError
    );
    releaseDiscovery();
    await expect(reset).resolves.toMatchObject({ disabledAssessmentCount: 0 });
  });

  it("returns structured conflicts for course reset and mutation contention", () => {
    expect(new CourseResetInProgressError()).toMatchObject({
      status: 409,
      response: expect.objectContaining({ error_code: "COURSE_RESET_IN_PROGRESS" })
    });
    expect(new CourseMutationInProgressError()).toMatchObject({
      status: 409,
      response: expect.objectContaining({ error_code: "COURSE_UPDATE_IN_PROGRESS" })
    });
    expect(new CourseResetAssessmentIdentityError()).toMatchObject({
      status: 409,
      response: expect.objectContaining({ error_code: "COURSE_RESET_ASSESSMENT_IDENTITY_UNAVAILABLE" })
    });
  });

  it("does not let a course reset delete state while a refresh is writing the course", async () => {
    const repositories = createInMemoryRepositories();
    let releaseDiscovery!: () => void;
    let markDiscoveryStarted!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => {
      markDiscoveryStarted = resolve;
    });
    const canvas = {
      getQuizzesForCourse: vi.fn().mockImplementation(
        () =>
          new Promise<[]>((resolve) => {
            releaseDiscovery = () => resolve([]);
            markDiscoveryStarted();
          })
      ),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const resetCourseState = vi.fn();
    const provider = { value: repositories, resetCourseState } as unknown as RepositoryProvider;
    const service = new AssessmentService(provider, canvas);
    const refresh = service.refreshCourseContent("101", "42");
    await discoveryStarted;

    await expect(service.resetCourseForAdmin("101", "42", "7")).rejects.toBeInstanceOf(CourseMutationInProgressError);
    expect(resetCourseState).not.toHaveBeenCalled();
    releaseDiscovery();
    await expect(refresh).resolves.toMatchObject({ assessments: [] });
  });

  it("rotates Config Key salt when the exam start password changes", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new AssessmentService(repos, canvas);
    const first = await service.saveQuizSebSetting({
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: [],
      startPassword: "unique-start-one"
    });

    const second = await service.saveQuizSebSetting({
      ...first,
      configKey: "stored-config-key",
      startPassword: "unique-start-two"
    });

    expect(Buffer.from(first.configKeySalt || "", "base64")).toHaveLength(32);
    expect(Buffer.from(second.configKeySalt || "", "base64")).toHaveLength(32);
    expect(second.configKeySalt).not.toBe(first.configKeySalt);
    expect(second.configKey).toBeNull();
  });
});
