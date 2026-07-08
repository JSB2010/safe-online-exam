import { describe, expect, it } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CourseSettingsService } from "../../src/server/services/course-settings.service.js";
import { assessmentToQuizSebSetting, assessmentWithQuizSebSetting } from "../../src/shared/models.js";

describe("CourseSettingsService", () => {
  it("propagates course defaults only to settings still using defaults", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    await repos.value.assessments.save(
      "classicquiz_defaulted",
      assessmentWithQuizSebSetting(null, {
        quizId: "defaulted",
        courseId: "course-1",
        sebRequired: true,
        enabled: true,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: [],
        usesCourseDefaults: true,
        configKey: "defaulted-config-key"
      })
    );
    await repos.value.assessments.save(
      "classicquiz_custom",
      assessmentWithQuizSebSetting(null, {
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
        quitPasswordOverride: false,
        configKey: "custom-config-key"
      })
    );
    const service = new CourseSettingsService(repos);

    await service.saveDefaults("course-1", {
      quitPassword: "course-password",
      startPassword: "course-start",
      setupCompleted: true,
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu", enabled: true }]
    });

    const defaulted = assessmentToQuizSebSetting((await repos.value.assessments.get("classicquiz_defaulted"))!);
    const custom = assessmentToQuizSebSetting((await repos.value.assessments.get("classicquiz_custom"))!);

    expect(defaulted).toMatchObject({
      quitPassword: "course-password",
      startPassword: "course-start",
      customDomains: ["domain:docs.example.edu"],
      usesCourseDefaults: true,
      configKey: null
    });
    expect(custom).toMatchObject({
      quitPassword: "course-password",
      startPassword: "course-start",
      customDomains: ["domain:custom.example.edu"],
      usesCourseDefaults: false,
      configKey: null
    });
    expect(Buffer.from(defaulted?.configKeySalt || "", "base64")).toHaveLength(32);
    expect(Buffer.from(custom?.configKeySalt || "", "base64")).toHaveLength(32);
  });
});
