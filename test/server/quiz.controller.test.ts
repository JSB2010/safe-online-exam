import { HttpException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuizController } from "../../src/server/controllers/quiz.controller.js";
import { createActionToken } from "../../src/server/http/action-token.js";
import { defaultCourseSebDefaults } from "../../src/shared/models.js";

const SESSION_SECRET = "test-session-secret";
const COURSE_ID = "course-1";
const USER_ID = "user-1";

describe("QuizController", () => {
  let assessments: Record<string, ReturnType<typeof vi.fn>>;
  let canvasApi: Record<string, ReturnType<typeof vi.fn>>;
  let courseSettings: Record<string, ReturnType<typeof vi.fn>>;
  let controller: QuizController;

  beforeEach(() => {
    assessments = {
      refreshCourseContent: vi.fn(),
      enableSebWithAccessCode: vi.fn(),
      disableSebWithAccessCode: vi.fn(),
      updateSebConfigurationStructured: vi.fn(),
      getQuizzesForCourse: vi.fn(),
      getSebSettingForQuiz: vi.fn(),
      getContentSebSetting: vi.fn(),
      saveQuizSebSetting: vi.fn(),
      saveContentSebSetting: vi.fn(),
      getQuiz: vi.fn(),
      getOrCreateContentSebSetting: vi.fn(),
      validateSebConfiguration: vi.fn()
    };
    canvasApi = {
      setQuizAccessCode: vi.fn(),
      removeQuizAccessCode: vi.fn(),
      setNewQuizAccessCode: vi.fn(),
      removeNewQuizAccessCode: vi.fn()
    };
    courseSettings = {
      getDefaults: vi.fn().mockResolvedValue(defaultCourseSebDefaults(COURSE_ID)),
      saveDefaults: vi.fn(),
      resetQuizToDefaults: vi.fn()
    };
    controller = new QuizController(configDouble(), assessments as any, canvasApi as any, courseSettings as any);
  });

  it("saves course defaults only when the action token matches the requested course", async () => {
    courseSettings.saveDefaults.mockImplementation(async (_courseId, defaults) => ({
      ...defaultCourseSebDefaults(COURSE_ID),
      ...defaults
    }));

    const result = await controller.saveCourseDefaults(requestWithActionToken(USER_ID, COURSE_ID), COURSE_ID, {
      quitPassword: " exit-pass ",
      startPassword: " start-pass ",
      setupCompleted: true,
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu/path" }],
      externalTools: [{ id: "Calc", label: "Calculator", url: "calc.example.edu", enabled: true }]
    });

    expect(result).toMatchObject({ success: true });
    expect(courseSettings.saveDefaults).toHaveBeenCalledWith(
      COURSE_ID,
      expect.objectContaining({
        courseId: COURSE_ID,
        quitPassword: "exit-pass",
        startPassword: "start-pass",
        setupCompleted: true,
        urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
        externalTools: [
          expect.objectContaining({
            id: "calc",
            label: "Calculator",
            url: "https://calc.example.edu/",
            enabled: true
          })
        ]
      })
    );

    await expectHttpError(
      () => controller.saveCourseDefaults(requestWithActionToken(USER_ID, "other-course"), COURSE_ID, {}),
      401
    );
  });

  it("refreshes course content and returns Canvas authorization guidance when needed", async () => {
    assessments.refreshCourseContent.mockResolvedValue({
      classicQuizzes: [{ id: "quiz-1", title: "Quiz 1", canvasQuizId: "quiz-1" }]
    });

    await expect(controller.refresh(requestWithSession(), COURSE_ID)).resolves.toEqual({
      success: true,
      message: "Quiz data refreshed successfully",
      quizCount: 1,
      quizzes: [{ id: "quiz-1", title: "Quiz 1", canvasQuizId: "quiz-1" }]
    });

    await expectHttpError(() => controller.refresh({ session: {}, header: () => undefined } as any, COURSE_ID), 401);
  });

  it("reads course defaults only for authorized course sessions", async () => {
    courseSettings.getDefaults.mockResolvedValue({ ...defaultCourseSebDefaults(COURSE_ID), setupCompleted: true });

    await expect(controller.getCourseDefaults(requestWithSession(), COURSE_ID)).resolves.toMatchObject({
      success: true,
      defaults: { setupCompleted: true }
    });
    await expectHttpError(() => controller.getCourseDefaults(requestWithSession(), "other-course"), 401);
  });

  it("enables New Quiz SEB with a Canvas access code and inherited course defaults", async () => {
    const existing = newQuizSetting({ sebRequired: false, enabled: false, accessCode: null, configKey: "stale" });
    assessments.getOrCreateContentSebSetting.mockResolvedValue(existing);
    assessments.saveContentSebSetting.mockImplementation(async (setting) => setting);
    canvasApi.setNewQuizAccessCode.mockResolvedValue(true);
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      setupCompleted: true,
      startPassword: "course-start",
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }]
    });

    const result = await controller.enable(requestWithSession(), COURSE_ID, "newquiz:course-1:assignment-99");

    expect(result).toMatchObject({
      success: true,
      message: "SEB enabled successfully with access code enforcement"
    });
    expect(canvasApi.setNewQuizAccessCode).toHaveBeenCalledWith(
      COURSE_ID,
      "assignment-99",
      expect.stringMatching(/^[A-Z0-9]{16}$/u),
      USER_ID
    );
    expect(assessments.saveContentSebSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: "newquiz:course-1:assignment-99",
        sebRequired: true,
        enabled: true,
        accessCode: expect.stringMatching(/^[A-Z0-9]{16}$/u),
        configKey: null,
        startPassword: "course-start",
        customDomains: ["domain:docs.example.edu"],
        usesCourseDefaults: true
      })
    );
  });

  it("disables New Quiz SEB without calling Canvas when no access code is stored", async () => {
    assessments.getOrCreateContentSebSetting.mockResolvedValue(
      newQuizSetting({ sebRequired: true, enabled: true, accessCode: null, configKey: "stored" })
    );
    assessments.saveContentSebSetting.mockImplementation(async (setting) => setting);

    const result = await controller.disable(requestWithSession(), COURSE_ID, "newquiz:course-1:assignment-99");

    expect(result).toMatchObject({ success: true, message: "SEB disabled successfully" });
    expect(canvasApi.removeNewQuizAccessCode).not.toHaveBeenCalled();
    expect(assessments.saveContentSebSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        sebRequired: false,
        enabled: false,
        accessCode: null,
        configKey: null
      })
    );
  });

  it("regenerates Classic Quiz access codes and invalidates stored Config Keys", async () => {
    assessments.getSebSettingForQuiz.mockResolvedValue({
      quizId: "quiz-1",
      courseId: COURSE_ID,
      sebRequired: true,
      enabled: true,
      accessCode: "OLD-CODE",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });
    assessments.saveQuizSebSetting.mockImplementation(async (setting) => setting);
    canvasApi.setQuizAccessCode.mockResolvedValue(true);

    const result = await controller.regenerate(requestWithSession(), COURSE_ID, "quiz-1");

    expect(result).toMatchObject({
      success: true,
      message: "SEB access code regenerated. Students must download a fresh configuration file."
    });
    expect(canvasApi.setQuizAccessCode).toHaveBeenCalledWith(
      COURSE_ID,
      "quiz-1",
      expect.stringMatching(/^[A-Z0-9]{16}$/u),
      USER_ID
    );
    expect(assessments.saveQuizSebSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        accessCode: expect.stringMatching(/^[A-Z0-9]{16}$/u),
        configKey: null
      })
    );
  });

  it("resets quiz settings to course defaults and redirects config downloads", async () => {
    courseSettings.resetQuizToDefaults.mockResolvedValue({
      quizId: "quiz-1",
      courseId: COURSE_ID,
      usesCourseDefaults: true
    });

    await expect(controller.resetDefaults(requestWithSession(), COURSE_ID, "quiz-1")).resolves.toEqual({
      success: true,
      setting: { quizId: "quiz-1", courseId: COURSE_ID, usesCourseDefaults: true }
    });

    courseSettings.resetQuizToDefaults.mockResolvedValueOnce(null);
    await expectHttpError(() => controller.resetDefaults(requestWithSession(), COURSE_ID, "missing"), 404);

    const response = { redirect: vi.fn() } as any;
    controller.redirectConfig(response, COURSE_ID, "quiz-1");
    expect(response.redirect).toHaveBeenCalledWith(302, "/seb/config/course-1/quiz-1.seb");
  });

  it("reports normalized New Quiz status for authenticated requests", async () => {
    assessments.getContentSebSetting.mockResolvedValue(
      newQuizSetting({
        sebRequired: true,
        enabled: true,
        accessCode: "ACCESS",
        externalTools: [{ id: "Calc", label: "Calculator", url: "calc.example.edu", enabled: true }]
      })
    );

    const result = await controller.status(requestWithSession(), "newquiz:course-1:assignment-99");

    expect(result).toMatchObject({
      authenticated: true,
      canvasDomain: "canvas.example.edu",
      sebEnabled: true,
      hasAccessCode: true,
      configValid: true,
      externalTools: [
        expect.objectContaining({
          id: "calc",
          url: "https://calc.example.edu/",
          enabled: true
        })
      ]
    });
  });

  it("returns quiz lists, settings, and individual quiz records from the assessment service", async () => {
    assessments.getQuizzesForCourse.mockResolvedValue([{ id: "quiz-1", title: "Quiz 1" }]);
    assessments.getSebSettingForQuiz.mockResolvedValue({ quizId: "quiz-1", sebRequired: true });
    assessments.getQuiz.mockResolvedValue({ id: "quiz-1", title: "Quiz 1" });

    await expect(controller.getQuizzes(requestWithSession())).resolves.toEqual([{ id: "quiz-1", title: "Quiz 1" }]);
    await expect(controller.getSettings(requestWithSession())).resolves.toEqual({
      "quiz-1": { quizId: "quiz-1", sebRequired: true }
    });
    await expect(controller.getQuiz("quiz-1")).resolves.toEqual({ id: "quiz-1", title: "Quiz 1" });
    await expectHttpError(() => controller.getQuizzes({ session: {}, header: () => undefined } as any), 403);
  });

  it("reports unauthenticated SEB status without touching settings", async () => {
    await expect(controller.status({ session: {}, header: () => undefined } as any, "quiz-1")).resolves.toEqual({
      authenticated: false
    });
    expect(assessments.getSebSettingForQuiz).not.toHaveBeenCalled();
  });

  it("rejects structured saves with mismatched query users or missing content ids", async () => {
    await expectHttpError(
      () => controller.saveStructured(requestWithSession(), { quizId: "quiz-1" }, "other-user"),
      403
    );
    await expectHttpError(() => controller.saveStructured(requestWithSession(), {}, USER_ID), 400);
  });
});

