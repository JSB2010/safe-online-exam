import { describe, expect, it } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CourseSettingsService } from "../../src/server/services/course-settings.service.js";
import {
  assessmentToContentSebSetting,
  assessmentToQuizSebSetting,
  assessmentWithContentSebSetting,
  assessmentWithQuizSebSetting
} from "../../src/shared/models.js";

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

  it("can save course defaults without propagating to existing assessments", async () => {
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
        configKey: "still-valid-for-existing-defaults"
      })
    );
    const service = new CourseSettingsService(repos);

    await service.saveDefaults(
      "course-1",
      {
        quitPassword: "new-password",
        setupCompleted: true,
        urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
        externalTools: []
      },
      { propagate: false }
    );

    const setting = assessmentToQuizSebSetting((await repos.value.assessments.get("classicquiz_defaulted"))!);
    expect(setting).toMatchObject({
      quitPassword: null,
      customDomains: [],
      configKey: "still-valid-for-existing-defaults"
    });
  });

  it("resets New Quiz settings to current course defaults and invalidates Config Keys", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new CourseSettingsService(repos);
    await service.saveDefaults(
      "course-1",
      {
        quitPassword: "default-exit",
        startPassword: "default-start",
        setupCompleted: true,
        urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
        externalTools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu", enabled: true }]
      },
      { propagate: false }
    );
    await repos.value.assessments.save(
      "newquiz:course-1:99",
      assessmentWithContentSebSetting(null, {
        contentId: "newquiz:course-1:99",
        courseId: "course-1",
        assignmentId: "99",
        canvasId: "99",
        contentType: "NEW_QUIZ",
        sebRequired: true,
        enabled: true,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: ["domain:custom.example.edu"],
        urlRules: [{ id: "custom", match: "domain", value: "custom.example.edu" }],
        externalTools: [],
        usesCourseDefaults: false,
        quitPasswordOverride: true,
        startPasswordOverride: true,
        quitPassword: "custom-exit",
        startPassword: "custom-start",
        configKey: "stored-config-key"
      })
    );

    const reset = await service.resetQuizToDefaults("course-1", "newquiz:course-1:99");
    const stored = assessmentToContentSebSetting((await repos.value.assessments.get("newquiz:course-1:99"))!);

    expect(reset).toMatchObject({
      contentId: "newquiz:course-1:99",
      quitPassword: "default-exit",
      startPassword: "default-start",
      customDomains: ["domain:docs.example.edu"],
      usesCourseDefaults: true,
      quitPasswordOverride: false,
      startPasswordOverride: false,
      configKey: null
    });
    expect(stored).toMatchObject(reset as Record<string, unknown>);
    expect(Buffer.from(stored.configKeySalt || "", "base64")).toHaveLength(32);
  });

  it("returns null when resetting defaults for unknown assessments", async () => {
    const service = new CourseSettingsService({ value: createInMemoryRepositories() } as RepositoryProvider);

    await expect(service.resetQuizToDefaults("course-1", "missing")).resolves.toBeNull();
  });
});
