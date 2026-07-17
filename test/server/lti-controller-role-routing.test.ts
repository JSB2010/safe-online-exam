import { beforeEach, describe, expect, it, vi } from "vitest";
import { LtiController } from "../../src/server/controllers/lti.controller.js";
import {
  createLtiOidcBrowserTransaction,
  LTI_OIDC_BROWSER_BINDING_FIELD,
  LTI_OIDC_TRANSACTION_ID_FIELD,
  ltiOidcTransactionCookieName,
  matchingLtiOidcBrowserTransactionCookie
} from "../../src/server/security/lti-oidc-browser-binding.js";
import type { VerifiedLtiPrincipal } from "../../src/server/security/verified-lti-principal.js";
import { defaultCourseSebDefaults } from "../../src/shared/models.js";
import type { LtiLaunchData } from "../../src/shared/models.js";

const BROWSER_TRANSACTION = createLtiOidcBrowserTransaction();

describe("LtiController role routing", () => {
  let controller: LtiController;
  let canvasApi: {
    hasAccessToken: ReturnType<typeof vi.fn>;
    hasSessionTokenAccess: ReturnType<typeof vi.fn>;
    hasDismissedStudentReadinessPrompt: ReturnType<typeof vi.fn>;
    updateStoredIdentity: ReturnType<typeof vi.fn>;
  };
  let ltiService: { validateToken: ReturnType<typeof vi.fn> };
  let ltiState: {
    createState: ReturnType<typeof vi.fn>;
    peekState: ReturnType<typeof vi.fn>;
    claimState: ReturnType<typeof vi.fn>;
  };
  let distributedAdmission: {
    consumeLtiLoginIp: ReturnType<typeof vi.fn>;
    consumeLtiValidationIp: ReturnType<typeof vi.fn>;
    consumeLtiStateValidationAttempt: ReturnType<typeof vi.fn>;
  };
  let assessments: {
    refreshCourseContent: ReturnType<typeof vi.fn>;
    getQuizzesForCourse: ReturnType<typeof vi.fn>;
    getCachedContentForCourse: ReturnType<typeof vi.fn>;
    getSebSettingForQuiz: ReturnType<typeof vi.fn>;
    getContentSebSetting: ReturnType<typeof vi.fn>;
    getQuiz: ReturnType<typeof vi.fn>;
    isAssessmentAvailableForLearner: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    canvasApi = {
      hasAccessToken: vi.fn().mockResolvedValue(true),
      hasSessionTokenAccess: vi.fn().mockResolvedValue(true),
      hasDismissedStudentReadinessPrompt: vi.fn().mockResolvedValue(false),
      updateStoredIdentity: vi.fn().mockResolvedValue(undefined)
    };
    ltiService = { validateToken: vi.fn() };
    ltiState = {
      createState: vi.fn().mockResolvedValue("encoded-state"),
      peekState: vi.fn().mockReturnValue({
        nonce: "nonce-1",
        issuer: "https://canvas.example.test",
        deploymentId: "deployment-1",
        targetLinkUri: "https://tool.example.test/lti/launch",
        [LTI_OIDC_TRANSACTION_ID_FIELD]: BROWSER_TRANSACTION.transactionId,
        [LTI_OIDC_BROWSER_BINDING_FIELD]: BROWSER_TRANSACTION.bindingHash
      }),
      claimState: vi.fn().mockResolvedValue(undefined)
    };
    distributedAdmission = {
      consumeLtiLoginIp: vi.fn().mockResolvedValue(true),
      consumeLtiValidationIp: vi.fn().mockResolvedValue(true),
      consumeLtiStateValidationAttempt: vi.fn().mockResolvedValue(true)
    };
    assessments = {
      refreshCourseContent: vi.fn().mockResolvedValue({ classicQuizzes: [], contentItems: [] }),
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getCachedContentForCourse: vi.fn().mockResolvedValue([]),
      getSebSettingForQuiz: vi.fn().mockResolvedValue(null),
      getContentSebSetting: vi.fn().mockResolvedValue(null),
      getQuiz: vi.fn().mockResolvedValue(null),
      isAssessmentAvailableForLearner: vi.fn().mockResolvedValue(true)
    };
    controller = new LtiController(
      {
        getApplicationBaseUrl: () => "https://tool.example.test",
        getRequiredToolUrl: () => "https://tool.example.test",
        value: {
          lti: {
            authUrl: "https://canvas.example.test/api/lti/authorize_redirect",
            clientId: "client-1",
            issuer: "https://canvas.example.test",
            deploymentId: "deployment-1"
          },
          security: { sessionSecret: "test-secret" },
          seb: { defaultQuitPassword: "managed-server-exit" }
        }
      } as any,
      ltiService as any,
      ltiState as any,
      assessments as any,
      canvasApi as any,
      {
        ensureDefaults: vi.fn().mockResolvedValue(defaultCourseSebDefaults("course-1")),
        getDefaults: vi.fn().mockResolvedValue(defaultCourseSebDefaults("course-1"))
      } as any,
      { isRequestFromSeb: vi.fn().mockReturnValue(false) } as any,
      distributedAdmission as any
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
    expect(canvasApi.hasSessionTokenAccess).toHaveBeenCalledWith("student-1");
    expect(canvasApi.hasDismissedStudentReadinessPrompt).toHaveBeenCalledWith("student-1");
  });

  it("requires Canvas session authorization before rendering the student tool", async () => {
    canvasApi.hasSessionTokenAccess.mockResolvedValue(false);
    const response = responseDouble();

    await controller.launchGet(
      requestDouble({
        userId: "student-1",
        courseId: "course-1",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]
      }),
      response
    );

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"student-session-authorization"'));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"resumeAssessment":false'));
    expect(response.send).not.toHaveBeenCalledWith(expect.stringContaining('"view":"student"'));
    expect(assessments.getQuizzesForCourse).not.toHaveBeenCalled();
  });

  it("does not re-show the optional setup-check prompt after a student dismisses it", async () => {
    canvasApi.hasDismissedStudentReadinessPrompt.mockResolvedValue(true);
    const response = responseDouble();

    await controller.launchGet(
      requestDouble({
        userId: "student-1",
        courseId: "course-1",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]
      }),
      response,
      undefined,
      undefined,
      "1"
    );

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"readinessRecommended":false'));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"showReadinessPrompt":false'));
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
    expect(ltiState.createState).toHaveBeenCalledWith({
      nonce: expect.any(String),
      targetLinkUri: "https://tool.example.test/lti/launch",
      issuer: "https://canvas.example.test",
      deploymentId: "deployment-1",
      [LTI_OIDC_TRANSACTION_ID_FIELD]: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
      [LTI_OIDC_BROWSER_BINDING_FIELD]: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u)
    });
    const issuedState = ltiState.createState.mock.calls[0][0] as Record<string, string>;
    const [cookieName, cookieValue, cookieOptions] = response.cookie.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>
    ];
    expect(cookieName).toBe(ltiOidcTransactionCookieName(issuedState[LTI_OIDC_TRANSACTION_ID_FIELD]));
    expect(cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(cookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 600_000
    });
    expect(
      matchingLtiOidcBrowserTransactionCookie({ cookies: { [cookieName]: cookieValue } } as any, issuedState)
    ).toBe(cookieName);
  });

  it("overwrites one fixed transaction cookie across repeated login initiations", async () => {
    const loginRequest = {
      query: {
        iss: "https://canvas.example.test",
        login_hint: "hint-1",
        target_link_uri: "https://tool.example.test/lti/launch",
        lti_deployment_id: "deployment-1"
      },
      session: {}
    } as any;
    const firstResponse = responseDouble();
    const secondResponse = responseDouble();

    await controller.loginGet(loginRequest, firstResponse);
    await controller.loginGet(loginRequest, secondResponse);

    const [firstCookieName, firstCookieValue] = firstResponse.cookie.mock.calls[0] as [string, string];
    const [secondCookieName, secondCookieValue] = secondResponse.cookie.mock.calls[0] as [string, string];
    const firstState = ltiState.createState.mock.calls[0][0] as Record<string, string>;
    const secondState = ltiState.createState.mock.calls[1][0] as Record<string, string>;
    const cookiesAfterSecondLogin = { [secondCookieName]: secondCookieValue };

    expect(firstCookieName).toBe("__Host-seb-lti-oidc");
    expect(secondCookieName).toBe(firstCookieName);
    expect(secondCookieValue).not.toBe(firstCookieValue);
    expect(matchingLtiOidcBrowserTransactionCookie({ cookies: cookiesAfterSecondLogin } as any, firstState)).toBeNull();
    expect(matchingLtiOidcBrowserTransactionCookie({ cookies: cookiesAfterSecondLogin } as any, secondState)).toBe(
      secondCookieName
    );
  });

  it("explains how to authorize an otherwise valid Canvas deployment", async () => {
    const response = responseDouble();
    const request = {
      query: {
        iss: "https://canvas.example.test",
        login_hint: "hint-1",
        target_link_uri: "https://tool.example.test/lti/launch",
        lti_deployment_id: "new-course-deployment"
      },
      session: {}
    } as any;

    await controller.loginGet(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("LTI Deployment Configuration Required"));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("LTI_DEPLOYMENT_ID"));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("without removing existing IDs"));
    expect(ltiState.createState).not.toHaveBeenCalled();
  });

  it("accepts an unlisted Canvas deployment at login when checking is explicitly disabled", async () => {
    (controller as any).config.value.lti.deploymentIdCheckingEnabled = false;
    const response = responseDouble();
    const request = {
      query: {
        iss: "https://canvas.example.test",
        login_hint: "hint-1",
        target_link_uri: "https://tool.example.test/lti/launch",
        lti_deployment_id: "course-installed-deployment"
      },
      session: {}
    } as any;

    await controller.loginGet(request, response);

    expect(response.redirect).toHaveBeenCalled();
    expect(ltiState.createState).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "course-installed-deployment" })
    );
  });

  it("keeps invalid platform or target errors generic", async () => {
    const response = responseDouble();
    const request = {
      query: {
        iss: "https://canvas.example.test",
        login_hint: "hint-1",
        target_link_uri: "https://attacker.example/lti/launch",
        lti_deployment_id: "deployment-1"
      },
      session: {}
    } as any;

    await controller.loginGet(request, response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Invalid LTI platform or target"));
    expect(response.send).not.toHaveBeenCalledWith(expect.stringContaining("LTI Deployment Configuration Required"));
    expect(ltiState.createState).not.toHaveBeenCalled();
  });

  it("bounds public login envelopes and applies distributed admission before issuing state", async () => {
    const oversizedResponse = responseDouble();
    await controller.loginGet(
      {
        query: {
          iss: "https://canvas.example.test",
          login_hint: "x".repeat(4_097),
          target_link_uri: "https://tool.example.test/lti/launch",
          lti_deployment_id: "deployment-1"
        }
      } as any,
      oversizedResponse
    );

    expect(oversizedResponse.status).toHaveBeenCalledWith(400);
    expect(distributedAdmission.consumeLtiLoginIp).not.toHaveBeenCalled();
    expect(ltiState.createState).not.toHaveBeenCalled();

    distributedAdmission.consumeLtiLoginIp.mockResolvedValue(false);
    const limitedResponse = responseDouble();
    await controller.loginGet(
      {
        query: {
          iss: "https://canvas.example.test",
          login_hint: "hint-1",
          target_link_uri: "https://tool.example.test/lti/launch",
          lti_deployment_id: "deployment-1"
        }
      } as any,
      limitedResponse
    );

    expect(limitedResponse.status).toHaveBeenCalledWith(429);
    expect(ltiState.createState).not.toHaveBeenCalled();
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
    const metadata = controller.ltiConfig();
    expect(metadata).toMatchObject({
      title: "Safe Exam Browser Canvas Integration",
      oidc_initiation_url: "https://tool.example.test/lti/login",
      target_link_uri: "https://tool.example.test/lti/launch",
      public_jwk_url: "https://tool.example.test/.well-known/jwks.json",
      extensions: [
        expect.objectContaining({
          platform: "canvas.instructure.com",
          privacy_level: "public",
          settings: expect.objectContaining({
            placements: [
              expect.objectContaining({
                placement: "course_navigation",
                visibility: "members",
                default: "enabled",
                enabled: true,
                custom_fields: expect.objectContaining({
                  canvas_course_id: "$Canvas.course.id",
                  canvas_user_id: "$Canvas.user.id"
                })
              })
            ]
          })
        })
      ],
      custom_fields: expect.objectContaining({
        canvas_course_id: "$Canvas.course.id",
        canvas_user_id: "$Canvas.user.id"
      })
    });
    const placement = metadata.extensions[0].settings.placements.find(
      (candidate: { placement?: string }) => candidate.placement === "course_navigation"
    );
    expect(placement).not.toHaveProperty("windowTarget");
  });

  it("accepts a cross-site signed POST and returns removed deep-linking guidance", async () => {
    ltiService.validateToken.mockResolvedValue({
      ltiSubject: "opaque-teacher-1",
      canvasUserId: "42",
      issuer: "https://canvas.example.test",
      userId: "42",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
      deploymentId: "deployment-1",
      targetLinkUri: "https://tool.example.test/lti/launch",
      messageType: "LtiDeepLinkingRequest"
    });
    const response = responseDouble();
    const request = emptySessionRequest();
    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "cross-site"
      })[name.toLowerCase()];

    await controller.launchPost(request, response, { id_token: "token", state: "state" });

    expect(ltiState.peekState).toHaveBeenCalledWith("state");
    expect(ltiState.claimState).toHaveBeenCalledWith("state");
    expect(ltiService.validateToken).toHaveBeenCalledWith("token", "nonce-1");
    expect(response.clearCookie).toHaveBeenCalledWith(BROWSER_TRANSACTION.cookieName, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/"
    });
    expect(request.session.regenerate).toHaveBeenCalled();
    expect(request.session.verifiedLtiPrincipal).toMatchObject({
      subject: "opaque-teacher-1",
      canvasUserId: "42",
      courseId: "course-1",
      deploymentId: "deployment-1"
    });
    expect(response.status).toHaveBeenCalledWith(410);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Deep Linking Removed"));
  });

  it.each([
    ["missing", {}],
    ["mismatched", { [BROWSER_TRANSACTION.cookieName]: "x".repeat(43) }]
  ])(
    "rejects a launch with a %s initiating-browser cookie before validating or claiming state",
    async (_label, cookies) => {
      const response = responseDouble();
      const request = emptySessionRequest(cookies);

      await controller.launchPost(request, response, { id_token: "token", state: "stolen-state" });

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.send).toHaveBeenCalledWith(expect.stringContaining("signed Canvas launch could not be verified"));
      expect(distributedAdmission.consumeLtiStateValidationAttempt).not.toHaveBeenCalled();
      expect(ltiService.validateToken).not.toHaveBeenCalled();
      expect(ltiState.claimState).not.toHaveBeenCalled();
      expect(request.session.regenerate).not.toHaveBeenCalled();
      expect(request.session.verifiedLtiPrincipal).toBeUndefined();
      expect(response.clearCookie).not.toHaveBeenCalled();
    }
  );

  it("does not clear the browser transaction or install a principal when the atomic state claim fails", async () => {
    ltiService.validateToken.mockResolvedValue({
      ltiSubject: "opaque-teacher-1",
      canvasUserId: "42",
      issuer: "https://canvas.example.test",
      userId: "42",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
      deploymentId: "deployment-1",
      targetLinkUri: "https://tool.example.test/lti/launch",
      messageType: "LtiResourceLinkRequest"
    });
    ltiState.claimState.mockRejectedValue(new Error("Invalid or already consumed LTI state"));
    const response = responseDouble();
    const request = emptySessionRequest();

    await controller.launchPost(request, response, { id_token: "token", state: "replayed-state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(request.session.regenerate).not.toHaveBeenCalled();
    expect(request.session.verifiedLtiPrincipal).toBeUndefined();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it("preserves a valid cross-site POST launch and same-origin session reload", async () => {
    ltiService.validateToken.mockResolvedValue({
      ltiSubject: "opaque-teacher-1",
      canvasUserId: "42",
      issuer: "https://canvas.example.test",
      userId: "42",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
      fullName: "Canvas Teacher",
      email: "teacher@example.edu",
      deploymentId: "deployment-1",
      targetLinkUri: "https://tool.example.test/lti/launch",
      messageType: "LtiResourceLinkRequest"
    });
    const launchResponse = responseDouble();
    const request = emptySessionRequest();
    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "cross-site"
      })[name.toLowerCase()];

    await controller.launchPost(request, launchResponse, { id_token: "token", state: "state" });

    expect(launchResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"teacher"'));
    expect(request.session.verifiedLtiPrincipal).toMatchObject({ canvasUserId: "42", courseId: "course-1" });
    expect(canvasApi.updateStoredIdentity).toHaveBeenCalledWith("42", {
      displayName: "Canvas Teacher",
      email: "teacher@example.edu"
    });

    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "same-origin"
      })[name.toLowerCase()];
    const reloadResponse = responseDouble();
    await controller.launchGet(request, reloadResponse);

    expect(reloadResponse.send).toHaveBeenCalledWith(expect.stringContaining('"view":"teacher"'));
  });

  it("turns a signed assessment target into a one-time direct SEB launch handoff", async () => {
    const targetLinkUri = "https://tool.example.test/seb/launch/classicquiz_23455";
    ltiState.peekState.mockReturnValue({
      nonce: "nonce-1",
      issuer: "https://canvas.example.test",
      deploymentId: "deployment-1",
      targetLinkUri,
      [LTI_OIDC_TRANSACTION_ID_FIELD]: BROWSER_TRANSACTION.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: BROWSER_TRANSACTION.bindingHash
    });
    ltiService.validateToken.mockResolvedValue({
      ltiSubject: "opaque-student-1",
      canvasUserId: "43",
      issuer: "https://canvas.example.test",
      userId: "43",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      deploymentId: "deployment-1",
      targetLinkUri,
      messageType: "LtiResourceLinkRequest"
    });
    const request = emptySessionRequest();
    const response = responseDouble();

    await controller.launchPost(request, response, { id_token: "token", state: "state" });

    expect(request.session.save).toHaveBeenCalled();
    expect(request.session.pendingSebLaunch).toMatchObject({
      courseId: "course-1",
      contentId: "classicquiz_23455",
      subject: "opaque-student-1",
      deploymentId: "deployment-1"
    });
    expect(response.redirect).toHaveBeenCalledWith(303, "/seb/launch/classicquiz_23455");
    expect(response.send).not.toHaveBeenCalled();
  });

  it("requires Canvas session authorization before a direct SEB assessment launch", async () => {
    const targetLinkUri = "https://tool.example.test/seb/launch/classicquiz_23455";
    canvasApi.hasSessionTokenAccess.mockResolvedValue(false);
    ltiState.peekState.mockReturnValue({
      nonce: "nonce-1",
      issuer: "https://canvas.example.test",
      deploymentId: "deployment-1",
      targetLinkUri,
      [LTI_OIDC_TRANSACTION_ID_FIELD]: BROWSER_TRANSACTION.transactionId,
      [LTI_OIDC_BROWSER_BINDING_FIELD]: BROWSER_TRANSACTION.bindingHash
    });
    ltiService.validateToken.mockResolvedValue({
      ltiSubject: "opaque-student-1",
      canvasUserId: "43",
      issuer: "https://canvas.example.test",
      userId: "43",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      deploymentId: "deployment-1",
      targetLinkUri,
      messageType: "LtiResourceLinkRequest"
    });
    const request = emptySessionRequest();
    const response = responseDouble();

    await controller.launchPost(request, response, { id_token: "token", state: "state" });

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"student-session-authorization"'));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"resumeAssessment":true'));
    expect(response.redirect).not.toHaveBeenCalled();
    expect(request.session.pendingSebLaunch).toBeUndefined();
  });

  it("fails closed with Canvas configuration guidance when the signed numeric user id is absent", async () => {
    ltiService.validateToken.mockResolvedValue({
      ltiSubject: "opaque-teacher-1",
      issuer: "https://canvas.example.test",
      userId: "opaque-teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
      deploymentId: "deployment-1",
      targetLinkUri: "https://tool.example.test/lti/launch",
      messageType: "LtiResourceLinkRequest",
      custom: {}
    });
    const response = responseDouble();
    const request = emptySessionRequest();

    await controller.launchPost(request, response, { id_token: "token", state: "state" });

    expect(ltiState.claimState).toHaveBeenCalledWith("state");
    expect(response.clearCookie).toHaveBeenCalled();
    expect(request.session.regenerate).toHaveBeenCalled();
    expect(request.session.verifiedLtiPrincipal).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Canvas Configuration Error"));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("refresh this tool's LTI Developer Key"));
    expect(response.send).not.toHaveBeenCalledWith(expect.stringContaining("opaque-teacher-1"));
  });

  it("stops repeated invalid JWTs for one state before another token validation", async () => {
    ltiService.validateToken.mockRejectedValue(new Error("invalid signature"));
    distributedAdmission.consumeLtiStateValidationAttempt
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await controller.launchPost(emptySessionRequest(), responseDouble(), {
        id_token: "invalid-token",
        state: "same-valid-encrypted-state"
      });
    }

    expect(ltiService.validateToken).toHaveBeenCalledTimes(5);
    expect(ltiState.claimState).not.toHaveBeenCalled();
  });

  it("explains an undersized Canvas platform signing key without exposing verifier details", async () => {
    ltiService.validateToken.mockRejectedValue(new Error("RS256 requires key modulusLength to be 2048 bits or larger"));
    const response = responseDouble();

    await controller.launchPost(emptySessionRequest(), response, { id_token: "token", state: "state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Canvas Signing-Key Error"));
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("smaller than 2048 bits"));
    expect(response.send).not.toHaveBeenCalledWith(expect.stringContaining("modulusLength"));
  });

  it("does not claim state or install a principal when signed launch claims differ from the login context", async () => {
    ltiService.validateToken.mockResolvedValue({
      ltiSubject: "opaque-teacher-1",
      canvasUserId: "42",
      issuer: "https://canvas.example.test",
      userId: "42",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
      deploymentId: "attacker-deployment",
      targetLinkUri: "https://tool.example.test/lti/launch",
      messageType: "LtiResourceLinkRequest"
    });
    const response = responseDouble();
    const request = emptySessionRequest();

    await controller.launchPost(request, response, { id_token: "token", state: "state" });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("signed Canvas launch could not be verified"));
    expect(response.send).not.toHaveBeenCalledWith(expect.stringContaining("attacker-deployment"));
    expect(ltiState.claimState).not.toHaveBeenCalled();
    expect(request.session.regenerate).not.toHaveBeenCalled();
    expect(request.session.verifiedLtiPrincipal).toBeUndefined();
  });

  it("rejects a queried identity mismatch without rewriting the verified launch session", async () => {
    const response = responseDouble();
    const request = requestDouble({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });

    await controller.launchGet(request, response, "course-1", "student-1");

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Forbidden"));
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
    expect(request.session.launchData?.roles).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]);
    expect(request.session.launchData?.userId).toBe("teacher-1");
    expect(request.session.verifiedLtiPrincipal.canvasUserId).toBe("teacher-1");
  });

  it("redirects unauthenticated GET launches instead of minting a session from query parameters", async () => {
    const response = responseDouble();
    const request = { session: {}, sessionID: "attacker-session" } as any;

    await controller.launchGet(request, response, "course-1", "teacher-1");

    expect(response.redirect).toHaveBeenCalledWith("/login");
    expect(request.session.launchData).toBeUndefined();
    expect(request.session.verifiedLtiPrincipal).toBeUndefined();
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
  });

  it("does not elevate forged launchData roles above the verified learner principal", async () => {
    const instructorRole = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
    const learnerRole = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
    const response = responseDouble();
    const request = requestDouble(
      { userId: "student-1", courseId: "course-1", roles: [instructorRole] },
      { roles: [learnerRole] }
    );

    await controller.launchGet(request, response);

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"student"'));
    expect(canvasApi.hasSessionTokenAccess).toHaveBeenCalledWith("student-1");
  });

  it("rejects cross-site iframe GET launches before reusing an authenticated session", async () => {
    const response = responseDouble();
    const request = requestDouble({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });
    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "cross-site"
      })[name.toLowerCase()];

    await controller.launchGet(request, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining("Reopen this tool from Canvas"));
    expect(response.send).not.toHaveBeenCalledWith(expect.stringContaining('"view":"teacher"'));
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
    expect(assessments.refreshCourseContent).not.toHaveBeenCalled();
  });

  it("allows exactly one cross-site Canvas iframe resume after a bound instructor OAuth callback", async () => {
    const response = responseDouble();
    const request = requestDouble({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });
    request.session.oauthCallbackResume = {
      canvasUserId: "teacher-1",
      ltiSubject: "opaque-teacher-1",
      courseId: "course-1",
      issuer: "https://canvas.example.test",
      deploymentId: "deployment-1",
      path: "/lti/launch",
      issuedAt: Date.now()
    };
    request.session.save = vi.fn((callback: (error?: Error) => void) => callback());
    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "cross-site"
      })[name.toLowerCase()];

    await controller.launchGet(request, response);

    expect(request.session.oauthCallbackResume).toBeUndefined();
    expect(request.session.save).toHaveBeenCalled();
    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"teacher"'));
    expect(canvasApi.hasAccessToken).toHaveBeenCalledWith("teacher-1");
  });

  it("rejects a cross-site iframe resume marker that is not bound to the active instructor course", async () => {
    const response = responseDouble();
    const request = requestDouble({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });
    request.session.oauthCallbackResume = {
      canvasUserId: "teacher-1",
      ltiSubject: "opaque-teacher-1",
      courseId: "other-course",
      issuer: "https://canvas.example.test",
      deploymentId: "deployment-1",
      path: "/lti/launch",
      issuedAt: Date.now()
    };
    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "cross-site"
      })[name.toLowerCase()];

    await controller.launchGet(request, response);

    expect(request.session.oauthCallbackResume).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
  });

  it("rejects an expired cross-site iframe OAuth resume marker", async () => {
    const response = responseDouble();
    const request = requestDouble({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });
    request.session.oauthCallbackResume = {
      canvasUserId: "teacher-1",
      ltiSubject: "opaque-teacher-1",
      courseId: "course-1",
      issuer: "https://canvas.example.test",
      deploymentId: "deployment-1",
      path: "/lti/launch",
      issuedAt: Date.now() - 120_001
    };
    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "cross-site"
      })[name.toLowerCase()];

    await controller.launchGet(request, response);

    expect(request.session.oauthCallbackResume).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(canvasApi.hasAccessToken).not.toHaveBeenCalled();
  });

  it("renders the teacher view only when the launch has an instructor role", async () => {
    const response = responseDouble();
    const request = requestDouble({
      userId: "teacher-1",
      courseId: "course-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });
    request.header = (name: string) =>
      ({
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "same-origin"
      })[name.toLowerCase()];

    await controller.launchGet(request, response);

    const html = response.send.mock.calls[0][0] as string;
    expect(html).toContain('"view":"teacher"');
    expect(html).toContain('"hasEffectiveQuitPassword":true');
    expect(html).not.toContain("managed-server-exit");
    expect(canvasApi.hasAccessToken).toHaveBeenCalledWith("teacher-1");
  });

  it("renders only enabled SEB assessments for student course launches", async () => {
    assessments.getQuizzesForCourse.mockResolvedValue([
      { id: "103", courseId: "course-2", title: "Cross-course Classic", htmlUrl: "https://canvas.example/quizzes/103" },
      { id: "102", courseId: "course-1", title: "Beta Classic", htmlUrl: "https://canvas.example/quizzes/102" },
      { id: "101", courseId: "course-1", title: "Alpha Classic", htmlUrl: "https://canvas.example/quizzes/101" }
    ]);
    assessments.getCachedContentForCourse.mockResolvedValue([
      {
        id: "newquiz:course-1:99",
        courseId: "course-1",
        canvasId: "99",
        assignmentId: "99",
        title: "Gamma New Quiz",
        contentType: "NEW_QUIZ",
        htmlUrl: "https://canvas.example/assignments/99"
      },
      {
        id: "newquiz:course-2:100",
        courseId: "course-2",
        canvasId: "100",
        assignmentId: "100",
        title: "Cross-course New Quiz",
        contentType: "NEW_QUIZ",
        htmlUrl: "https://canvas.example/assignments/100"
      }
    ]);
    assessments.getSebSettingForQuiz.mockImplementation(async (quizId: string) =>
      quizId === "101"
        ? { quizId, courseId: "course-1", sebRequired: true, enabled: true, accessCode: "ACCESS" }
        : { quizId, courseId: "course-1", sebRequired: false, enabled: false }
    );
    assessments.getContentSebSetting.mockResolvedValue({
      contentId: "newquiz:course-1:99",
      courseId: "course-1",
      assignmentId: "99",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS"
    });
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
    expect(html).not.toContain("Cross-course Classic");
    expect(html).not.toContain("Cross-course New Quiz");
    expect(html.indexOf("Alpha Classic")).toBeLessThan(html.indexOf("Gamma New Quiz"));
    expect(html).not.toContain("?grant=");
  });

  it("does not list enabled settings whose Canvas presence is stale or unavailable", async () => {
    assessments.getQuizzesForCourse.mockResolvedValue([{ id: "101", courseId: "course-1", title: "Stale Classic" }]);
    assessments.getSebSettingForQuiz.mockResolvedValue({
      quizId: "101",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "STALE-ACCESS"
    });
    assessments.isAssessmentAvailableForLearner.mockResolvedValue(false);
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
    expect(html).not.toContain("Stale Classic");
    expect(assessments.getSebSettingForQuiz).not.toHaveBeenCalled();
  });

  it("renders the SEB-required screen for targeted student launches outside SEB", async () => {
    assessments.getQuiz.mockResolvedValue({
      id: "23455",
      courseId: "course-1",
      title: "Midterm",
      htmlUrl: "https://canvas.example/quizzes/23455"
    });
    assessments.getSebSettingForQuiz.mockResolvedValue({
      quizId: "23455",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS"
    });
    const response = responseDouble();

    await controller.launchGet(
      requestDouble({
        userId: "student-1",
        courseId: "course-1",
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
        custom: { quiz_id: "23455" }
      }),
      response
    );

    expect(response.send).toHaveBeenCalledWith(expect.stringContaining('"view":"seb-required"'));
    expect(response.send).toHaveBeenCalledWith(
      expect.stringContaining("/api/seb/config-grant/course-1/classicquiz_23455")
    );
  });
});

