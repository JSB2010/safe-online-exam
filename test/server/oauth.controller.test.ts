import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthController, canvasScopes } from "../../src/server/controllers/oauth.controller.js";

describe("canvasScopes", () => {
  it("requests the Canvas API scopes needed for quiz SEB enforcement", () => {
    expect(canvasScopes()).toEqual([
      "url:GET|/api/v1/courses/:course_id/quizzes",
      "url:GET|/api/v1/courses/:course_id/assignments",
      "url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
      "url:PUT|/api/v1/courses/:course_id/quizzes/:id",
      "url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id"
    ]);
  });
});

describe("OAuthController", () => {
  let canvasApi: {
    clearAccessToken: ReturnType<typeof vi.fn>;
    storeAccessToken: ReturnType<typeof vi.fn>;
    hasAccessToken: ReturnType<typeof vi.fn>;
  };
  let ltiState: { createState: ReturnType<typeof vi.fn>; consumeState: ReturnType<typeof vi.fn> };
  let controller: OAuthController;

  beforeEach(() => {
    canvasApi = {
      clearAccessToken: vi.fn().mockResolvedValue(undefined),
      storeAccessToken: vi.fn().mockResolvedValue({}),
      hasAccessToken: vi.fn().mockResolvedValue(true)
    };
    ltiState = {
      createState: vi.fn().mockReturnValue("oauth-state"),
      consumeState: vi.fn().mockReturnValue({
        userId: "user-1",
        courseId: "course-1",
        redirectUrl: "/lti/launch",
        roles: JSON.stringify(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]),
        courseName: "Biology",
        fullName: "Teacher One"
      })
    };
    controller = new OAuthController(configDouble() as any, canvasApi as any, ltiState as any);
    vi.restoreAllMocks();
  });

  it("redirects Canvas OAuth authorization requests with expected scope and state", () => {
    const response = responseDouble();
    const request = {
      originalUrl: "/lti/launch",
      session: {
        launchData: {
          roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
          courseName: "Biology",
          fullName: "Teacher One"
        }
      }
    } as any;

    controller.authorize(request, response, {
      user_id: "user-1",
      course_id: "course-1",
      redirect_url: "/custom-return"
    });

    const redirectUrl = new URL(response.redirect.mock.calls[0][0]);
    expect(redirectUrl.href).toContain("https://canvas.example.edu/login/oauth2/auth");
    expect(redirectUrl.searchParams.get("client_id")).toBe("client-1");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe("https://tool.example.edu/api/oauth2callback");
    expect(redirectUrl.searchParams.get("state")).toBe("oauth-state");
    expect(redirectUrl.searchParams.get("scope")).toBe(canvasScopes().join(" "));
    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        courseId: "course-1",
        redirectUrl: "/custom-return",
        courseName: "Biology",
        fullName: "Teacher One"
      })
    );
  });

  it("clears existing tokens before reauthorization", () => {
    const response = responseDouble();

    controller.reauthorize({ session: {} } as any, response, { user_id: "user-1", course_id: "course-1" });

    expect(canvasApi.clearAccessToken).toHaveBeenCalledWith("user-1");
    expect(response.redirect).toHaveBeenCalled();
  });

  it("rejects authorization requests missing required query or configuration", () => {
    const missingQueryResponse = responseDouble();
    controller.authorize({ session: {} } as any, missingQueryResponse, { user_id: "user-1" });
    expect(missingQueryResponse.status).toHaveBeenCalledWith(400);
    expect(missingQueryResponse.send).toHaveBeenCalledWith("Missing user_id or course_id");

    const missingConfig = new OAuthController(
      {
        ...configDouble(),
        value: { ...configDouble().value, canvas: { ...configDouble().value.canvas, oauthClientId: "" } }
      } as any,
      canvasApi as any,
      ltiState as any
    );
    const missingConfigResponse = responseDouble();
    missingConfig.authorize({ session: {} } as any, missingConfigResponse, {
      user_id: "user-1",
      course_id: "course-1"
    });
    expect(missingConfigResponse.status).toHaveBeenCalledWith(500);
  });

  it("stores OAuth callback tokens and restores instructor launch session data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: "scope-1",
        expires_in: 3600
      })
    } as Response);
    const request = { session: {} } as any;
    const response = responseDouble();

    await controller.callback(request, response, { code: "oauth-code", state: "state" });

    expect(fetch).toHaveBeenCalledWith(
      "https://canvas.example.edu/login/oauth2/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(canvasApi.storeAccessToken).toHaveBeenCalledWith("user-1", "access-token", {
      refreshToken: "refresh-token",
      scope: "scope-1",
      expiresIn: 3600
    });
    expect(request.session.launchData).toMatchObject({
      userId: "user-1",
      courseId: "course-1",
      courseName: "Biology",
      fullName: "Teacher One"
    });
    expect(response.redirect).toHaveBeenCalledWith("/lti/launch?course_id=course-1&user_id=user-1");
  });

  it("renders OAuth error states and reports authorization status", async () => {
    const errorResponse = responseDouble();
    await controller.callback({ session: {} } as any, errorResponse, {
      error: "access_denied",
      error_description: "Denied by Canvas"
    });
    expect(errorResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"oauth-error"'));

    await expect(controller.status("user-1")).resolves.toEqual({ authorized: true, userId: "user-1" });
    await expect(controller.status()).resolves.toEqual({ authorized: false, userId: undefined });
  });
});

function configDouble() {
  return {
    getCanvasDomain: () => "https://canvas.example.edu",
    getRequiredToolUrl: () => "https://tool.example.edu",
    value: {
      canvas: {
        oauthClientId: "client-1",
        oauthClientSecret: "secret-1",
        redirectUri: ""
      }
    }
  };
}

function responseDouble(): any {
  const response = {
    status: vi.fn(),
    send: vi.fn(),
    redirect: vi.fn()
  };
  response.status.mockReturnValue(response);
  return response;
}