function configDouble() {
  return {
    getCanvasDomain: () => "https://canvas.example.edu",
    value: {
      security: { sessionSecret: SESSION_SECRET }
    }
  };
}

function requestWithSession(): any {
  return {
    session: {
      launchData: {
        userId: USER_ID,
        courseId: COURSE_ID,
        roles: []
      }
    },
    header: () => undefined
  };
}

function requestWithActionToken(userId: string, courseId: string): any {
  const token = createActionToken(configDouble() as any, userId, courseId);
  return {
    session: {},
    header: (name: string) => (name.toLowerCase() === "x-auth-token" ? token : undefined)
  };
}

function newQuizSetting(overrides: Record<string, unknown> = {}) {
  return {
    contentId: "newquiz:course-1:assignment-99",
    courseId: COURSE_ID,
    assignmentId: "assignment-99",
    canvasId: "assignment-99",
    contentType: "NEW_QUIZ",
    htmlUrl: "https://canvas.example.edu/courses/course-1/assignments/assignment-99",
    sebRequired: false,
    enabled: false,
    accessCode: null,
    configKey: null,
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    urlRules: [],
    externalTools: [],
    ...overrides
  };
}

async function expectHttpError(run: () => Promise<unknown>, status: number): Promise<void> {
  try {
    await run();
    throw new Error("Expected HTTP error");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
  }
}
