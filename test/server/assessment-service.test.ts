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
