import { beforeEach, describe, expect, it, vi } from "vitest";
import { LtiController } from "../../src/server/controllers/lti.controller.js";
import { defaultCourseSebDefaults } from "../../src/shared/models.js";
import type { LtiLaunchData } from "../../src/shared/models.js";

describe("LtiController role routing", () => {
  let controller: LtiController;
  let canvasApi: { hasAccessToken: ReturnType<typeof vi.fn> };
  let ltiService: { validateToken: ReturnType<typeof vi.fn> };
  let ltiState: { createState: ReturnType<typeof vi.fn>; consumeState: ReturnType<typeof vi.fn> };
  let assessments: {
    refreshCourseContent: ReturnType<typeof vi.fn>;
    getQuizzesForCourse: ReturnType<typeof vi.fn>;
    getCachedContentForCourse: ReturnType<typeof vi.fn>;
    getSebSettingForQuiz: ReturnType<typeof vi.fn>;
    getContentSebSetting: ReturnType<typeof vi.fn>;
    getQuiz: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    canvasApi = { hasAccessToken: vi.fn().mockResolvedValue(true) };
    ltiService = { validateToken: vi.fn() };
    ltiState = {
      createState: vi.fn().mockReturnValue("encoded-state"),
      consumeState: vi.fn().mockReturnValue({ nonce: "nonce-1" })
    };
    assessments = {
      refreshCourseContent: vi.fn().mockResolvedValue({ classicQuizzes: [], contentItems: [] }),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getCachedContentForCourse: vi.fn().mockResolvedValue([]),
      getSebSettingForQuiz: vi.fn().mockResolvedValue(null),
      getContentSebSetting: vi.fn().mockResolvedValue(null),
      getQuiz: vi.fn().mockResolvedValue(null)
    };
    controller = new LtiController(
      {
        getApplicationBaseUrl: () => "https://tool.example.test",
        getRequiredToolUrl: () => "https://tool.example.test",
        value: {
          lti: {
            authUrl: "https://canvas.example.test/api/lti/authorize_redirect",
            clientId: "client-1"
          },
          security: { sessionSecret: "test-secret" }
        }
      } as any,
      ltiService as any,
      ltiState as any,
      assessments as any,
      canvasApi as any,
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
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("/seb/check/config.seb"));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("sebs://"));
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
  });

  it("redirects valid OIDC login requests to Canvas authorization", async () => {
    const response = responseDouble();
    const request = {
      query: {
        iss: "https://canvas.example.test",
        login_hint: "hint-1",
        target_link_uri: "https://tool.example.test/lti/launch",
        lti_message_hint: "message-hint",
        lti_deployment_id: "deployment-1"
      },
      session: {}
    } as any;

    await controller.loginGet(request, response);

    const redirectUrl = new URL(response.redirect.mock.calls[0][0]);
    expect(redirectUrl.origin).toBe("https://canvas.example.test");
    expect(redirectUrl.searchParams.get("client_id")).toBe("client-1");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe("https://tool.example.test/lti/launch");
    expect(redirectUrl.searchParams.get("login_hint")).toBe("hint-1");
    expect(redirectUrl.searchParams.get("state")).toBe("encoded-state");
    expect(redirectUrl.searchParams.get("nonce")).toMatch(/[0-9a-f-]{36}/u);
    expect(redirectUrl.searchParams.get("lti_message_hint")).toBe("message-hint");
    expect(request.session.target_link_uri).toBe("https://tool.example.test/lti/launch");
  });

  it("rejects malformed OIDC login and launch requests with fallback HTML", async () => {
    const loginResponse = responseDouble();
    await controller.loginGet({ query: {}, session: {} } as any, loginResponse);
    expect(loginResponse.status).toHaveBeenCalledWith(400);
    expect(loginResponse.send).toHaveBeenCalledWith(expect.stringContaining("LTI Login Error"));

    const launchResponse = responseDouble();
    await controller.launchPost({ session: {} } as any, launchResponse, {});
    expect(launchResponse.status).toHaveBeenCalledWith(400);
    expect(launchResponse.send).toHaveBeenCalledWith(expect.stringContaining("Canvas did not provide an LTI id_token"));

    const canvasErrorResponse = responseDouble();
    await controller.launchPost({ session: {} } as any, canvasErrorResponse, {
      error: "invalid_request",
      error_description: "<bad>"
    });
    expect(canvasErrorResponse.status).toHaveBeenCalledWith(400);
    expect(canvasErrorResponse.send).toHaveBeenCalledWith(expect.stringContaining("&lt;bad&gt;"));
  });

  it("returns Canvas LTI dynamic registration metadata", () => {
    expect(controller.ltiConfig()).toMatchObject({
      title: "Safe Exam Browser Canvas Integration",
      oidc_initiation_url: "https://tool.example.test/lti/login",
      target_link_uri: "https://tool.example.test/lti/launch",
      public_jwk_url: "https://tool.example.test/.well-known/jwks.json",
      extensions: [
        expect.objectContaining({
          platform: "canvas.instructure.com"
        })
      ]
    });
  });

  it("returns removed deep-linking guidance instead of rendering the teacher UI", async () => {
    ltiService.validateToken.mockResolvedValue({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
      messageType: "LtiDeepLinkingRequest"
    });
    const response = responseDouble();

    await controller.launchPost({ session: {} } as any, response, { id_token: "token", state: "state" });

    expect(ltiState.consumeState).toHaveBeenCalledWith("state");
    expect(ltiService.validateToken).toHaveBeenCalledWith("token", "nonce-1");
    expect(response.status).toHaveBeenCalledWith(410);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Deep Linking Removed"));
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

  it("renders only enabled SEB assessments for student course launches", async () => {
    assessments.getQuizzesForCourse.mockResolvedValue([
      { id: "quiz-b", courseId: "course-1", title: "Beta Classic", htmlUrl: "https://canvas.example/quizzes/b" },
      { id: "quiz-a", courseId: "course-1", title: "Alpha Classic", htmlUrl: "https://canvas.example/quizzes/a" }
    ]);
    assessments.getCachedContentForCourse.mockResolvedValue([
      {
        id: "newquiz:course-1:99",
        courseId: "course-1",
        title: "Gamma New Quiz",
        contentType: "NEW_QUIZ",
        htmlUrl: "https://canvas.example/assignments/99"
      }
    ]);
    assessments.getSebSettingForQuiz.mockImplementation(async (quizId: string) =>
      quizId === "quiz-a" ? { sebRequired: true, enabled: true } : { sebRequired: false, enabled: false }
    );
    assessments.getContentSebSetting.mockResolvedValue({ sebRequired: true, enabled: true });
    const response = responseDouble();

    await controller.launchGet(
      requestDouble({
        userId: "student-1",
        courseId: "course-1",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]
      }),
      response
    );

    const html = response.send.mock.calls[0][0] as string;
    expect(html).toContain('"view":"student"');
    expect(html).toContain("Alpha Classic");
    expect(html).toContain("Gamma New Quiz");
    expect(html).not.toContain("Beta Classic");
    expect(html.indexOf("Alpha Classic")).toBeLessThan(html.indexOf("Gamma New Quiz"));
  });

  it("renders the SEB-required screen for targeted student launches outside SEB", async () => {
    assessments.getQuiz.mockResolvedValue({
      id: "quiz-1",
      courseId: "course-1",
      title: "Midterm",
      htmlUrl: "https://canvas.example/quizzes/quiz-1"
    });
    assessments.getSebSettingForQuiz.mockResolvedValue({ sebRequired: true, enabled: true });
    const response = responseDouble();

    await controller.launchGet(
      requestDouble({
        userId: "student-1",
        courseId: "course-1",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
        custom: { quiz_id: "quiz-1" }
      }),
      response
    );

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-required"'));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("/seb/config/course-1/quiz-1.seb"));
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