function requestDouble(launchDataInput: LtiLaunchData, principalOverrides: Partial<VerifiedLtiPrincipal> = {}): any {
  const launchData: LtiLaunchData = {
    ltiSubject: `opaque-${launchDataInput.userId}`,
    canvasUserId: launchDataInput.userId,
    issuer: "https://canvas.example.test",
    deploymentId: "deployment-1",
    targetLinkUri: "https://tool.example.test/lti/launch",
    custom: {},
    ...launchDataInput
  };
  const principal: VerifiedLtiPrincipal = {
    version: 1,
    issuer: launchData.issuer!,
    deploymentId: launchData.deploymentId!,
    subject: launchData.ltiSubject!,
    canvasUserId: launchData.canvasUserId!,
    courseId: launchData.courseId!,
    roles: [...launchData.roles],
    custom: { ...(launchData.custom || {}) },
    authenticatedAt: "2026-01-01T00:00:00.000Z",
    ...principalOverrides
  };
  return {
    originalUrl: "/lti/launch",
    protocol: "https",
    get: () => "tool.example.test",
    sessionID: "session-1",
    session: { launchData, verifiedLtiPrincipal: principal }
  };
}

function emptySessionRequest(
  cookies: Record<string, string> = { [BROWSER_TRANSACTION.cookieName]: BROWSER_TRANSACTION.cookieValue }
): any {
  const session = {
    regenerate: vi.fn((callback: (error?: Error) => void) => callback()),
    save: vi.fn((callback: (error?: Error) => void) => callback())
  };
  return {
    originalUrl: "/lti/launch",
    protocol: "https",
    get: () => "tool.example.test",
    cookies,
    sessionID: "new-session-1",
    session
  };
}

function responseDouble(): any {
  const response = {
    send: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
    setHeader: vi.fn(),
    cookie: vi.fn(),
    clearCookie: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.setHeader.mockReturnValue(response);
  return response;
}
