import { describe, expect, it } from "vitest";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { proofDocumentId, SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";

describe("SebAccessProofService", () => {
  it("mints single-use tokens bound to course and content across service instances", async () => {
    const repositories = createInMemoryRepositories();
    const firstInstance = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const secondInstance = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const token = await firstInstance.mintProof("course-1", "quiz-1");

    await expect(secondInstance.consumeProof(token, "course-2", "quiz-1")).resolves.toBe(false);
    await expect(firstInstance.consumeProof(token, "course-1", "quiz-1")).resolves.toBe(false);

    const valid = await firstInstance.mintProof("course-1", "quiz-1");
    await expect(secondInstance.consumeProof(valid, "course-1", "quiz-1")).resolves.toBe(true);
    await expect(firstInstance.consumeProof(valid, "course-1", "quiz-1")).resolves.toBe(false);
  });

  it("rejects expired proof tokens", async () => {
    const repositories = createInMemoryRepositories();
    const service = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const token = await service.mintProof("course-1", "quiz-1");
    const stored = await repositories.transientStates.get(proofDocumentId(token));
    await repositories.transientStates.save(proofDocumentId(token), {
      ...stored!,
      expiresAt: new Date(Date.now() - 1000)
    });

    await expect(service.consumeProof(token, "course-1", "quiz-1")).resolves.toBe(false);
  });

  it("rejects missing proof tokens", async () => {
    const service = new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);

    await expect(service.consumeProof(undefined, "course-1", "quiz-1")).resolves.toBe(false);
  });
});
