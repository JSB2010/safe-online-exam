import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthController, canvasScopes, studentSessionScopes } from "../../src/server/controllers/oauth.controller.js";
import { UpstreamRequestTimeoutError } from "../../src/server/http/upstream-deadline.js";
import { CANVAS_OAUTH_SCOPE_VERSION } from "../../src/shared/models.js";

const instructorRole = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
const learnerRole = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

describe("canvasScopes", () => {
  it("requests every Canvas OAuth scope required across instructor and student launches", () => {
    expect(canvasScopes()).toEqual([
      "url:GET|/api/v1/courses/:course_id/quizzes",
      "url:GET|/api/v1/courses/:course_id/assignments",
      "url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
      "url:PUT|/api/v1/courses/:course_id/quizzes/:id",
      "url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
      "url:GET|/api/v1/login/session_token"
    ]);
  });

  it("requests the same durable capability set from the student connection flow", () => {
    expect(studentSessionScopes()).toEqual(canvasScopes());
  });
});

describe("OAuthController", () => {
  let canvasApi: {
    clearAccessToken: ReturnType<typeof vi.fn>;
    storeAccessToken: ReturnType<typeof vi.fn>;
    hasAccessToken: ReturnType<typeof vi.fn>;
  };
  let ltiState: {
    createState: ReturnType<typeof vi.fn>;
    peekState: ReturnType<typeof vi.fn>;
    claimState: ReturnType<typeof vi.fn>;
  };
  let controller: OAuthController;

  beforeEach(() => {
    canvasApi = {
      clearAccessToken: vi.fn().mockResolvedValue(undefined),
      storeAccessToken: vi.fn().mockResolvedValue({}),
      hasAccessToken: vi.fn().mockResolvedValue(true)
    };
    ltiState = {
      createState: vi.fn().mockResolvedValue("oauth-state"),
      peekState: vi.fn(),
      claimState: vi.fn().mockResolvedValue(undefined)
    };
    controller = new OAuthController(configDouble() as any, canvasApi as any, ltiState as any);
    vi.restoreAllMocks();
  });

  it("derives OAuth state from the verified instructor principal", async () => {
    const response = responseDouble();
    const request = verifiedRequest();

    await controller.authorize(request, response, {
      user_id: "1",
      course_id: "course-1",
      redirect_url: "/custom-return?tab=oauth"
    });

    const redirectUrl = new URL(response.redirect.mock.calls[0][0]);
    expect(redirectUrl.href).toContain("https://canvas.example.edu/login/oauth2/auth");
    expect(redirectUrl.searchParams.get("client_id")).toBe("client-1");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe("https://tool.example.edu/api/oauth2callback");
    expect(redirectUrl.searchParams.get("state")).toBe("oauth-state");
    expect(redirectUrl.searchParams.get("scope")).toBe(canvasScopes().join(" "));
    expect(ltiState.createState).toHaveBeenCalledWith({
      purpose: "canvas-oauth-v2",
      canvasUserId: "1",
      ltiSubject: "lti-subject-1",
      courseId: "course-1",
      issuer: "https://canvas.example.edu",
      deploymentId: "deployment-1",
      sessionBinding: sessionBinding("session-1"),
      redirectUrl: "/custom-return?tab=oauth"
    });
  });

  it("allows omitted identity hints but never lets query parameters choose the principal", async () => {
    const response = responseDouble();

    await controller.authorize(verifiedRequest(), response, { redirect_url: "https://attacker.example/steal" });

    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasUserId: "1",
        courseId: "course-1",
        redirectUrl: "/lti/launch"
      })
    );
    expect(response.redirect).toHaveBeenCalledOnce();
  });

  it.each([
    ["mismatched user", { user_id: "attacker", course_id: "course-1" }],
    ["mismatched course", { user_id: "1", course_id: "attacker-course" }]
  ])("rejects a %s before creating OAuth state", async (_label, query) => {
    const response = responseDouble();

    await controller.authorize(verifiedRequest(), response, query);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(ltiState.createState).not.toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it("requires a verified instructor session to begin OAuth", async () => {
    const anonymousResponse = responseDouble();
    await controller.authorize({ session: {}, sessionID: "anonymous" } as any, anonymousResponse, {});
    expect(anonymousResponse.status).toHaveBeenCalledWith(401);

    const learnerResponse = responseDouble();
    await controller.authorize(verifiedRequest({ roles: [learnerRole] }), learnerResponse, {});
    expect(learnerResponse.status).toHaveBeenCalledWith(403);

    expect(ltiState.createState).not.toHaveBeenCalled();
    expect(canvasApi.clearAccessToken).not.toHaveBeenCalled();
  });

  it("binds student session authorization to the active learner and requests only the session-token scope", async () => {
    const studentController = new OAuthController(configDouble() as any, canvasApi as any, ltiState as any);
    const response = responseDouble();

    await studentController.studentSessionAuthorize(verifiedRequest({ roles: [learnerRole] }), response);

    const redirectUrl = new URL(response.redirect.mock.calls[0][0]);
    expect(redirectUrl.searchParams.get("scope")).toBe(studentSessionScopes().join(" "));
    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "canvas-student-session-oauth-v1",
        canvasUserId: "1",
        courseId: "course-1",
        redirectUrl: "/lti/launch?connected=1"
      })
    );
  });

  it("allows every verified learner to begin required student session authorization", async () => {
    const response = responseDouble();

    await controller.studentSessionAuthorize(verifiedRequest({ roles: [learnerRole] }), response);

    expect(response.redirect).toHaveBeenCalledOnce();
    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "canvas-student-session-oauth-v1" })
    );
  });

  it("returns a newly connected student to the signed direct assessment, not a client-selected destination", async () => {
    const response = responseDouble();
    const request = verifiedRequest({ roles: [learnerRole] });
    request.session.launchData.targetLinkUri = "https://tool.example.edu/seb/launch/classicquiz_23455";

    await controller.studentSessionAuthorize(request, response);

    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "canvas-student-session-oauth-v1",
        redirectUrl: "/seb/launch/classicquiz_23455?connected=1"
      })
    );
  });

  it("does not use an untrusted launch target as a student OAuth return destination", async () => {
    const response = responseDouble();
    const request = verifiedRequest({ roles: [learnerRole] });
    request.session.launchData.targetLinkUri = "https://attacker.example/seb/launch/classicquiz_23455";

    await controller.studentSessionAuthorize(request, response);

    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUrl: "/lti/launch?connected=1" })
    );
  });

  it("rejects a direct return intent when the saved launch no longer matches the active course", async () => {
    const response = responseDouble();
    const request = verifiedRequest({ roles: [learnerRole] });
    request.session.launchData.targetLinkUri = "https://tool.example.edu/seb/launch/classicquiz_23455";
    request.session.launchData.courseId = "other-course";

    await controller.studentSessionAuthorize(request, response);

    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUrl: "/lti/launch?connected=1" })
    );
  });

  it("does not create a shared empty-session binding when the Express session id is absent", async () => {
    const request = verifiedRequest();
    delete request.sessionID;
    const response = responseDouble();

    await controller.authorize(request, response, {});

    expect(response.status).toHaveBeenCalledWith(401);
    expect(ltiState.createState).not.toHaveBeenCalled();
  });

  it("rejects authorization when OAuth configuration is missing", async () => {
    const missingConfig = new OAuthController(
      {
        ...configDouble(),
        value: { ...configDouble().value, canvas: { ...configDouble().value.canvas, oauthClientId: "" } }
      } as any,
      canvasApi as any,
      ltiState as any
    );
    const response = responseDouble();

    await missingConfig.authorize(verifiedRequest(), response, {});

    expect(response.status).toHaveBeenCalledWith(500);
    expect(ltiState.createState).not.toHaveBeenCalled();
  });

  it("reauthorizes without deleting the existing credential before a replacement succeeds", async () => {
    const response = responseDouble();

    await controller.reauthorize(verifiedRequest(), response, {
      user_id: "1",
      course_id: "course-1"
    });

    expect(canvasApi.clearAccessToken).not.toHaveBeenCalled();
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledOnce();
  });

  it("rejects attacker-selected reauthorization identities without deleting any token", async () => {
    const response = responseDouble();

    await controller.reauthorize(verifiedRequest(), response, {
      user_id: "attacker",
      course_id: "course-1"
    });

    expect(response.status).toHaveBeenCalledWith(403);
    expect(canvasApi.clearAccessToken).not.toHaveBeenCalled();
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
    expect(ltiState.createState).not.toHaveBeenCalled();
  });

  it("stores a callback token only under its verified Canvas owner and does not restore session roles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      tokenResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: "scope-1",
        expires_in: 3600,
        user: { id: 1 }
      })
    );
    ltiState.peekState.mockReturnValue(validState());
    const request = verifiedRequest();
    const originalSession = structuredClone(request.session);
    const response = responseDouble();

    await controller.callback(request, response, { code: "oauth-code", state: "state" });

    expect(fetch).toHaveBeenCalledWith(
      "https://canvas.example.edu/login/oauth2/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(ltiState.claimState).toHaveBeenCalledWith("state");
    expect(canvasApi.storeAccessToken).toHaveBeenCalledWith("1", "access-token", {
      refreshToken: "refresh-token",
      scope: "scope-1",
      requestedScopes: canvasScopes(),
      oauthScopeVersion: CANVAS_OAUTH_SCOPE_VERSION,
      expiresIn: 3600
    });
    expect(request.session).toEqual({
      ...originalSession,
      oauthCallbackResume: {
        canvasUserId: "1",
        ltiSubject: "lti-subject-1",
        courseId: "course-1",
        issuer: "https://canvas.example.edu",
        deploymentId: "deployment-1",
        path: "/lti/launch",
        issuedAt: expect.any(Number)
      }
    });
    expect(response.redirect).toHaveBeenCalledWith("/lti/launch");
  });

  it("stores the verified Canvas name and bound LTI email alongside an OAuth token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      tokenResponse({
        access_token: "access-token",
        user: { id: 1, name: "Canvas Display Name" }
      })
    );
    ltiState.peekState.mockReturnValue(validState());
    const request = verifiedRequest();
    Object.assign(request.session.launchData, {
      canvasUserId: "1",
      ltiSubject: "lti-subject-1",
      issuer: "https://canvas.example.edu",
      fullName: "LTI Display Name",
      email: "learner@example.edu"
    });

    await controller.callback(request, responseDouble(), { code: "oauth-code", state: "state" });

    expect(canvasApi.storeAccessToken).toHaveBeenCalledWith(
      "1",
      "access-token",
      expect.objectContaining({
        displayName: "Canvas Display Name",
        email: "learner@example.edu"
      })
    );
  });

  it("does not create an iframe-resume marker for an unrelated safe local redirect", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      tokenResponse({ access_token: "access-token", refresh_token: "refresh-token", user: { id: 1 } })
    );
    ltiState.peekState.mockReturnValue(validState({ redirectUrl: "/setup" }));
    const request = verifiedRequest();
    const response = responseDouble();

    await controller.callback(request, response, { code: "oauth-code", state: "state" });

    expect(request.session.oauthCallbackResume).toBeUndefined();
    expect(response.redirect).toHaveBeenCalledWith("/setup");
  });

  it("renders a popup completion page after student session authorization", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      tokenResponse({ access_token: "student-token", scope: studentSessionScopes().join(" "), user: { id: 1 } })
    );
    ltiState.peekState.mockReturnValue(validState({ purpose: "canvas-student-session-oauth-v1" }));
    const response = responseDouble();

    await controller.callback(verifiedRequest({ roles: [learnerRole] }), response, {
      code: "oauth-code",
      state: "state"
    });

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"student-session-connected"'));
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it("rejects a callback completed in a different session before token exchange", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    ltiState.peekState.mockReturnValue(validState({ sessionBinding: sessionBinding("other-session") }));
    const request = verifiedRequest();
    const originalSession = structuredClone(request.session);
    const response = responseDouble();

    await controller.callback(request, response, { code: "oauth-code", state: "state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ltiState.claimState).not.toHaveBeenCalled();
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
    expect(request.session).toEqual(originalSession);
  });

  it.each([
    ["user", { canvasUserId: "attacker" }],
    ["course", { courseId: "attacker-course" }],
    ["issuer", { issuer: "https://attacker.example" }],
    ["deployment", { deploymentId: "attacker-deployment" }],
    ["LTI subject", { ltiSubject: "attacker-subject" }]
  ])("rejects callback state with a mismatched %s before token exchange", async (_label, stateOverride) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    ltiState.peekState.mockReturnValue(validState(stateOverride));
    const response = responseDouble();

    await controller.callback(verifiedRequest(), response, { code: "oauth-code", state: "state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ltiState.claimState).not.toHaveBeenCalled();
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ["another Canvas user", { user: { id: "attacker" } }],
    ["a response without an owner", {}]
  ])("rejects a token owned by %s without replacing the existing credential", async (_label, tokenOverride) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      tokenResponse({ access_token: "attacker-token", ...tokenOverride })
    );
    ltiState.peekState.mockReturnValue(validState());
    const request = verifiedRequest();
    const originalSession = structuredClone(request.session);
    const response = responseDouble();

    await controller.callback(request, response, { code: "oauth-code", state: "state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
    expect(canvasApi.clearAccessToken).not.toHaveBeenCalled();
    expect(request.session).toEqual(originalSession);
  });

  it("maps a stalled OAuth exchange to a safe error and never retries the code", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(new UpstreamRequestTimeoutError());
    });
    ltiState.peekState.mockReturnValue(validState());
    const response = responseDouble();

    await controller.callback(verifiedRequest(), response, { code: "oauth-code", state: "state" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Canvas authorization could not be verified"));
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
  });

  it("does not retry an OAuth code exchange rejected by Canvas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 } as Response);
    ltiState.peekState.mockReturnValue(validState());
    const response = responseDouble();

    await controller.callback(verifiedRequest(), response, { code: "oauth-code", state: "state" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Canvas authorization could not be verified"));
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
  });

  it("rejects oversized OAuth responses without retaining or reflecting their contents", async () => {
    const sentinel = "OAUTH-UPSTREAM-SECRET-SENTINEL";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: sentinel, padding: "x".repeat(70_000), user: { id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    ltiState.peekState.mockReturnValue(validState());
    const response = responseDouble();

    await controller.callback(verifiedRequest(), response, { code: "oauth-code", state: "state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send.mock.calls[0][0]).not.toContain(sentinel);
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
  });

  it("rejects malformed OAuth JSON without reflecting parser input", async () => {
    const sentinel = "MALFORMED-OAUTH-SECRET-SENTINEL";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`{"access_token":"${sentinel}",`, {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    ltiState.peekState.mockReturnValue(validState());
    const response = responseDouble();

    await controller.callback(verifiedRequest(), response, { code: "oauth-code", state: "state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send.mock.calls[0][0]).not.toContain(sentinel);
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
  });

  it("leaves credentials and session identity unchanged when the state claim detects replay", async () => {
    ltiState.peekState.mockReturnValue(validState());
    ltiState.claimState.mockRejectedValue(new Error("Invalid or already consumed LTI state"));
    const request = verifiedRequest();
    const originalSession = structuredClone(request.session);
    const response = responseDouble();

    await controller.callback(request, response, { code: "oauth-code", state: "replayed-state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
    expect(canvasApi.clearAccessToken).not.toHaveBeenCalled();
    expect(request.session).toEqual(originalSession);
  });

  it("renders Canvas denial without changing credentials", async () => {
    const response = responseDouble();

    await controller.callback(verifiedRequest(), response, {
      error: "access_denied",
      error_description: "Denied by Canvas"
    });

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"oauth-error"'));
    expect(ltiState.peekState).not.toHaveBeenCalled();
    expect(ltiState.claimState).not.toHaveBeenCalled();
    expect(canvasApi.storeAccessToken).not.toHaveBeenCalled();
    expect(canvasApi.clearAccessToken).not.toHaveBeenCalled();
  });

  it("reports status only for the verified instructor and never enumerates another user", async () => {
    await expect(controller.status(verifiedRequest(), "1")).resolves.toEqual({ authorized: true });
    expect(canvasApi.hasAccessToken).toHaveBeenCalledWith("1");

    canvasApi.hasAccessToken.mockClear();
    await expect(controller.status(verifiedRequest(), "attacker-selected-user")).resolves.toEqual({
      authorized: false
    });
    await expect(controller.status({ session: {} } as any, "1")).resolves.toEqual({ authorized: false });
    await expect(controller.status(verifiedRequest({ roles: [learnerRole] }), "1")).resolves.toEqual({
      authorized: false
    });
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
  });
});

function verifiedRequest(
  principalOverrides: Partial<{
    issuer: string;
    deploymentId: string;
    subject: string;
    canvasUserId: string;
    courseId: string;
    roles: string[];
    custom: Record<string, string>;
  }> = {}
): any {
  return {
    sessionID: "session-1",
    session: {
      launchData: {
        userId: "1",
        courseId: "course-1",
        deploymentId: "deployment-1",
        roles: [instructorRole]
      },
      verifiedLtiPrincipal: {
        version: 1,
        issuer: "https://canvas.example.edu",
        deploymentId: "deployment-1",
        subject: "lti-subject-1",
        canvasUserId: "1",
        courseId: "course-1",
        roles: [instructorRole],
        custom: {},
        authenticatedAt: "2026-07-13T00:00:00.000Z",
        ...principalOverrides
      }
    }
  };
}

function validState(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    purpose: "canvas-oauth-v2",
    canvasUserId: "1",
    ltiSubject: "lti-subject-1",
    courseId: "course-1",
    issuer: "https://canvas.example.edu",
    deploymentId: "deployment-1",
    sessionBinding: sessionBinding("session-1"),
    redirectUrl: "/lti/launch",
    ...overrides
  };
}

function sessionBinding(sessionId: string): string {
  return createHash("sha256").update(`canvas-oauth-session:${sessionId}`, "utf8").digest("base64url");
}

function tokenResponse(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

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
