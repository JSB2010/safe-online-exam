import { HttpException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuizController } from "../../src/server/controllers/quiz.controller.js";
import { createActionToken } from "../../src/server/http/action-token.js";
import { AssessmentAuthorizationService } from "../../src/server/services/assessment-authorization.service.js";
import {
  CourseMutationInProgressError,
  CourseResetInProgressError
} from "../../src/server/services/assessment.service.js";
import { defaultCourseSebDefaults } from "../../src/shared/models.js";

const SESSION_SECRET = "test-session-secret";
const COURSE_ID = "course-1";
const USER_ID = "user-1";
const SUBJECT = "lti-subject-1";
const DEPLOYMENT_ID = "deployment-1";
const SESSION_ID = "session-1";
const INSTRUCTOR_ROLE = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
const LEARNER_ROLE = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

describe("QuizController", () => {
  let assessments: Record<string, ReturnType<typeof vi.fn>>;
  let courseSettings: Record<string, ReturnType<typeof vi.fn>>;
  let canvasApi: Record<string, ReturnType<typeof vi.fn>>;
  let controller: QuizController;

  beforeEach(() => {
    assessments = {
      refreshCourseContent: vi.fn(),
      enableSebWithAccessCode: vi.fn(),
      disableSebWithAccessCode: vi.fn(),
      enableContentSebWithAccessCode: vi.fn(),
      disableContentSebWithAccessCode: vi.fn(),
      regenerateQuizAccessCode: vi.fn(),
      regenerateContentAccessCode: vi.fn(),
      updateSebConfigurationStructured: vi.fn(),
      getQuizzesForCourse: vi.fn(),
      getSebSettingForQuiz: vi.fn(),
      getContentSebSetting: vi.fn(),
      saveQuizSebSetting: vi.fn(),
      saveContentSebSetting: vi.fn(),
      getQuiz: vi.fn(),
      getAssessmentRecord: vi.fn(async (id: string) => assessmentById(id)),
      validateSebConfiguration: vi.fn()
    };
    assessments.withAssessmentLock = vi.fn(async (_contentId, action) => action());
    courseSettings = {
      getDefaults: vi.fn().mockResolvedValue(defaultCourseSebDefaults(COURSE_ID)),
      saveDefaults: vi.fn(),
      resetQuizToDefaults: vi.fn(),
      copyInstructorToolToCourse: vi.fn()
    };
    canvasApi = { getInstructorCourses: vi.fn() };
    const authorization = new AssessmentAuthorizationService(configDouble() as any, assessments as any);
    controller = new QuizController(
      configDouble() as any,
      assessments as any,
      courseSettings as any,
      authorization,
      canvasApi as any
    );
  });

  it("saves course defaults only for a verified instructor with a session-bound token", async () => {
    courseSettings.saveDefaults.mockImplementation(async (_courseId, defaults) => ({
      ...defaultCourseSebDefaults(COURSE_ID),
      ...defaults
    }));

    const result = await controller.saveCourseDefaults(mutationRequest(), COURSE_ID, {
      quitPassword: " exit-passphrase ",
      startPassword: " start-passphrase ",
      setupCompleted: true,
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: [{ id: "Calc", label: "Calculator", url: "https://calc.example.edu", enabled: true }]
    });

    expect(result).toMatchObject({
      success: true,
      defaults: {
        courseId: COURSE_ID,
        setupCompleted: true,
        hasQuitPassword: true,
        hasEffectiveQuitPassword: true,
        hasStartPassword: true
      }
    });
    expect(JSON.stringify(result)).not.toContain("exit-pass");
    expect(JSON.stringify(result)).not.toContain("start-pass");
    expect(JSON.stringify(result)).not.toContain("managed-server-exit");
    expect(courseSettings.saveDefaults).toHaveBeenCalledWith(
      COURSE_ID,
      expect.objectContaining({
        courseId: COURSE_ID,
        quitPassword: "exit-passphrase",
        startPassword: "start-passphrase",
        setupCompleted: true,
        urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
        externalTools: expect.arrayContaining([
          expect.objectContaining({
            id: "calc",
            label: "Calculator",
            url: "https://calc.example.edu/",
            enabled: true
          })
        ])
      })
    );

    await expectHttpError(
      () => controller.saveCourseDefaults(mutationRequest({ courseId: "other-course" }), COURSE_ID, {}),
      403
    );
  });

  it("converts an instructor's YouTube video link into the bounded video tool", async () => {
    courseSettings.saveDefaults.mockImplementation(async (_courseId, defaults) => ({
      ...defaultCourseSebDefaults(COURSE_ID),
      ...defaults
    }));

    await expect(
      controller.saveCourseDefaults(mutationRequest(), COURSE_ID, {
        setupCompleted: true,
        externalTools: [
          {
            id: "youtube",
            label: "YouTube video",
            url: "https://www.youtube.com/watch?v=qZ7OjpjGVGs",
            enabled: true
          }
        ]
      })
    ).resolves.toMatchObject({ success: true });

    expect(courseSettings.saveDefaults).toHaveBeenCalledWith(
      COURSE_ID,
      expect.objectContaining({
        externalTools: [
          expect.objectContaining({
            id: "youtube",
            url: "https://www.youtube.com/embed/qZ7OjpjGVGs?rel=0",
            preset: "youtube-video",
            allowedRules: []
          })
        ]
      })
    );
  });

  it("preserves write-only course secrets when the client omits masked fields", async () => {
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      quitPassword: "existing-quit",
      startPassword: "existing-start"
    });
    courseSettings.saveDefaults.mockImplementation(async (_courseId, defaults) => defaults);

    const result = await controller.saveCourseDefaults(mutationRequest(), COURSE_ID, {
      setupCompleted: true,
      urlRules: [],
      externalTools: []
    });

    expect(courseSettings.saveDefaults).toHaveBeenCalledWith(
      COURSE_ID,
      expect.objectContaining({ quitPassword: "existing-quit", startPassword: "existing-start" })
    );
    expect(result).toMatchObject({
      defaults: { hasQuitPassword: true, hasStartPassword: true }
    });
    expect(JSON.stringify(result)).not.toContain("existing-quit");
    expect(JSON.stringify(result)).not.toContain("existing-start");
  });

  it("requires an explicit confirmation before a custom tool can allow an entire domain", async () => {
    await expectHttpError(
      () =>
        controller.saveCourseDefaults(mutationRequest(), COURSE_ID, {
          setupCompleted: true,
          externalTools: [
            {
              id: "reference",
              label: "Reference",
              url: "https://reference.example.edu/exam",
              enabled: false,
              allowedRules: [{ id: "broad", match: "domain", value: "reference.example.edu" }]
            }
          ]
        }),
      400
    );
    expect(courseSettings.saveDefaults).not.toHaveBeenCalled();

    await expectHttpError(
      () =>
        controller.saveCourseDefaults(mutationRequest(), COURSE_ID, {
          setupCompleted: true,
          externalTools: [
            {
              id: "legacy-bypass",
              label: "Legacy bypass",
              url: "https://reference.example.edu/exam",
              enabled: false,
              allowedRules: [],
              allowedDomains: ["domain:reference.example.edu"]
            }
          ]
        }),
      400
    );
    expect(courseSettings.saveDefaults).not.toHaveBeenCalled();

    await expectHttpError(
      () =>
        controller.saveCourseDefaults(mutationRequest(), COURSE_ID, {
          setupCompleted: true,
          externalTools: [
            { id: "missing-scheme", label: "Missing scheme", url: "reference.example.edu", enabled: false }
          ]
        }),
      400
    );
    expect(courseSettings.saveDefaults).not.toHaveBeenCalled();
  });

  it("refreshes course content for the verified Canvas user", async () => {
    assessments.refreshCourseContent.mockResolvedValue({
      classicQuizzes: [{ id: "quiz-1", title: "Quiz 1", canvasQuizId: "quiz-1" }]
    });

    await expect(controller.refresh(mutationRequest(), COURSE_ID)).resolves.toEqual({
      success: true,
      message: "Quiz data refreshed successfully",
      quizCount: 1,
      quizzes: [{ id: "quiz-1", title: "Quiz 1", canvasQuizId: "quiz-1" }]
    });
    expect(assessments.refreshCourseContent).toHaveBeenCalledWith(COURSE_ID, USER_ID);
  });

  it("returns secret-free course defaults only to the course instructor", async () => {
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      setupCompleted: true,
      quitPassword: "unique-quit-secret",
      startPassword: "unique-start-secret"
    });

    const result = await controller.getCourseDefaults(readRequest(), COURSE_ID);
    expect(result).toMatchObject({
      success: true,
      defaults: {
        setupCompleted: true,
        hasQuitPassword: true,
        hasEffectiveQuitPassword: true,
        hasStartPassword: true
      }
    });
    expect(JSON.stringify(result)).not.toContain("quit-secret");
    expect(JSON.stringify(result)).not.toContain("start-secret");
    await expectHttpError(() => controller.getCourseDefaults(readRequest(), "other-course"), 403);
  });

  it("lists only other live Canvas teacher courses as exam-tool copy targets", async () => {
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      externalTools: [copyableTool()]
    });
    canvasApi.getInstructorCourses.mockResolvedValue([
      { id: COURSE_ID, name: "Current course", courseCode: "CUR-1" },
      { id: "course-2", name: "Biology", courseCode: "BIO-2" }
    ]);

    await expect(controller.getCourseToolCopyTargets(readRequest(), COURSE_ID, "formula-sheet")).resolves.toEqual({
      success: true,
      courses: [{ courseId: "course-2", name: "Biology", courseCode: "BIO-2" }]
    });
    expect(canvasApi.getInstructorCourses).toHaveBeenCalledWith(USER_ID);
  });

  it("rechecks Canvas teacher authorization before copying an instructor-owned tool", async () => {
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      externalTools: [copyableTool()]
    });
    canvasApi.getInstructorCourses.mockResolvedValue([{ id: "course-2", name: "Biology", courseCode: "BIO-2" }]);
    courseSettings.copyInstructorToolToCourse.mockResolvedValueOnce({ status: "copied", toolId: "formula-sheet" });

    await expect(
      controller.copyCourseTool(mutationRequest(), COURSE_ID, "formula-sheet", { courseIds: ["course-2"] })
    ).resolves.toEqual({
      success: true,
      copied: [{ courseId: "course-2", name: "Biology", courseCode: "BIO-2", status: "copied" }],
      alreadyPresent: [],
      failed: []
    });
    expect(courseSettings.copyInstructorToolToCourse).toHaveBeenCalledWith(
      "course-2",
      expect.objectContaining({ id: "formula-sheet" })
    );

    canvasApi.getInstructorCourses.mockResolvedValue([]);
    await expectHttpError(
      () => controller.copyCourseTool(mutationRequest(), COURSE_ID, "formula-sheet", { courseIds: ["course-2"] }),
      403
    );
    expect(courseSettings.copyInstructorToolToCourse).toHaveBeenCalledTimes(1);
  });

  it("preserves course reset and mutation conflicts for each tool-copy destination", async () => {
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      externalTools: [copyableTool()]
    });
    canvasApi.getInstructorCourses.mockResolvedValue([
      { id: "course-2", name: "Biology", courseCode: "BIO-2" },
      { id: "course-3", name: "Chemistry", courseCode: "CHEM-3" }
    ]);
    courseSettings.copyInstructorToolToCourse
      .mockRejectedValueOnce(new CourseResetInProgressError())
      .mockRejectedValueOnce(new CourseMutationInProgressError());

    await expect(
      controller.copyCourseTool(mutationRequest(), COURSE_ID, "formula-sheet", {
        courseIds: ["course-2", "course-3"]
      })
    ).resolves.toMatchObject({
      success: false,
      failed: [
        { courseId: "course-2", errorCode: "COURSE_RESET_IN_PROGRESS" },
        { courseId: "course-3", errorCode: "COURSE_UPDATE_IN_PROGRESS" }
      ]
    });
  });

  it("does not expose copying for a school-managed course tool", async () => {
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      externalTools: [{ ...copyableTool(), managedByAdmin: true, adminPresetId: "school-preset" }]
    });

    await expectHttpError(() => controller.getCourseToolCopyTargets(readRequest(), COURSE_ID, "formula-sheet"), 409);
    expect(canvasApi.getInstructorCourses).not.toHaveBeenCalled();
  });

  it("reveals saved course passwords only through an instructor-authorized no-store POST", async () => {
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      startPassword: "blueheron",
      quitPassword: "80419372"
    });
    const response = { setHeader: vi.fn() } as any;

    await expect(controller.revealCoursePasswords(mutationRequest(), response, COURSE_ID)).resolves.toEqual({
      success: true,
      expiresInSeconds: 30,
      passwords: {
        start: { value: "blueheron", source: "course" },
        exit: { value: "80419372", source: "course" }
      }
    });
    expect(response.setHeader).toHaveBeenCalledWith("cache-control", "private, no-store, max-age=0");
    expect(response.setHeader).toHaveBeenCalledWith("referrer-policy", "no-referrer");
    await expectHttpError(() => controller.revealCoursePasswords(readRequest(), response, COURSE_ID), 403);
  });

  it("reveals assessment values without exposing the managed server exit password", async () => {
    assessments.getAssessmentRecord.mockResolvedValue(
      classicAssessment({
        seb: {
          ...assessmentSebState(),
          startPassword: "quizstart",
          startPasswordOverride: true,
          quitPassword: null
        }
      })
    );
    const response = { setHeader: vi.fn() } as any;

    await expect(
      controller.revealAssessmentPasswords(mutationRequest(), response, COURSE_ID, "quiz-1")
    ).resolves.toEqual({
      success: true,
      expiresInSeconds: 30,
      passwords: {
        start: { value: "quizstart", source: "assessment" },
        exit: { value: null, source: "managed" }
      }
    });
    expect(JSON.stringify(response.setHeader.mock.calls)).not.toContain("managed-server-exit");
  });

  it("enables New Quiz SEB when the route exactly matches the stored assessment", async () => {
    const existing = newQuizSetting({
      sebRequired: false,
      enabled: false,
      accessCode: null,
      configKey: "stale-config-key"
    });
    assessments.enableContentSebWithAccessCode.mockResolvedValue({
      ...existing,
      sebRequired: true,
      enabled: true,
      accessCode: "GENERATED-CODE",
      configKey: null,
      startPassword: "course-start-secret",
      customDomains: ["domain:docs.example.edu"],
      usesCourseDefaults: true
    });
    courseSettings.getDefaults.mockResolvedValue({
      ...defaultCourseSebDefaults(COURSE_ID),
      setupCompleted: true,
      startPassword: "course-start-secret",
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }]
    });

    const result = await controller.enable(mutationRequest(), COURSE_ID, "newquiz:course-1:assignment-99");

    expect(result).toMatchObject({
      success: true,
      message: "Safe Online Exam enabled.",
      setting: {
        contentId: "newquiz:course-1:assignment-99",
        hasAccessCode: true,
        hasConfigKey: false,
        hasEffectiveQuitPassword: true,
        hasStartPassword: true
      }
    });
    expect(JSON.stringify(result)).not.toContain("course-start-secret");
    expect(JSON.stringify(result)).not.toContain("managed-server-exit");
    expect(assessments.enableContentSebWithAccessCode).toHaveBeenCalledWith(
      COURSE_ID,
      "newquiz:course-1:assignment-99",
      "assignment-99",
      USER_ID,
      expect.objectContaining({ courseId: COURSE_ID, startPassword: "course-start-secret" })
    );
  });

  it("propagates passwordless New Quiz enablement rejection from the assessment service", async () => {
    assessments.enableContentSebWithAccessCode.mockRejectedValue(
      new HttpException({ error_code: "SEB_QUIT_PASSWORD_REQUIRED" }, 400)
    );

    await expectHttpError(() => controller.enable(mutationRequest(), COURSE_ID, "newquiz:course-1:assignment-99"), 400);

    expect(assessments.enableContentSebWithAccessCode).toHaveBeenCalledOnce();
  });

  it("returns a structured conflict while an administrator resets the course", async () => {
    assessments.enableContentSebWithAccessCode.mockRejectedValue(new CourseResetInProgressError());

    await expect(
      controller.enable(mutationRequest(), COURSE_ID, "newquiz:course-1:assignment-99")
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ error_code: "COURSE_RESET_IN_PROGRESS" })
    });
  });

  it("does not mutate a New Quiz when its stored Canvas identity does not match the route", async () => {
    assessments.getAssessmentRecord.mockResolvedValue(
      newQuizAssessment({ canvas: { ...newQuizAssessment().canvas, assignmentId: "assignment-elsewhere" } })
    );

    await expectHttpError(() => controller.enable(mutationRequest(), COURSE_ID, "newquiz:course-1:assignment-99"), 404);
    expect(assessments.enableContentSebWithAccessCode).not.toHaveBeenCalled();
  });

  it("disables New Quiz SEB and clears any stale Canvas-side access code", async () => {
    assessments.disableContentSebWithAccessCode.mockResolvedValue(
      newQuizSetting({ sebRequired: false, enabled: false, accessCode: null, configKey: null })
    );

    const result = await controller.disable(mutationRequest(), COURSE_ID, "newquiz:course-1:assignment-99");

    expect(result).toMatchObject({
      success: true,
      message: "Safe Online Exam disabled.",
      setting: { hasAccessCode: false, hasConfigKey: false }
    });
    expect(assessments.disableContentSebWithAccessCode).toHaveBeenCalledWith(
      COURSE_ID,
      "newquiz:course-1:assignment-99",
      "assignment-99",
      USER_ID
    );
  });

  it("regenerates Classic Quiz access codes without returning either secret", async () => {
    assessments.regenerateQuizAccessCode.mockResolvedValue({
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
    const result = await controller.regenerate(mutationRequest(), COURSE_ID, "quiz-1");

    expect(result).toEqual({
      success: true,
      message: "Safe Online Exam access code regenerated. Students should reopen the quiz from Canvas."
    });
    expect(JSON.stringify(result)).not.toContain("OLD-CODE");
    expect(JSON.stringify(result)).not.toContain("stored-config-key");
    expect(assessments.regenerateQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, "quiz-1", USER_ID);
  });

  it("resets quiz settings through exact assessment authorization and redacts the response", async () => {
    courseSettings.resetQuizToDefaults.mockResolvedValue({
      quizId: "quiz-1",
      courseId: COURSE_ID,
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS-SECRET",
      configKey: "CONFIG-SECRET",
      quitPassword: "UNIQUE-QUIT-SECRET",
      startPassword: "UNIQUE-START-SECRET",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: [],
      usesCourseDefaults: true
    });

    const result = await controller.resetDefaults(mutationRequest(), COURSE_ID, "quiz-1");
    expect(result).toMatchObject({
      success: true,
      setting: {
        quizId: "quiz-1",
        courseId: COURSE_ID,
        usesCourseDefaults: true,
        hasAccessCode: true,
        hasConfigKey: true,
        hasQuitPassword: true,
        hasEffectiveQuitPassword: true,
        hasStartPassword: true
      }
    });
    expect(JSON.stringify(result)).not.toContain("ACCESS-SECRET");
    expect(JSON.stringify(result)).not.toContain("CONFIG-SECRET");
    expect(JSON.stringify(result)).not.toContain("UNIQUE-QUIT-SECRET");
    expect(JSON.stringify(result)).not.toContain("UNIQUE-START-SECRET");

    courseSettings.resetQuizToDefaults.mockResolvedValueOnce(null);
    await expectHttpError(() => controller.resetDefaults(mutationRequest(), COURSE_ID, "quiz-1"), 404);
  });

  it("reports normalized New Quiz status to an authorized instructor", async () => {
    assessments.getContentSebSetting.mockResolvedValue(
      newQuizSetting({
        sebRequired: true,
        enabled: true,
        accessCode: "ACCESS",
        externalTools: [{ id: "Calc", label: "Calculator", url: "calc.example.edu", enabled: true }]
      })
    );

    const result = await controller.status(readRequest(), COURSE_ID, "newquiz:course-1:assignment-99");

    expect(result).toMatchObject({
      authenticated: true,
      canvasDomain: "canvas.example.edu",
      sebEnabled: true,
      hasAccessCode: true,
      configValid: true,
      externalTools: [expect.objectContaining({ id: "calc", url: "https://calc.example.edu/", enabled: true })]
    });
  });

  it("returns only secret-free quiz settings and course-bound quiz records", async () => {
    assessments.getQuizzesForCourse.mockResolvedValue([{ id: "quiz-1", title: "Quiz 1" }]);
    assessments.getSebSettingForQuiz.mockResolvedValue({
      quizId: "quiz-1",
      courseId: COURSE_ID,
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS-SECRET",
      configKey: "CONFIG-SECRET",
      quitPassword: "UNIQUE-QUIT-SECRET",
      startPassword: "UNIQUE-START-SECRET",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });
    assessments.getQuiz.mockResolvedValue({ id: "quiz-1", title: "Quiz 1", courseId: COURSE_ID });

    await expect(controller.getQuizzes(readRequest())).resolves.toEqual([{ id: "quiz-1", title: "Quiz 1" }]);
    const settings = await controller.getSettings(readRequest());
    expect(settings).toMatchObject({
      "quiz-1": {
        quizId: "quiz-1",
        sebRequired: true,
        hasAccessCode: true,
        hasConfigKey: true,
        hasQuitPassword: true,
        hasEffectiveQuitPassword: true,
        hasStartPassword: true
      }
    });
    expect(JSON.stringify(settings)).not.toContain("ACCESS-SECRET");
    expect(JSON.stringify(settings)).not.toContain("CONFIG-SECRET");
    expect(JSON.stringify(settings)).not.toContain("UNIQUE-QUIT-SECRET");
    expect(JSON.stringify(settings)).not.toContain("UNIQUE-START-SECRET");
    await expect(controller.getQuiz(readRequest(), "quiz-1")).resolves.toEqual({
      id: "quiz-1",
      title: "Quiz 1",
      courseId: COURSE_ID
    });
  });

  it("rejects learner, legacy-alias, and action-token-only management requests", async () => {
    await expectHttpError(() => controller.getQuizzes(readRequest({ roles: [LEARNER_ROLE] })), 403);
    await expectHttpError(() => controller.getQuizzes(legacyAliasRequest()), 401);
    await expectHttpError(() => controller.refresh(actionTokenOnlyRequest(), COURSE_ID), 401);
    expect(assessments.refreshCourseContent).not.toHaveBeenCalled();
  });

  it("rejects cross-course and wrong-session mutation tokens before changing state", async () => {
    await expectHttpError(
      () => controller.enable(mutationRequest({ courseId: "other-course" }), COURSE_ID, "quiz-1"),
      403
    );
    await expectHttpError(
      () => controller.enable(mutationRequest({ tokenSessionId: "other-session" }), COURSE_ID, "quiz-1"),
      403
    );
    expect(assessments.enableSebWithAccessCode).not.toHaveBeenCalled();
  });

  it("rejects structured saves with identity, course, or object mismatches", async () => {
    await expectHttpError(() => controller.saveStructured(mutationRequest(), { quizId: "quiz-1" }, "other-user"), 403);
    await expectHttpError(
      () => controller.saveStructured(mutationRequest(), { quizId: "quiz-1", courseId: "other-course" }, USER_ID),
      403
    );
    await expectHttpError(() => controller.saveStructured(mutationRequest(), {}, USER_ID), 400);

    assessments.getAssessmentRecord.mockResolvedValueOnce(classicAssessment({ courseId: "other-course" }));
    await expectHttpError(
      () => controller.saveStructured(mutationRequest(), { quizId: "quiz-1", courseId: COURSE_ID }, USER_ID),
      404
    );
    expect(assessments.saveQuizSebSetting).not.toHaveBeenCalled();
  });

  it("saves a Classic Quiz structured policy and returns only secret-presence flags", async () => {
    let lockActive = false;
    assessments.withAssessmentLock.mockImplementation(async (_contentId, action) => {
      lockActive = true;
      try {
        return await action();
      } finally {
        lockActive = false;
      }
    });
    courseSettings.getDefaults.mockImplementation(async () => {
      expect(lockActive).toBe(true);
      return {
        ...defaultCourseSebDefaults(COURSE_ID),
        externalTools: [
          {
            id: "desmos-graphing",
            label: "Desmos Graphing",
            url: "https://www.desmos.com/calculator",
            enabled: false
          },
          {
            id: "desmos-scientific",
            label: "Desmos Scientific",
            url: "https://www.desmos.com/scientific",
            enabled: false
          }
        ]
      };
    });
    assessments.getSebSettingForQuiz.mockImplementation(async () => {
      expect(lockActive).toBe(true);
      return {
        quizId: "quiz-1",
        courseId: COURSE_ID,
        sebRequired: true,
        enabled: true,
        accessCode: "ACCESS-SECRET",
        configKey: "CONFIG-SECRET",
        quitPassword: "OLD-UNIQUE-QUIT",
        startPassword: "OLD-UNIQUE-START",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      };
    });
    assessments.saveQuizSebSetting.mockImplementation(async (setting) => setting);

    const result = await controller.saveStructured(
      mutationRequest(),
      {
        quizId: "quiz-1",
        courseId: COURSE_ID,
        quitPassword: "NEW-UNIQUE-QUIT",
        startPassword: "NEW-UNIQUE-START",
        quitPasswordOverride: true,
        startPasswordOverride: true,
        urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
        externalToolIds: ["desmos-graphing"],
        quizOnlyExternalTools: [
          {
            id: "formula-reference",
            label: "Formula reference",
            url: "https://reference.example.edu/formulas",
            enabled: true
          }
        ]
      },
      USER_ID
    );

    expect(result).toMatchObject({
      success: true,
      setting: {
        quizId: "quiz-1",
        courseId: COURSE_ID,
        hasAccessCode: true,
        hasConfigKey: true,
        hasQuitPassword: true,
        hasStartPassword: true
      }
    });
    expect(JSON.stringify(result)).not.toContain("ACCESS-SECRET");
    expect(JSON.stringify(result)).not.toContain("CONFIG-SECRET");
    expect(JSON.stringify(result)).not.toContain("NEW-QUIT");
    expect(JSON.stringify(result)).not.toContain("NEW-START");
    expect(assessments.saveQuizSebSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        externalToolIds: ["desmos-graphing"],
        quizOnlyExternalTools: [
          expect.objectContaining({
            id: "formula-reference",
            url: "https://reference.example.edu/formulas",
            enabled: true
          })
        ],
        externalTools: expect.arrayContaining([
          expect.objectContaining({ id: "desmos-graphing", enabled: true }),
          expect.objectContaining({ id: "desmos-scientific", enabled: false })
        ])
      })
    );
    expect(assessments.withAssessmentLock).toHaveBeenCalledWith("quiz-1", expect.any(Function), COURSE_ID);
  });

  it("rejects attempts to replace the course catalog from a quiz request", async () => {
    await expectHttpError(
      () =>
        controller.saveStructured(
          mutationRequest(),
          {
            quizId: "quiz-1",
            courseId: COURSE_ID,
            externalTools: [{ id: "bypass", label: "Bypass", url: "https://evil.example.edu", enabled: true }]
          },
          USER_ID
        ),
      400
    );
    expect(assessments.saveQuizSebSetting).not.toHaveBeenCalled();
  });

  it("keeps the public config redirect route compatible", () => {
    const response = { redirect: vi.fn() } as any;
    controller.redirectConfig(response, COURSE_ID, "quiz-1");
    expect(response.redirect).toHaveBeenCalledWith(302, "/seb/launch/quiz-1");
  });
});

