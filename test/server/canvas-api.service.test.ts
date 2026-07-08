import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CanvasApiService } from "../../src/server/services/canvas-api.service.js";

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
      jsonResponse([{ id: 42, title: "Classic Quiz", html_url: "https://canvas.example.com/quizzes/42" }])
    );

    await expect(service.getQuizzesForCourse("course-7", "user-1")).resolves.toEqual([
      expect.objectContaining({ id: "42", quizTypeDisplay: "Classic Quiz" })
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://canvas.example.com/api/v1/courses/course-7/quizzes?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer token-1" })
      })
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

  it("refreshes expired OAuth access tokens before calling Canvas APIs", async () => {
    await service.storeAccessToken("refresh-user", "old-token", {
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() - 1000).toISOString()
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
      refreshToken: "new-refresh-token"
    });
  });

  it("refreshes and retries once when Canvas rejects an expired access token", async () => {
    await service.storeAccessToken("retry-user", "old-token", {
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"errors":[{"message":"Invalid access token."}]}'
      } as Response)
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"errors":[{"message":"Invalid access token."}]}'
    } as Response);

    await expect(service.getQuizzesForCourse("course-7", "legacy-user")).rejects.toMatchObject({
      name: "CanvasApiAuthorizationError"
    });
    await expect(repositories.oauthTokens.get("legacy-user")).resolves.toBeNull();
  });

  it("keeps OAuth tokens and raises a permission error when Canvas denies a scoped request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"errors":[{"message":"Insufficient scopes"}]}'
    } as Response);

    await expect(service.setQuizAccessCode("course-7", "42", "ACCESS42", "user-1")).rejects.toMatchObject({
      name: "CanvasApiPermissionError",
      status: 403,
      responseBody: '{"errors":[{"message":"Insufficient scopes"}]}'
    });
    await expect(repositories.oauthTokens.get("user-1")).resolves.toMatchObject({
      userId: "user-1",
      accessToken: "token-1"
    });
  });
});

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value)
  } as Response;
}

function oauthResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value
  } as Response;
}
