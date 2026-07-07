import { describe, expect, it } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CourseSettingsService } from "../../src/server/services/course-settings.service.js";

describe("CourseSettingsService", () => {
  it("propagates course defaults only to settings still using defaults", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    await repos.value.quizSebSettings.save("defaulted", {
      quizId: "defaulted",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: [],
      usesCourseDefaults: true
    });
    await repos.value.quizSebSettings.save("custom", {
      quizId: "custom",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: ["domain:custom.example.edu"],
      urlRules: [{ id: "custom", match: "domain", value: "custom.example.edu" }],
      externalTools: [],
      usesCourseDefaults: false,
      quitPasswordOverride: false
    });
    const service = new CourseSettingsService(repos);

    await service.saveDefaults("course-1", {
      quitPassword: "course-password",
      setupCompleted: true,
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu", enabled: true }]
    });

    await expect(repos.value.quizSebSettings.get("defaulted")).resolves.toMatchObject({
      quitPassword: "course-password",
      customDomains: ["domain:docs.example.edu"],
      usesCourseDefaults: true
    });
    await expect(repos.value.quizSebSettings.get("custom")).resolves.toMatchObject({
      quitPassword: "course-password",
      customDomains: ["domain:custom.example.edu"],
      usesCourseDefaults: false
    });
  });
});