interface RequestOptions {
  userId?: string;
  courseId?: string;
  subject?: string;
  deploymentId?: string;
  roles?: string[];
  sessionId?: string;
  tokenSessionId?: string;
  origin?: string;
}

function configDouble() {
  return {
    getCanvasDomain: () => "https://canvas.example.edu",
    getRequiredToolUrl: () => "https://tool.example.edu",
    value: {
      security: { sessionSecret: SESSION_SECRET },
      seb: { defaultQuitPassword: "managed-server-exit" }
    }
  };
}

function readRequest(options: RequestOptions = {}): any {
  const userId = options.userId || USER_ID;
  const courseId = options.courseId || COURSE_ID;
  const subject = options.subject || SUBJECT;
  const deploymentId = options.deploymentId || DEPLOYMENT_ID;
  const sessionId = options.sessionId || SESSION_ID;
  const headers = new Map<string, string>();
  if (options.origin) {
    headers.set("origin", options.origin);
  }
  return {
    sessionID: sessionId,
    session: {
      verifiedLtiPrincipal: {
        version: 1,
        issuer: "https://canvas.example.edu",
        deploymentId,
        subject,
        canvasUserId: userId,
        courseId,
        roles: options.roles || [INSTRUCTOR_ROLE],
        custom: {},
        authenticatedAt: "2026-07-13T00:00:00.000Z"
      }
    },
    header: (name: string) => headers.get(name.toLowerCase())
  };
}

