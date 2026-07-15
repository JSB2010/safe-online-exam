import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config/app-config.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import {
  AssessmentAccessCodeConsistencyError,
  AssessmentService
} from "../../src/server/services/assessment.service.js";
import { CanvasApiRequestError, type CanvasApiService } from "../../src/server/services/canvas-api.service.js";

const COURSE_ID = "course-1";
const QUIZ_ID = "quiz-1";
const CONTENT_ID = "newquiz:course-1:assignment-1";
const ASSIGNMENT_ID = "assignment-1";
const USER_ID = "user-1";
const OLD_CODE = "OLD-ACCESS-CODE";

describe("AssessmentService access-code consistency", () => {
  it("removes a newly applied Classic code when the first Firestore save fails", async () => {
    const { service, repositories, canvas } = fixture();
    const persistenceError = new Error("Firestore unavailable");
    vi.spyOn(repositories.assessments, "update").mockRejectedValueOnce(persistenceError);

    await expect(service.enableSebWithAccessCode(COURSE_ID, QUIZ_ID, USER_ID)).rejects.toBe(persistenceError);

    expect(canvas.setQuizAccessCode).toHaveBeenCalledOnce();
    expect(canvas.removeQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, QUIZ_ID, USER_ID);
    await expect(repositories.assessments.get(`classicquiz_${QUIZ_ID}`)).resolves.toBeNull();
  });

  it("removes a newly applied New Quiz code when its first Firestore save fails", async () => {
    const { service, repositories, canvas } = fixture();
    const persistenceError = new Error("Firestore unavailable");
    vi.spyOn(repositories.assessments, "update").mockRejectedValueOnce(persistenceError);

    await expect(service.enableContentSebWithAccessCode(COURSE_ID, CONTENT_ID, ASSIGNMENT_ID, USER_ID)).rejects.toBe(
      persistenceError
    );

    expect(canvas.setNewQuizAccessCode).toHaveBeenCalledOnce();
    expect(canvas.removeNewQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, ASSIGNMENT_ID, USER_ID);
    await expect(repositories.assessments.get(CONTENT_ID)).resolves.toBeNull();
  });

  it("restores the Classic code when disabling succeeds in Canvas but persistence fails", async () => {
    const { service, repositories, canvas } = fixture();
    await service.saveQuizSebSetting(classicSetting());
    const persistenceError = new Error("Firestore unavailable");
    const updateSpy = vi.spyOn(repositories.assessments, "update").mockRejectedValueOnce(persistenceError);

    await expect(service.disableSebWithAccessCode(COURSE_ID, QUIZ_ID, USER_ID)).rejects.toBe(persistenceError);

    expect(canvas.removeQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, QUIZ_ID, USER_ID);
    expect(canvas.setQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, QUIZ_ID, OLD_CODE, USER_ID);
    expect(canvas.removeQuizAccessCode.mock.invocationCallOrder[0]).toBeLessThan(
      updateSpy.mock.invocationCallOrder[0]!
    );
    expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(canvas.setQuizAccessCode.mock.invocationCallOrder[0]!);
    await expect(service.getSebSettingForQuiz(QUIZ_ID)).resolves.toMatchObject({
      sebRequired: true,
      enabled: true,
      accessCode: OLD_CODE
    });
  });

  it("restores the New Quiz code when disabling succeeds in Canvas but persistence fails", async () => {
    const { service, repositories, canvas } = fixture();
    await service.saveContentSebSetting(contentSetting());
    const persistenceError = new Error("Firestore unavailable");
    vi.spyOn(repositories.assessments, "update").mockRejectedValueOnce(persistenceError);

    await expect(service.disableContentSebWithAccessCode(COURSE_ID, CONTENT_ID, ASSIGNMENT_ID, USER_ID)).rejects.toBe(
      persistenceError
    );

    expect(canvas.removeNewQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, ASSIGNMENT_ID, USER_ID);
    expect(canvas.setNewQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, ASSIGNMENT_ID, OLD_CODE, USER_ID);
    await expect(service.getContentSebSetting(CONTENT_ID)).resolves.toMatchObject({
      sebRequired: true,
      enabled: true,
      accessCode: OLD_CODE
    });
  });

  it("compensates an ambiguous Classic disable timeout before leaving the record enabled", async () => {
    const { service, repositories, canvas } = fixture();
    await service.saveQuizSebSetting(classicSetting());
    const timeout = canvasTimeout("remove Classic access code");
    canvas.removeQuizAccessCode.mockRejectedValueOnce(timeout);
    const updateSpy = vi.spyOn(repositories.assessments, "update");

    await expect(service.disableSebWithAccessCode(COURSE_ID, QUIZ_ID, USER_ID)).rejects.toBe(timeout);

    expect(canvas.setQuizAccessCode).toHaveBeenCalledWith(COURSE_ID, QUIZ_ID, OLD_CODE, USER_ID);
    expect(updateSpy).not.toHaveBeenCalled();
    await expect(service.getSebSettingForQuiz(QUIZ_ID)).resolves.toMatchObject({
      sebRequired: true,
      enabled: true,
      accessCode: OLD_CODE
    });
  });

  it("restores the prior Classic code after an ambiguous regeneration timeout", async () => {
    const { service, canvas } = fixture();
    await service.saveQuizSebSetting(classicSetting());
    const timeout = canvasTimeout("rotate Classic access code");
    canvas.setQuizAccessCode.mockRejectedValueOnce(timeout).mockResolvedValueOnce(true);

    await expect(service.regenerateQuizAccessCode(COURSE_ID, QUIZ_ID, USER_ID)).rejects.toBe(timeout);

    expect(canvas.setQuizAccessCode).toHaveBeenCalledTimes(2);
    expect(canvas.setQuizAccessCode).toHaveBeenLastCalledWith(COURSE_ID, QUIZ_ID, OLD_CODE, USER_ID);
    await expect(service.getSebSettingForQuiz(QUIZ_ID)).resolves.toMatchObject({ accessCode: OLD_CODE });
  });

  it("restores the prior New Quiz code when regenerated-code persistence fails", async () => {
    const { service, repositories, canvas } = fixture();
    await service.saveContentSebSetting(contentSetting());
    const persistenceError = new Error("Firestore unavailable");
    vi.spyOn(repositories.assessments, "update").mockRejectedValueOnce(persistenceError);

    await expect(service.regenerateContentAccessCode(COURSE_ID, CONTENT_ID, ASSIGNMENT_ID, USER_ID)).rejects.toBe(
      persistenceError
    );

    expect(canvas.setNewQuizAccessCode).toHaveBeenCalledTimes(2);
    expect(canvas.setNewQuizAccessCode).toHaveBeenLastCalledWith(COURSE_ID, ASSIGNMENT_ID, OLD_CODE, USER_ID);
    await expect(service.getContentSebSetting(CONTENT_ID)).resolves.toMatchObject({ accessCode: OLD_CODE });
  });

  it("accepts an ambiguously reported Firestore write only after reading back the desired code", async () => {
    const { service, repositories, canvas } = fixture();
    const originalUpdate = repositories.assessments.update.bind(repositories.assessments);
    vi.spyOn(repositories.assessments, "update").mockImplementationOnce(async (id, updater) => {
      await originalUpdate(id, updater);
      throw new Error("commit response lost");
    });

    const enabled = await service.enableSebWithAccessCode(COURSE_ID, QUIZ_ID, USER_ID);

    expect(enabled).toMatchObject({ sebRequired: true, enabled: true, accessCode: expect.any(String) });
    expect(canvas.removeQuizAccessCode).not.toHaveBeenCalled();
    await expect(service.getSebSettingForQuiz(QUIZ_ID)).resolves.toMatchObject({ accessCode: enabled.accessCode });
  });

  it("raises an explicit consistency error when Firestore fails and Canvas compensation also fails", async () => {
    const { service, repositories, canvas } = fixture();
    vi.spyOn(repositories.assessments, "update").mockRejectedValueOnce(new Error("Firestore unavailable"));
    canvas.removeQuizAccessCode.mockRejectedValueOnce(new Error("Canvas rollback unavailable"));

    await expect(service.enableSebWithAccessCode(COURSE_ID, QUIZ_ID, USER_ID)).rejects.toBeInstanceOf(
      AssessmentAccessCodeConsistencyError
    );
    await expect(repositories.assessments.get(`classicquiz_${QUIZ_ID}`)).resolves.toBeNull();
  });
});

