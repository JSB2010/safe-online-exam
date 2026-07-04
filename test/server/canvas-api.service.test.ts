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

  it("removes generated-id legacy OAuth token documents before storing fresh tokens", async () => {
    repositories = createInMemoryRepositories({
      oauthTokens: { "legacy-doc": { id: null, userId: "legacy-user", accessToken: "old-token" } }
    });
    service = new CanvasApiService(new AppConfig(), { value: repositories } as RepositoryProvider);

    await service.storeAccessToken("legacy-user", "new-token");

    await expect(repositories.oauthTokens.get("legacy-doc")).resolves.toBeNull();
    await expect(repositories.oauthTokens.get("legacy-user")).resolves.toMatchObject({
      userId: "legacy-user",
      accessToken: "new-token"
    });
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

  it("clears stale OAuth tokens and raises an authorization error when Canvas rejects an invalid token", async () => {
    repositories = createInMemoryRepositories({
      oauthTokens: { "legacy-doc": { id: null, userId: "legacy-user", accessToken: "bad-token" } }
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
    await expect(repositories.oauthTokens.find([{ field: "userId", op: "==", value: "legacy-user" }])).resolves.toEqual(
      []
    );
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