function mutationRequest(options: RequestOptions = {}): any {
  const request = readRequest(options);
  const principal = request.session.verifiedLtiPrincipal;
  const token = createActionToken(configDouble() as any, principal.canvasUserId, principal.courseId, {
    subject: principal.subject,
    deploymentId: principal.deploymentId,
    sessionId: options.tokenSessionId || request.sessionID
  });
  const originalHeader = request.header;
  request.header = (name: string) => (name.toLowerCase() === "x-auth-token" ? token : originalHeader(name));
  return request;
}

function legacyAliasRequest(): any {
  return {
    sessionID: SESSION_ID,
    session: {
      launchData: { userId: USER_ID, courseId: COURSE_ID, roles: [INSTRUCTOR_ROLE] },
      userId: USER_ID,
      courseId: COURSE_ID,
      canvas_user_id: USER_ID,
      canvas_course_id: COURSE_ID
    },
    header: () => undefined
  };
}

function actionTokenOnlyRequest(): any {
  const token = createActionToken(configDouble() as any, USER_ID, COURSE_ID, {
    subject: SUBJECT,
    deploymentId: DEPLOYMENT_ID,
    sessionId: SESSION_ID
  });
  return {
    sessionID: SESSION_ID,
    session: {},
    header: (name: string) => (name.toLowerCase() === "x-auth-token" ? token : undefined)
  };
}