function fixture() {
  const repositories = createInMemoryRepositories();
  const canvas = {
    getCanvasDomain: vi.fn(() => "https://canvas.example.edu"),
    setQuizAccessCode: vi.fn().mockResolvedValue(true),
    removeQuizAccessCode: vi.fn().mockResolvedValue(true),
    setNewQuizAccessCode: vi.fn().mockResolvedValue(true),
    removeNewQuizAccessCode: vi.fn().mockResolvedValue(true)
  };
  const service = new AssessmentService(
    { value: repositories } as RepositoryProvider,
    canvas as unknown as CanvasApiService,
    { value: { seb: { defaultQuitPassword: "managed-server-exit" } } } as unknown as AppConfig
  );
  return { service, repositories, canvas };
}

function classicSetting() {
  return {
    quizId: QUIZ_ID,
    courseId: COURSE_ID,
    sebRequired: true,
    enabled: true,
    accessCode: OLD_CODE,
    configKey: "old-config-key",
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    externalTools: []
  };
}

function contentSetting() {
  return {
    contentId: CONTENT_ID,
    courseId: COURSE_ID,
    canvasId: ASSIGNMENT_ID,
    assignmentId: ASSIGNMENT_ID,
    contentType: "NEW_QUIZ" as const,
    sebRequired: true,
    enabled: true,
    accessCode: OLD_CODE,
    configKey: "old-config-key",
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    externalTools: []
  };
}

function canvasTimeout(action: string): CanvasApiRequestError {
  return new CanvasApiRequestError(`Canvas API request timed out while attempting to ${action}.`, USER_ID, "", 504, "");
}
