import { describe, expect, it } from "vitest";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import { SebSessionHandoffService } from "../../src/server/services/seb-session-handoff.service.js";

describe("SebSessionHandoffService", () => {
  it("accepts a registered Config Key only for its course, content, settings, and Canvas quiz URL", async () => {
    const repositories = createInMemoryRepositories();
    const configKey = new SebConfigKeyService();
    const service = new SebSessionHandoffService({ value: repositories } as RepositoryProvider, configKey);
    const configKeyValue = "a".repeat(64);
    const returnTo = "https://canvas.example.edu/courses/1/quizzes/2/take";

    await service.registerConfig("course-1", "classicquiz_2", "settings-1", configKeyValue, returnTo);

    const hash = configKey.hashForUrl(returnTo, configKeyValue);
    await expect(service.resolveConfigKey("course-1", "classicquiz_2", "settings-1", hash, returnTo)).resolves.toBe(
      configKeyValue
    );
    await expect(
      service.resolveConfigKey("course-1", "classicquiz_2", "settings-2", hash, returnTo)
    ).resolves.toBeNull();
    await expect(
      service.resolveConfigKey("course-2", "classicquiz_2", "settings-1", hash, returnTo)
    ).resolves.toBeNull();
  });

  it("permits the expected Canvas URL with query parameters through its registered queryless proof hash", async () => {
    const repositories = createInMemoryRepositories();
    const configKey = new SebConfigKeyService();
    const service = new SebSessionHandoffService({ value: repositories } as RepositoryProvider, configKey);
    const configKeyValue = "b".repeat(64);
    const returnTo = "https://canvas.example.edu/courses/1/quizzes/2/take";
    const actualUrl = `${returnTo}?attempt=1`;

    await service.registerConfig("course-1", "classicquiz_2", "settings-1", configKeyValue, returnTo);

    const querylessHash = configKey.hashForUrl(returnTo, configKeyValue);
    await expect(
      service.resolveConfigKey("course-1", "classicquiz_2", "settings-1", querylessHash, actualUrl)
    ).resolves.toBe(configKeyValue);
  });

  it("accepts a New Quiz attempt URL reached after Canvas leaves the registered assignment route", async () => {
    const repositories = createInMemoryRepositories();
    const configKey = new SebConfigKeyService();
    const service = new SebSessionHandoffService({ value: repositories } as RepositoryProvider, configKey);
    const configKeyValue = "c".repeat(64);
    const contentId = "newquiz:11825:437577";
    const returnTo = "https://canvas.example.edu/courses/11825/assignments/437577";
    const attemptUrl = `${returnTo}/taking/31358`;

    await service.registerConfig("11825", contentId, "settings-1", configKeyValue, returnTo);

    await expect(
      service.resolveConfigKey(
        "11825",
        contentId,
        "settings-1",
        configKey.hashForUrl(attemptUrl, configKeyValue),
        attemptUrl
      )
    ).resolves.toBe(configKeyValue);

    const otherAssignmentUrl = "https://canvas.example.edu/courses/11825/assignments/437578/taking/31358";
    await expect(
      service.resolveConfigKey(
        "11825",
        contentId,
        "settings-1",
        configKey.hashForUrl(otherAssignmentUrl, configKeyValue),
        otherAssignmentUrl
      )
    ).resolves.toBeNull();
  });
});
