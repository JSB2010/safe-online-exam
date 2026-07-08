import { describe, expect, it, vi } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { AssessmentService } from "../../src/server/services/assessment.service.js";
import { CanvasApiService } from "../../src/server/services/canvas-api.service.js";

describe("AssessmentService", () => {
  it("refreshes Classic Quiz and New Quiz content into unified assessment records", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getCanvasDomain: () => "https://canvas.example.edu",
      getQuizzesForCourse: vi.fn().mockResolvedValue([{ id: "42", title: "Classic Quiz", courseId: "course-7" }]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([
        {
          id: "newquiz:course-7:99",
          courseId: "course-7",
          canvasId: "99",
          assignmentId: "99",
          contentType: "NEW_QUIZ",
          title: "New Quiz"
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
      canvas: { quizId: "42", title: "Classic Quiz" }
    });
    await expect(service.getQuiz("42")).resolves.toMatchObject({ id: "42", title: "Classic Quiz" });
    await expect(service.getContentSebSetting("newquiz:course-7:99")).resolves.toMatchObject({
      contentId: "newquiz:course-7:99",
      contentType: "NEW_QUIZ"
    });
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
    expect(enabled.externalTools).toEqual([
      {
        id: "calc",
        label: "Calculator",
        url: "https://calc.example.edu/",
        enabled: true,
        preset: null,
        allowedDomains: []
      }
    ]);
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
      startPassword: "start",
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
      startPassword: "start",
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

    await expect(service.withAssessmentLock("quiz-1", async () => "ok")).rejects.toThrow(
      "Another SEB update is already in progress"
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
      startPassword: "start-one"
    });

    const second = await service.saveQuizSebSetting({
      ...first,
      configKey: "stored-config-key",
      startPassword: "start-two"
    });

    expect(Buffer.from(first.configKeySalt || "", "base64")).toHaveLength(32);
    expect(Buffer.from(second.configKeySalt || "", "base64")).toHaveLength(32);
    expect(second.configKeySalt).not.toBe(first.configKeySalt);
    expect(second.configKey).toBeNull();
  });
});
