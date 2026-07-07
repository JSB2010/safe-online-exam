import { describe, expect, it, vi } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CanvasApiService } from "../../src/server/services/canvas-api.service.js";
import { ContentService } from "../../src/server/services/content.service.js";

describe("ContentService", () => {
  it("combines classic and New Quiz content and seeds New Quiz settings", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([{ id: "42", title: "Classic Quiz", courseId: "course-7" }]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([
        {
          id: "newquiz:course-7:99",
          courseId: "course-7",
          canvasId: "99",
          assignmentId: "99",
          contentType: "NEW_QUIZ",
          title: "New Quiz"
        }
      ])
    } as unknown as CanvasApiService;
    const service = new ContentService(repos, canvas);

    const content = await service.getAllContentForCourse("course-7", "user-1");

    expect(content.map((item) => item.id)).toEqual(["classicquiz_42", "newquiz:course-7:99"]);
    await expect(service.getSebSetting("newquiz:course-7:99")).resolves.toMatchObject({
      contentId: "newquiz:course-7:99",
      contentType: "NEW_QUIZ"
    });
  });

  it("invalidates stored Config Keys when SEB-affecting content settings change", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      getQuizzesForCourse: vi.fn().mockResolvedValue([]),
      getNewQuizAssignments: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new ContentService(repos, canvas);
    await service.saveSebSetting({
      contentId: "newquiz:course-7:99",
      courseId: "course-7",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: ["domain:docs.example.edu"],
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: []
    });

    const saved = await service.saveSebSetting({
      contentId: "newquiz:course-7:99",
      courseId: "course-7",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: ["domain:calc.example.edu"],
      urlRules: [{ id: "calc", match: "domain", value: "calc.example.edu" }],
      externalTools: []
    });

    expect(saved.configKey).toBeNull();
  });
});