function copyableTool() {
  return {
    id: "formula-sheet",
    label: "Formula sheet",
    url: "https://reference.example.edu/formulas",
    enabled: true,
    allowedRules: [{ id: "images", match: "path" as const, value: "https://reference.example.edu/images/*" }]
  };
}

function assessmentById(id: string): Record<string, unknown> | null {
  if (id === "classicquiz_quiz-1") {
    return classicAssessment();
  }
  if (id === "newquiz:course-1:assignment-99") {
    return newQuizAssessment();
  }
  return null;
}

function classicAssessment(overrides: Record<string, unknown> = {}) {
  return {
    id: "classicquiz_quiz-1",
    courseId: COURSE_ID,
    contentType: "CLASSIC_QUIZ",
    canvas: { id: "quiz-1", quizId: "quiz-1", title: "Quiz 1" },
    seb: assessmentSebState(),
    ...overrides
  };
}

function newQuizAssessment(overrides: Record<string, unknown> = {}) {
  return {
    id: "newquiz:course-1:assignment-99",
    courseId: COURSE_ID,
    contentType: "NEW_QUIZ",
    canvas: { id: "assignment-99", assignmentId: "assignment-99", title: "New Quiz" },
    seb: assessmentSebState(),
    ...overrides
  };
}

function assessmentSebState() {
  return {
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
