import { describe, expect, it, vi } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CanvasApiService } from "../../src/server/services/canvas-api.service.js";
import { QuizService } from "../../src/server/services/quiz.service.js";

describe("QuizService", () => {
  it("enables and disables SEB with Canvas access codes", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      removeQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new QuizService(repos, canvas);

    const enabled = await service.enableSebWithAccessCode("course-1", "quiz-1", "user-1");
    expect(enabled.sebRequired).toBe(true);
    expect(enabled.accessCode).toMatch(/^[A-Z0-9]{16}$/u);
    expect(canvas.setQuizAccessCode).toHaveBeenCalled();

    const disabled = await service.disableSebWithAccessCode("course-1", "quiz-1", "user-1");
    expect(disabled.sebRequired).toBe(false);
    expect(disabled.accessCode).toBeNull();
    expect(canvas.removeQuizAccessCode).toHaveBeenCalled();
  });

  it("applies course defaults when SEB is enabled for a new quiz setting", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new QuizService(repos, canvas);

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

  it("invalidates stored Config Keys when SEB-affecting quiz settings change", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new QuizService(repos, canvas);
    await service.saveSebSetting({
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

    const saved = await service.saveSebSetting({
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

    expect(saved.configKey).toBeNull();
  });

  it("rotates Config Key salt when the exam start password changes", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new QuizService(repos, canvas);
    const first = await service.saveSebSetting({
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

    const second = await service.saveSebSetting({
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
