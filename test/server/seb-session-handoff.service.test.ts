import { describe, expect, it, vi } from "vitest";
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

  it("revokes only the requested handoff configs when course state changes during generation", async () => {
    const repositories = createInMemoryRepositories();
    const configKey = new SebConfigKeyService();
    const service = new SebSessionHandoffService({ value: repositories } as RepositoryProvider, configKey);
    const firstConfigKey = "d".repeat(64);
    const secondConfigKey = "e".repeat(64);
    const returnTo = "https://canvas.example.edu/courses/1/quizzes/2/take";
    const firstHash = configKey.hashForUrl(returnTo, firstConfigKey);
    const secondHash = configKey.hashForUrl(returnTo, secondConfigKey);
    const firstDocumentIds = await service.registerConfig(
      "course-1",
      "classicquiz_2",
      "settings-1",
      firstConfigKey,
      returnTo
    );
    await service.registerConfig("course-1", "classicquiz_2", "settings-1", secondConfigKey, returnTo);

    await service.revokeConfigs(firstDocumentIds);

    await expect(
      service.resolveConfigKey("course-1", "classicquiz_2", "settings-1", firstHash, returnTo)
    ).resolves.toBeNull();
    await expect(
      service.resolveConfigKey("course-1", "classicquiz_2", "settings-1", secondHash, returnTo)
    ).resolves.toBe(secondConfigKey);
  });

  it("removes partial registrations when one handoff document cannot be claimed", async () => {
    const repositories = createInMemoryRepositories();
    const configKey = new SebConfigKeyService();
    const service = new SebSessionHandoffService({ value: repositories } as RepositoryProvider, configKey);
    const originalClaim = repositories.transientStates.claim.bind(repositories.transientStates);
    let claimCount = 0;
    vi.spyOn(repositories.transientStates, "claim").mockImplementation(async (id, value) => {
      claimCount += 1;
      return claimCount === 2 ? false : originalClaim(id, value);
    });

    await expect(
      service.registerConfig(
        "course-1",
        "classicquiz_2",
        "settings-1",
        "f".repeat(64),
        "https://canvas.example.edu/courses/1/quizzes/2/take?attempt=1"
      )
    ).rejects.toThrow("Unable to register SEB session handoff configuration");

    await expect(
      repositories.transientStates.find([{ field: "courseId", op: "==", value: "course-1" }])
    ).resolves.toEqual([]);
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
