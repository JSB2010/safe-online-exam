import { beforeEach, describe, expect, it, vi } from "vitest";
import { LtiController } from "../../src/server/controllers/lti.controller.js";
import { defaultCourseSebDefaults } from "../../src/shared/models.js";
import type { LtiLaunchData } from "../../src/shared/models.js";

describe("LtiController role routing", () => {
  let controller: LtiController;
  let canvasApi: { hasAccessToken: ReturnType<typeof vi.fn> };
  let quizService: {
    getQuizzesForCourse: ReturnType<typeof vi.fn>;
    getSebSettingForQuiz: ReturnType<typeof vi.fn>;
  };
  let contentService: {
    getAllContentForCourse: ReturnType<typeof vi.fn>;
    getCachedContentForCourse: ReturnType<typeof vi.fn>;
    getSebSetting: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    canvasApi = { hasAccessToken: vi.fn().mockResolvedValue(true) };
    quizService = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getSebSettingForQuiz: vi.fn().mockResolvedValue(null)
    };
    contentService = {
      getAllContentForCourse: vi.fn().mockResolvedValue([]),
      getCachedContentForCourse: vi.fn().mockResolvedValue([]),
      getSebSetting: vi.fn().mockResolvedValue(null)
    };
    controller = new LtiController(
      {
        getApplicationBaseUrl: () => "https://tool.example.test",
        getRequiredToolUrl: () => "https://tool.example.test",
        value: { security: { sessionSecret: "test-secret" } }
      } as any,
      {} as any,
      {} as any,
      {} as any,
      quizService as any,
      canvasApi as any,
      contentService as any,
      {
        getDefaults: vi.fn().mockResolvedValue(defaultCourseSebDefaults("course-1"))
      } as any,
      { isRequestFromSeb: vi.fn().mockReturnValue(false) } as any
    );
  });

  it("renders the student view for learner launches", async () => {
    const response = responseDouble();
    await controller.launchGet(
      requestDouble({
        userId: "student-1",
        courseId: "course-1",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]
      }),
      response
    );

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"student"'));
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
  });

  it("does not reuse stale instructor roles for a different queried user", async () => {
    const response = responseDouble();
    const request = requestDouble({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });

    await controller.launchGet(request, response, "course-1", "student-1");

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"student"'));
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
    expect(request.session.launchData?.roles).toEqual([]);
    expect(request.session.launchData?.userId).toBe("student-1");
  });

  it("renders the teacher view only when the launch has an instructor role", async () => {
    const response = responseDouble();
    await controller.launchGet(
      requestDouble({
        userId: "teacher-1",
        courseId: "course-1",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
      }),
      response
    );

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"teacher"'));
    expect(canvasApi.hasAccessToken).toHaveBeenCalledWith("teacher-1");
  });
});

function requestDouble(launchData: LtiLaunchData): any {
  return {
    originalUrl: "/lti/launch",
    protocol: "https",
    get: () => "tool.example.test",
    session: { launchData }
  };
}

function responseDouble(): any {
  const response = {
    send: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn()
  };
  response.status.mockReturnValue(response);
  return response;
}
