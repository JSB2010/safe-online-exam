import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CourseSettingsService } from "../../src/server/services/course-settings.service.js";
import {
  assessmentToContentSebSetting,
  assessmentToQuizSebSetting,
  assessmentWithContentSebSetting,
  assessmentWithQuizSebSetting
} from "../../src/shared/models.js";

const originalServerQuitPassword = process.env.SEB_QUIT_PASSWORD;
const originalLegacyServerQuitPassword = process.env.DEFAULT_SEB_QUIT_PASSWORD;

beforeEach(() => {
  process.env.SEB_QUIT_PASSWORD = "managed-server-exit";
});

afterEach(() => {
  if (originalServerQuitPassword === undefined) {
    delete process.env.SEB_QUIT_PASSWORD;
  } else {
    process.env.SEB_QUIT_PASSWORD = originalServerQuitPassword;
  }
  if (originalLegacyServerQuitPassword === undefined) {
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
  } else {
    process.env.DEFAULT_SEB_QUIT_PASSWORD = originalLegacyServerQuitPassword;
  }
});

describe("CourseSettingsService", () => {
  it("persists the full disabled preset catalog when an instructor opens a new course", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new CourseSettingsService(repos);

    expect(await repos.value.courses.get("course-1")).toBeNull();
    const defaults = await service.ensureDefaults("course-1");

    expect(defaults.externalTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "desmos-graphing", enabled: false }),
        expect.objectContaining({ id: "desmos-scientific", enabled: false }),
        expect.objectContaining({ id: "geogebra-graphing", enabled: false }),
        expect.objectContaining({ id: "geogebra-scientific", enabled: false })
      ])
    );
    await expect(repos.value.courses.get("course-1")).resolves.toMatchObject({
      sebDefaults: { externalTools: expect.arrayContaining([expect.objectContaining({ id: "desmos-graphing" })]) }
    });
  });

  it("keeps preloaded tool edits and intentional deletion after a course save", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new CourseSettingsService(repos);
    const seeded = await service.ensureDefaults("course-1");
    const editedCatalog = seeded.externalTools
      .filter((tool) => tool.id !== "desmos-scientific")
      .map((tool) =>
        tool.id === "desmos-graphing"
          ? {
              ...tool,
              label: "District Graphing Calculator",
              url: "https://calculator.example.edu/graphing",
              allowedRules: [{ id: "assets", match: "path" as const, value: "https://calculator.example.edu/assets/*" }]
            }
          : tool
      );

    const saved = await service.saveDefaults("course-1", {
      setupCompleted: true,
      externalTools: editedCatalog
    });

    expect(saved.externalTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "desmos-graphing",
          label: "District Graphing Calculator",
          url: "https://calculator.example.edu/graphing"
        })
      ])
    );
    expect(saved.externalTools).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "desmos-scientific" })])
    );
    await expect(service.getDefaults("course-1")).resolves.toMatchObject({ externalTools: saved.externalTools });
  });

  it("rejects course-default and managed-fallback start/exit password collisions", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new CourseSettingsService(repos);

    await expect(
      service.saveDefaults("course-1", {
        quitPassword: "shared-course-passphrase",
        startPassword: "shared-course-passphrase",
        setupCompleted: true
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_PASSWORD_REUSE" }),
      status: 400
    });
    await expect(
      service.saveDefaults("course-1", {
        quitPassword: null,
        startPassword: "managed-server-exit",
        setupCompleted: true
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_PASSWORD_REUSE" }),
      status: 400
    });
    await expect(repos.value.courses.get("course-1")).resolves.toBeNull();
  });

  it("treats blank write-only course password updates as no change while preserving explicit removal", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new CourseSettingsService(repos);
    await service.saveDefaults(
      "course-1",
      {
        quitPassword: "unique-quit-passphrase",
        startPassword: "unique-start-passphrase",
        setupCompleted: true
      },
      { propagate: false }
    );

    await expect(
      service.saveDefaults(
        "course-1",
        { quitPassword: "   ", startPassword: "\t", setupCompleted: true },
        { propagate: false }
      )
    ).resolves.toMatchObject({
      quitPassword: "unique-quit-passphrase",
      startPassword: "unique-start-passphrase"
    });
    await expect(
      service.saveDefaults(
        "course-1",
        { quitPassword: null, startPassword: null, setupCompleted: true },
        { propagate: false }
      )
    ).resolves.toMatchObject({ quitPassword: null, startPassword: null });
  });

  it("rejects newly supplied weak course start and exit passwords without persisting them", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new CourseSettingsService(repos);

    for (const defaults of [{ quitPassword: "password1234" }, { startPassword: "password1" }]) {
      await expect(service.saveDefaults("course-1", { ...defaults, setupCompleted: true })).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: "SEB_PASSWORD_POLICY_VIOLATION" }),
        status: 400
      });
    }
    await expect(repos.value.courses.get("course-1")).resolves.toBeNull();
  });

  it("rejects clearing defaults when propagation would leave an enabled assessment passwordless", async () => {
    delete process.env.SEB_QUIT_PASSWORD;
    delete process.env.DEFAULT_SEB_QUIT_PASSWORD;
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    await repos.value.assessments.save(
      "classicquiz_defaulted",
      assessmentWithQuizSebSetting(null, {
        quizId: "defaulted",
        courseId: "course-1",
        sebRequired: true,
        enabled: true,
        quitPassword: "current-exit",
        quitPasswordOverride: false,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: [],
        usesCourseDefaults: true
      })
    );
    const service = new CourseSettingsService(repos);

    await expect(
      service.saveDefaults("course-1", {
        quitPassword: null,
        setupCompleted: true,
        urlRules: [],
        externalTools: []
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: "SEB_QUIT_PASSWORD_REQUIRED" }),
      status: 400
    });
    await expect(repos.value.courses.get("course-1")).resolves.toBeNull();
    await expect(repos.value.assessments.get("classicquiz_defaulted")).resolves.toMatchObject({
      seb: { quitPassword: "current-exit", required: true, enabled: true }
    });
  });

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

  it("keeps an explicit quiz tool selection while refreshing it from the current course catalog", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    await repos.value.assessments.save(
      "classicquiz_override",
      assessmentWithQuizSebSetting(null, {
        quizId: "override",
        courseId: "course-1",
        sebRequired: true,
        enabled: true,
        configKey: "stale-config-key",
        usesCourseDefaults: false,
        externalToolIds: ["desmos-graphing"],
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        urlRules: [],
        externalTools: []
      })
    );
    const service = new CourseSettingsService(repos);

    await service.saveDefaults("course-1", {
      quitPassword: "course-password",
      setupCompleted: true,
      externalTools: [{ id: "desmos-graphing", label: "ignored", url: "https://evil.example.edu", enabled: false }]
    });

    const setting = assessmentToQuizSebSetting((await repos.value.assessments.get("classicquiz_override"))!);
    expect(setting).toMatchObject({ externalToolIds: ["desmos-graphing"], configKey: null });
    expect(setting.externalTools.filter((tool) => tool.enabled)).toEqual([
      expect.objectContaining({ id: "desmos-graphing", url: "https://evil.example.edu/" })
    ]);
  });

  it("persists and propagates only canonical course URL policy", async () => {
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
        configKey: "stale-config-key"
      })
    );
    const service = new CourseSettingsService(repos);

    const saved = await service.saveDefaults("course-1", {
      setupCompleted: true,
      urlRules: [
        { id: "regex", match: "regex", value: "^https://.+$" },
        { id: "wildcard", match: "domain", value: "*.*" },
        { id: "exact", match: "exact", value: "https://tool.example.edu/start" },
        { id: "docs", match: "domain", value: "Docs.Example.Edu" }
      ],
      externalTools: [
        {
          id: "regex-tool",
          label: "Unsafe tool",
          url: "https://evil.example.edu/",
          enabled: true,
          matchType: "regex",
          allowedPattern: "^https://.+$",
          allowedDomains: ["regex:^https://.+$"]
        },
        {
          id: "desmos-calculator",
          label: "Changed",
          url: "https://evil.example.edu/",
          enabled: true,
          preset: "desmos-calculator",
          allowedDomains: ["regex:^https://.+$"]
        }
      ]
    });

    expect(saved.urlRules).toEqual([
      { id: "exact", match: "exact", value: "https://tool.example.edu/start" },
      { id: "docs", match: "domain", value: "docs.example.edu" }
    ]);
    expect(saved.externalTools).toHaveLength(1);
    expect(saved.externalTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "desmos-graphing",
          label: "Desmos Graphing Calculator",
          url: "https://www.desmos.com/calculator",
          preset: "desmos-graphing"
        })
      ])
    );

    const setting = assessmentToQuizSebSetting((await repos.value.assessments.get("classicquiz_defaulted"))!);
    expect(setting).toMatchObject({
      customDomains: ["exact:https://tool.example.edu/start", "domain:docs.example.edu"],
      urlRules: saved.urlRules,
      externalTools: saved.externalTools,
      configKey: null
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
        quitPassword: "custom-exit-secret",
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

  it("fails closed when stored course ownership or canonical quiz identity does not match the reset target", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const service = new CourseSettingsService(repos);

    await repos.value.assessments.save(
      "classicquiz_77",
      assessmentWithQuizSebSetting(null, {
        quizId: "77",
        courseId: "course-2",
        sebRequired: true,
        enabled: true,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: [],
        usesCourseDefaults: false,
        configKey: "classic-wrong-course"
      })
    );
    await repos.value.assessments.save(
      "classicquiz_78",
      assessmentWithQuizSebSetting(null, {
        quizId: "different-quiz",
        courseId: "course-1",
        sebRequired: true,
        enabled: true,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: [],
        usesCourseDefaults: false,
        configKey: "classic-wrong-identity"
      })
    );
    await repos.value.assessments.save(
      "newquiz:course-1:99",
      assessmentWithContentSebSetting(null, {
        contentId: "newquiz:course-1:99",
        courseId: "course-2",
        assignmentId: "99",
        canvasId: "99",
        contentType: "NEW_QUIZ",
        sebRequired: true,
        enabled: true,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: [],
        usesCourseDefaults: false,
        configKey: "new-quiz-wrong-course"
      })
    );
    await repos.value.assessments.save(
      "newquiz:course-1:100",
      assessmentWithContentSebSetting(null, {
        contentId: "newquiz:course-1:100",
        courseId: "course-1",
        assignmentId: "different-assignment",
        canvasId: "different-assignment",
        contentType: "NEW_QUIZ",
        sebRequired: true,
        enabled: true,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: [],
        usesCourseDefaults: false,
        configKey: "new-quiz-wrong-identity"
      })
    );

    await expect(service.resetQuizToDefaults("course-1", "77")).resolves.toBeNull();
    await expect(service.resetQuizToDefaults("course-1", "78")).resolves.toBeNull();
    await expect(service.resetQuizToDefaults("course-1", "newquiz:course-1:99")).resolves.toBeNull();
    await expect(service.resetQuizToDefaults("course-1", "newquiz:course-1:100")).resolves.toBeNull();

    await expect(repos.value.assessments.get("classicquiz_77")).resolves.toMatchObject({
      seb: { configKey: "classic-wrong-course", usesCourseDefaults: false }
    });
    await expect(repos.value.assessments.get("classicquiz_78")).resolves.toMatchObject({
      seb: { configKey: "classic-wrong-identity", usesCourseDefaults: false }
    });
    await expect(repos.value.assessments.get("newquiz:course-1:99")).resolves.toMatchObject({
      seb: { configKey: "new-quiz-wrong-course", usesCourseDefaults: false }
    });
    await expect(repos.value.assessments.get("newquiz:course-1:100")).resolves.toMatchObject({
      seb: { configKey: "new-quiz-wrong-identity", usesCourseDefaults: false }
    });
  });

  it("returns null when resetting defaults for unknown assessments", async () => {
    const service = new CourseSettingsService({ value: createInMemoryRepositories() } as RepositoryProvider);

    await expect(service.resetQuizToDefaults("course-1", "missing")).resolves.toBeNull();
  });
});
