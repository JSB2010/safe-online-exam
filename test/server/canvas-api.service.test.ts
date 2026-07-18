import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { UpstreamRequestTimeoutError } from "../../src/server/http/upstream-deadline.js";
import {
  CANVAS_API_RESPONSE_MAX_BYTES,
  CANVAS_OAUTH_RESPONSE_MAX_BYTES,
  CanvasApiService
} from "../../src/server/services/canvas-api.service.js";
import { CANVAS_OAUTH_SCOPE_VERSION, CANVAS_REQUIRED_OAUTH_SCOPES } from "../../src/shared/models.js";

const currentOAuthScopeOptions = {
  requestedScopes: [...CANVAS_REQUIRED_OAUTH_SCOPES],
  oauthScopeVersion: CANVAS_OAUTH_SCOPE_VERSION
};

describe("CanvasApiService", () => {
  let service: CanvasApiService;
  let repositories: ReturnType<typeof createInMemoryRepositories>;

  beforeEach(async () => {
    process.env.CANVAS_API_BASE_URL = "https://canvas.example.com/api/v1";
    process.env.CANVAS_BASE_URL = "https://canvas.example.com";
    process.env.CANVAS_API_CLIENT_ID = "client-1";
    process.env.CANVAS_API_CLIENT_SECRET = "secret-1";
    repositories = createInMemoryRepositories();
    const provider = { value: repositories } as RepositoryProvider;
    service = new CanvasApiService(new AppConfig(), provider);
    await service.storeAccessToken("user-1", "token-1");
    vi.restoreAllMocks();
  });

  it("fetches classic quizzes from Canvas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([
        {
          id: 42,
          title: "Classic Quiz",
          html_url: "https://canvas.example.com/quizzes/42",
          published: true,
          unlock_at: "2026-01-01T00:00:00Z",
          lock_at: "2026-12-31T00:00:00Z"
        }
      ])
    );

    await expect(service.getQuizzesForCourse("course-7", "user-1")).resolves.toEqual([
      expect.objectContaining({
        id: "42",
        quizTypeDisplay: "Classic Quiz",
        published: true,
        unlockAt: "2026-01-01T00:00:00Z",
        lockAt: "2026-12-31T00:00:00Z"
      })
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://canvas.example.com/api/v1/courses/course-7/quizzes?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer token-1" })
      })
    );
  });

  it("browses bounded active administrator course pages with Canvas-side filters", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        Array.from({ length: 25 }, (_, index) => ({
          id: index + 1,
          name: `Course ${index + 1}`,
          course_code: `CODE-${index + 1}`,
          account_id: 7,
          root_account_id: 7,
          workflow_state: "available",
          enrollment_term_id: 22,
          term: { id: 22, name: "Fall 2026" },
          teachers: [{ display_name: "Teacher One" }]
        }))
      )
    );

    const result = await service.getAdminCoursesPage("7", "user-1", {
      search: "Biology",
      termId: "22",
      includeUnpublished: true,
      perPage: 25
    });
    expect(result.courses).toHaveLength(25);
    expect(result).toMatchObject({
      courses: expect.arrayContaining([
        expect.objectContaining({
          id: "1",
          accountId: "7",
          rootAccountId: "7",
          termId: "22",
          termName: "Fall 2026",
          teacherNames: ["Teacher One"]
        })
      ]),
      nextPage: 2
    });
    const requested = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]));
    expect(requested.pathname).toBe("/api/v1/accounts/7/courses");
    expect(requested.searchParams.get("completed")).toBe("false");
    expect(requested.searchParams.get("with_enrollments")).toBe("true");
    expect(requested.searchParams.get("search_term")).toBe("Biology");
    expect(requested.searchParams.get("enrollment_term_id")).toBe("22");
    expect(requested.searchParams.has("published")).toBe(false);
  });

  it("loads active administrator enrollment terms", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        enrollment_terms: [
          {
            id: 22,
            name: "Fall 2026",
            start_at: "2026-08-01T00:00:00Z",
            end_at: "2026-12-20T00:00:00Z",
            workflow_state: "active"
          }
        ]
      })
    );

    await expect(service.getAdminEnrollmentTerms("7", "user-1")).resolves.toEqual([
      {
        id: "22",
        name: "Fall 2026",
        startAt: "2026-08-01T00:00:00Z",
        endAt: "2026-12-20T00:00:00Z",
        workflowState: "active"
      }
    ]);
  });

  it("reads every bounded Canvas discovery page before treating the collection as complete", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      title: `Quiz ${index + 1}`,
      published: true
    }));
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([{ id: 101, title: "Quiz 101", published: true }]));

    const quizzes = await service.getQuizzesForCourse("course-7", "user-1");

    expect(quizzes).toHaveLength(101);
    expect(quizzes[100]).toMatchObject({ id: "101", published: true });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://canvas.example.com/api/v1/courses/course-7/quizzes?per_page=100&page=2",
      expect.anything()
    );
  });

  it("builds New Quiz access-code PATCH payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    await service.setNewQuizAccessCode("course-7", "99", "ACCESS42", "user-1");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const params = init ? new URLSearchParams(String((init as RequestInit).body)) : new URLSearchParams();
    expect(params.get("quiz[quiz_settings][require_student_access_code]")).toBe("true");
    expect(params.get("quiz[quiz_settings][student_access_code]")).toBe("ACCESS42");
  });

  it("discovers and hydrates New Quiz assignments from Canvas", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 99,
            name: "Assignment-backed New Quiz",
            html_url: "https://canvas.example.com/courses/course-7/assignments/99",
            external_tool_tag_attributes: { url: "https://canvas.example.com/courses/course-7/external_tools/99" },
            is_quiz_assignment: true
          },
          {
            id: 100,
            name: "Plain Assignment",
            html_url: "https://canvas.example.com/courses/course-7/assignments/100"
          }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse({
          title: "Hydrated New Quiz",
          instructions: "<p>Instructions</p>",
          canvas_launch_url: "https://canvas.example.com/courses/course-7/assignments/99/take",
          resource_link_uuid: "resource-uuid",
          lookup_uuid: "lookup-uuid",
          quiz_settings: {
            require_student_access_code: true,
            student_access_code: "CANVAS-ACCESS-SECRET"
          },
          config_key: "CANVAS-CONFIG-SECRET"
        })
      );

    const assignments = await service.getNewQuizAssignments("course-7", "user-1");

    expect(assignments).toEqual([
      expect.objectContaining({
        id: "newquiz:course-7:99",
        assignmentId: "99",
        contentType: "NEW_QUIZ",
        title: "Hydrated New Quiz",
        description: "<p>Instructions</p>",
        canvasLaunchUrl: "https://canvas.example.com/courses/course-7/assignments/99/take",
        resourceLinkUuid: "resource-uuid",
        lookupUuid: "lookup-uuid",
        quizTypeDisplay: "New Quiz"
      })
    ]);
    expect(JSON.stringify(assignments)).not.toContain("CANVAS-ACCESS-SECRET");
    expect(JSON.stringify(assignments)).not.toContain("CANVAS-CONFIG-SECRET");
    expect(assignments[0]).not.toHaveProperty("metadata");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://canvas.example.com/api/v1/courses/course-7/assignments?per_page=100&new_quizzes=true",
      expect.anything()
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://canvas.example.com/api/quiz/v1/courses/course-7/quizzes/99",
      expect.anything()
    );
  });

  it("keeps New Quiz assignment fallbacks when detail hydration fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 99,
            name: "Fallback New Quiz",
            html_url: "https://canvas.example.com/courses/course-7/assignments/99",
            external_tool_tag_attributes: { url: "https://canvas.example.com/new_quizzes/99" }
          }
        ])
      )
      .mockResolvedValueOnce(textResponse("detail unavailable", 500));

    await expect(service.getNewQuizAssignments("course-7", "user-1")).resolves.toEqual([
      expect.objectContaining({
        id: "newquiz:course-7:99",
        title: "Fallback New Quiz",
        htmlUrl: "https://canvas.example.com/courses/course-7/assignments/99",
        canvasLaunchUrl: "https://canvas.example.com/new_quizzes/99"
      })
    ]);
  });

  it("stores OAuth token documents directly by Canvas user id", async () => {
    repositories = createInMemoryRepositories();
    service = new CanvasApiService(new AppConfig(), { value: repositories } as RepositoryProvider);

    await service.storeAccessToken("canvas-user", "new-token");

    await expect(repositories.oauthTokens.get("canvas-user")).resolves.toMatchObject({
      id: "canvas-user",
      userId: "canvas-user",
      accessToken: "new-token"
    });
  });

  it("upgrades one user token for course, student, and administrator contexts", async () => {
    repositories = createInMemoryRepositories();
    service = new CanvasApiService(new AppConfig(), { value: repositories } as RepositoryProvider);

    await service.storeAccessToken("canvas-user", "course-token", currentOAuthScopeOptions);
    await service.storeAccessToken("canvas-user", "student-token", {
      grantType: "student_session",
      scope: CANVAS_REQUIRED_OAUTH_SCOPES.join(" "),
      ...currentOAuthScopeOptions
    });
    await service.dismissStudentReadinessPrompt("canvas-user");
    await service.storeAccessToken("canvas-user", "admin-token", {
      grantType: "account_admin",
      requestedScopes: [
        "url:GET|/api/v1/accounts/:id",
        "url:GET|/api/v1/accounts/:account_id/permissions",
        "url:GET|/api/v1/courses/:id",
        ...CANVAS_REQUIRED_OAUTH_SCOPES
      ],
      oauthScopeVersion: CANVAS_OAUTH_SCOPE_VERSION
    });

    await expect(service.getAccessToken("canvas-user", "instructor")).resolves.toBe("admin-token");
    await expect(service.getAccessToken("canvas-user", "student_session")).resolves.toBe("admin-token");
    await expect(service.getAccessToken("canvas-user", "account_admin")).resolves.toBe("admin-token");
    await expect(repositories.oauthTokens.get("canvas-user")).resolves.toMatchObject({
      grantType: "account_admin",
      accessToken: "admin-token",
      studentReadinessPromptDismissedAt: expect.any(String)
    });
    await expect(repositories.oauthTokens.get("account_admin:canvas-user")).resolves.toBeNull();
    await expect(
      repositories.oauthTokens.find([{ field: "userId", op: "==", value: "canvas-user" }])
    ).resolves.toHaveLength(1);
  });

  it("creates a Canvas session URL only for a return target on the configured Canvas origin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        session_url:
          "https://canvas.example.com/login/session_token?return_to=https%3A%2F%2Fcanvas.example.com%2Fcourses%2F7"
      })
    );

    await expect(
      service.getSessionToken("user-1", "https://canvas.example.com/courses/7/quizzes/42/take")
    ).resolves.toBe(
      "https://canvas.example.com/login/session_token?return_to=https%3A%2F%2Fcanvas.example.com%2Fcourses%2F7"
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://canvas.example.com/api/v1/login/session_token?return_to=https%3A%2F%2Fcanvas.example.com%2Fcourses%2F7%2Fquizzes%2F42%2Ftake",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer token-1" }) })
    );
  });

  it("rejects a Canvas session handoff that would leave the configured Canvas origin", async () => {
    await expect(service.getSessionToken("user-1", "https://attacker.example/courses/7")).rejects.toMatchObject({
      name: "CanvasApiRequestError"
    });
  });

  it("does not reuse OAuth tokens after another instance clears them", async () => {
    const provider = { value: repositories } as RepositoryProvider;
    const firstInstance = new CanvasApiService(new AppConfig(), provider);
    const secondInstance = new CanvasApiService(new AppConfig(), provider);
    await firstInstance.storeAccessToken("shared-user", "shared-token");

    await expect(firstInstance.getAccessToken("shared-user")).resolves.toBe("shared-token");
    await secondInstance.clearAccessToken("shared-user");

    await expect(firstInstance.getAccessToken("shared-user")).resolves.toBeNull();
  });

  it("stores refresh token metadata returned by Canvas OAuth", async () => {
    const before = Date.now();

    const saved = await service.storeAccessToken("user-with-refresh", "access-token", {
      refreshToken: "refresh-token",
      scope: "url:GET|/api/v1/courses/:id",
      expiresIn: 3600
    });

    expect(saved).toMatchObject({
      userId: "user-with-refresh",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scope: "url:GET|/api/v1/courses/:id"
    });
    expect(Date.parse(saved.expiresAt || "")).toBeGreaterThan(before + 3_500_000);
  });

  it("stores OAuth tokens without undefined optional fields when Canvas omits scope", async () => {
    const saved = await service.storeAccessToken("user-without-scope", "token-without-scope");

    expect(saved).toMatchObject({
      userId: "user-without-scope",
      accessToken: "token-without-scope",
      scope: null
    });
    await expect(repositories.oauthTokens.get("user-without-scope")).resolves.toMatchObject({
      scope: null
    });
  });

  it("keeps verified identity fields in the OAuth token document", async () => {
    const saved = await service.storeAccessToken("identity-user", "identity-token", {
      displayName: "Ada Lovelace",
      email: "ada@example.edu"
    });

    expect(saved).toMatchObject({
      displayName: "Ada Lovelace",
      email: "ada@example.edu",
      identityUpdatedAt: expect.any(String)
    });

    await service.updateStoredIdentity("identity-user", {
      displayName: "  Ada   Byron  ",
      email: "ada.byron@example.edu"
    });

    await expect(repositories.oauthTokens.get("identity-user")).resolves.toMatchObject({
      accessToken: "identity-token",
      displayName: "Ada Byron",
      email: "ada.byron@example.edu",
      identityUpdatedAt: expect.any(String)
    });
  });

  it("requires the current unified OAuth scope contract for student session handoff", async () => {
    await service.storeAccessToken("scoped-user", "scoped-token", {
      scope: "url:GET|/api/v1/courses/:course_id/quizzes"
    });

    await expect(service.hasSessionTokenAccess("scoped-user")).resolves.toBe(false);
    await expect(service.hasAccessToken("scoped-user")).resolves.toBe(false);

    await service.storeAccessToken("scoped-user", "session-token", {
      scope: "url:GET|/api/v1/login/session_token",
      ...currentOAuthScopeOptions
    });
    await expect(service.hasSessionTokenAccess("scoped-user")).resolves.toBe(true);
    await expect(service.hasAccessToken("scoped-user")).resolves.toBe(true);
  });

  it("persists a student setup-check dismissal without treating it as device trust", async () => {
    await expect(service.hasDismissedStudentReadinessPrompt("user-1")).resolves.toBe(false);

    await service.dismissStudentReadinessPrompt("user-1");

    await expect(service.hasDismissedStudentReadinessPrompt("user-1")).resolves.toBe(true);
    await expect(repositories.oauthTokens.get("user-1")).resolves.toMatchObject({
      studentReadinessPromptDismissedAt: expect.any(String)
    });
  });

  it("refreshes expired OAuth access tokens before calling Canvas APIs", async () => {
    await service.storeAccessToken("refresh-user", "old-token", {
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      ...currentOAuthScopeOptions
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        oauthResponse({ access_token: "new-token", refresh_token: "new-refresh-token", expires_in: 3600 })
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 42, title: "Classic Quiz" }]));

    await expect(service.getQuizzesForCourse("course-7", "refresh-user")).resolves.toEqual([
      expect.objectContaining({ id: "42" })
    ]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://canvas.example.com/login/oauth2/token",
      expect.objectContaining({ method: "POST" })
    );
    const [, refreshInit] = vi.mocked(fetch).mock.calls[0];
    const refreshBody = new URLSearchParams(String((refreshInit as RequestInit).body));
    expect(refreshBody.get("grant_type")).toBe("refresh_token");
    expect(refreshBody.get("refresh_token")).toBe("refresh-token");
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://canvas.example.com/api/v1/courses/course-7/quizzes?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer new-token" })
      })
    );
    await expect(repositories.oauthTokens.get("refresh-user")).resolves.toMatchObject({
      accessToken: "new-token",
      refreshToken: "new-refresh-token",
      ...currentOAuthScopeOptions
    });
  });

  it("refreshes and retries once when Canvas rejects an expired access token", async () => {
    await service.storeAccessToken("retry-user", "old-token", {
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(textResponse('{"errors":[{"message":"Invalid access token."}]}', 401))
      .mockResolvedValueOnce(oauthResponse({ access_token: "new-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse([{ id: 42, title: "Classic Quiz" }]));

    await expect(service.getQuizzesForCourse("course-7", "retry-user")).resolves.toEqual([
      expect.objectContaining({ id: "42" })
    ]);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://canvas.example.com/api/v1/courses/course-7/quizzes?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer old-token" })
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://canvas.example.com/login/oauth2/token",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://canvas.example.com/api/v1/courses/course-7/quizzes?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer new-token" })
      })
    );
    await expect(repositories.oauthTokens.get("retry-user")).resolves.toMatchObject({
      accessToken: "new-token",
      refreshToken: "refresh-token"
    });
  });

  it("clears stale OAuth tokens and raises an authorization error when Canvas rejects an invalid token", async () => {
    repositories = createInMemoryRepositories({
      oauthTokens: { "legacy-user": { id: "legacy-user", userId: "legacy-user", accessToken: "bad-token" } }
    });
    service = new CanvasApiService(new AppConfig(), { value: repositories } as RepositoryProvider);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      textResponse('{"errors":[{"message":"Invalid access token."}]}', 401)
    );

    await expect(service.getQuizzesForCourse("course-7", "legacy-user")).rejects.toMatchObject({
      name: "CanvasApiAuthorizationError"
    });
    await expect(repositories.oauthTokens.get("legacy-user")).resolves.toBeNull();
  });

  it("keeps OAuth tokens and raises a permission error when Canvas denies a scoped request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      textResponse('{"errors":[{"message":"Insufficient scopes SECRET_SCOPE_BODY"}]}', 403)
    );

    const error = await service.setQuizAccessCode("course-7", "42", "ACCESS42", "user-1").catch((caught) => caught);
    expect(error).toMatchObject({
      name: "CanvasApiPermissionError",
      status: 403,
      responseBody: ""
    });
    expect(String(error)).not.toContain("SECRET_SCOPE_BODY");
    expect(JSON.stringify(error)).not.toContain("SECRET_SCOPE_BODY");
    await expect(repositories.oauthTokens.get("user-1")).resolves.toMatchObject({
      userId: "user-1",
      accessToken: "token-1"
    });
  });

  it("clears a student credential when Canvas rejects the session-token scope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("scope denied", 403));

    await expect(
      service.getSessionToken("user-1", "https://canvas.example.com/courses/7/quizzes/42/take")
    ).rejects.toMatchObject({ name: "CanvasApiPermissionError", status: 403 });
    await expect(repositories.oauthTokens.get("user-1")).resolves.toBeNull();
  });

  it("raises a request error for non-authorization Canvas API failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Canvas unavailable SECRET_UPSTREAM_SENTINEL", 500));

    const error = await service.getQuizzesForCourse("course-7", "user-1").catch((caught) => caught);
    expect(error).toMatchObject({
      name: "CanvasApiRequestError",
      message: "Canvas API request failed with status 500.",
      status: 500,
      responseBody: ""
    });
    expect(String(error)).not.toContain("SECRET_UPSTREAM_SENTINEL");
    expect(JSON.stringify(error)).not.toContain("SECRET_UPSTREAM_SENTINEL");
  });

  it("rejects oversized and malformed successful Canvas responses with sanitized errors", async () => {
    const responses = [
      new Response("SECRET_OVERSIZED_BODY", {
        status: 200,
        headers: { "content-length": String(CANVAS_API_RESPONSE_MAX_BYTES + 1) }
      }),
      textResponse("SECRET_INVALID_JSON", 200)
    ];

    for (const response of responses) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
      const error = await service.getQuizzesForCourse("course-7", "user-1").catch((caught) => caught);

      expect(error).toMatchObject({ name: "CanvasApiRequestError", status: 502, responseBody: "" });
      expect(String(error)).not.toMatch(/SECRET_(?:OVERSIZED_BODY|INVALID_JSON)/u);
      expect(JSON.stringify(error)).not.toMatch(/SECRET_(?:OVERSIZED_BODY|INVALID_JSON)/u);
    }
  });

  it("sanitizes Canvas fetch and response-stream failures", async () => {
    const streamFailure = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("SECRET_STREAM_FAILURE"));
        }
      }),
      { status: 200 }
    );
    const failures: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error("SECRET_NETWORK_FAILURE")),
      () => Promise.resolve(streamFailure)
    ];

    for (const failure of failures) {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(failure);
      const error = await service.getQuizzesForCourse("course-7", "user-1").catch((caught) => caught);

      expect(error).toMatchObject({ name: "CanvasApiRequestError", status: 502, responseBody: "" });
      expect(String(error)).not.toMatch(/SECRET_(?:NETWORK|STREAM)_FAILURE/u);
      expect(JSON.stringify(error)).not.toMatch(/SECRET_(?:NETWORK|STREAM)_FAILURE/u);
    }
  });

  it("does not parse or store oversized OAuth refresh responses", async () => {
    await service.storeAccessToken("oversized-refresh-user", "old-token", {
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response('{"access_token":"SECRET_OVERSIZED_OAUTH_TOKEN"}', {
          status: 200,
          headers: { "content-length": String(CANVAS_OAUTH_RESPONSE_MAX_BYTES + 1) }
        })
      )
      .mockResolvedValueOnce(jsonResponse([{ id: 42, title: "Classic Quiz" }]));

    await expect(service.getQuizzesForCourse("course-7", "oversized-refresh-user")).resolves.toEqual([
      expect.objectContaining({ id: "42" })
    ]);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://canvas.example.com/api/v1/courses/course-7/quizzes?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer old-token" })
      })
    );
    await expect(repositories.oauthTokens.get("oversized-refresh-user")).resolves.toMatchObject({
      accessToken: "old-token",
      refreshToken: "refresh-token"
    });
    expect(JSON.stringify(await repositories.oauthTokens.get("oversized-refresh-user"))).not.toContain(
      "SECRET_OVERSIZED_OAUTH_TOKEN"
    );
  });

  it("passes an abort deadline to Canvas and maps timeouts to a safe request error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(new UpstreamRequestTimeoutError());
    });

    await expect(service.getQuizzesForCourse("course-7", "user-1")).rejects.toMatchObject({
      name: "CanvasApiRequestError",
      message: "Canvas API request timed out.",
      status: 504,
      responseBody: ""
    });
  });

  it("never refreshes or replays a mutation after Canvas rejects its access token", async () => {
    await service.storeAccessToken("mutation-user", "old-token", {
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      textResponse('{"errors":[{"message":"Invalid access token."}]}', 401)
    );

    await expect(service.setQuizAccessCode("course-7", "42", "ACCESS42", "mutation-user")).rejects.toMatchObject({
      name: "CanvasApiAuthorizationError",
      status: 401
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://canvas.example.com/api/v1/courses/course-7/quizzes/42",
      expect.objectContaining({ method: "PUT", signal: expect.any(AbortSignal) })
    );
    await expect(repositories.oauthTokens.get("mutation-user")).resolves.toBeNull();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function oauthResponse(value: unknown): Response {
  return jsonResponse(value);
}

function textResponse(value: string, status: number): Response {
  return new Response(value, { status });
}
