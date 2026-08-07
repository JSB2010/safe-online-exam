import { describe, expect, it } from "vitest";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import {
  exitGrantDocumentId,
  proofDocumentId,
  SebAccessProofService
} from "../../src/server/services/seb-access-proof.service.js";

describe("SebAccessProofService", () => {
  it("mints single-use tokens bound to course, content, and config generation across service instances", async () => {
    const repositories = createInMemoryRepositories();
    const firstInstance = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const secondInstance = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const token = await firstInstance.mintProof("course-1", "quiz-1", "generation-1", "settings-1");

    await expect(secondInstance.consumeProof(token, "course-2", "quiz-1", "settings-1")).resolves.toBeNull();
    await expect(firstInstance.consumeProof(token, "course-1", "quiz-1", "settings-1")).resolves.toBeNull();

    const stale = await firstInstance.mintProof("course-1", "quiz-1", "generation-1", "settings-1");
    await expect(secondInstance.consumeProof(stale, "course-1", "quiz-1", "settings-2")).resolves.toBeNull();

    const valid = await firstInstance.mintProof("course-1", "quiz-1", "generation-2", "settings-2");
    await expect(secondInstance.consumeProof(valid, "course-1", "quiz-1", "settings-2")).resolves.toBe("generation-2");
    await expect(firstInstance.consumeProof(valid, "course-1", "quiz-1", "settings-2")).resolves.toBeNull();
  });

  it("rejects expired proof tokens", async () => {
    const repositories = createInMemoryRepositories();
    const service = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const token = await service.mintProof("course-1", "quiz-1", "generation-1", "settings-1");
    const stored = await repositories.transientStates.get(proofDocumentId(token));
    await repositories.transientStates.save(proofDocumentId(token), {
      ...stored!,
      expiresAt: new Date(Date.now() - 1000)
    });

    await expect(service.consumeProof(token, "course-1", "quiz-1", "settings-1")).resolves.toBeNull();
  });

  it("rejects missing proof tokens", async () => {
    const service = new SebAccessProofService({ value: createInMemoryRepositories() } as RepositoryProvider);

    await expect(service.consumeProof(undefined, "course-1", "quiz-1", "settings-1")).resolves.toBeNull();
  });

  it("revokes proof and exit-grant tokens after a crossed course reset", async () => {
    const service = new SebAccessProofService({
      value: createInMemoryRepositories()
    } as RepositoryProvider);
    const proof = await service.mintProof("course-1", "quiz-1", "generation-1", "settings-1");
    const exitGrant = await service.mintExitGrant("course-1", "quiz-1", "generation-1");

    await Promise.all([service.revokeProof(proof), service.revokeExitGrant(exitGrant)]);

    await expect(service.consumeProof(proof, "course-1", "quiz-1", "settings-1")).resolves.toBeNull();
    await expect(service.validateExitGrant(exitGrant, "course-1", "quiz-1", "generation-1")).resolves.toBe(false);
  });

  it("mints reusable exam-session exit grants bound to the current configuration generation", async () => {
    const repositories = createInMemoryRepositories();
    const firstInstance = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const secondInstance = new SebAccessProofService({ value: repositories } as RepositoryProvider);
    const token = await firstInstance.mintExitGrant("course-1", "quiz-1", "generation-1");

    await expect(secondInstance.validateExitGrant(token, "course-1", "quiz-1", "generation-1")).resolves.toBe(true);
    await expect(firstInstance.validateExitGrant(token, "course-1", "quiz-1", "generation-1")).resolves.toBe(true);
    await expect(firstInstance.getExitGrant(token, "course-1", "quiz-1")).resolves.toBe("generation-1");
    await expect(firstInstance.validateExitGrant(token, "course-2", "quiz-1", "generation-1")).resolves.toBe(false);
    await expect(firstInstance.validateExitGrant(token, "course-1", "quiz-1", "generation-2")).resolves.toBe(false);

    const stored = await repositories.transientStates.get(exitGrantDocumentId(token));
    await repositories.transientStates.save(exitGrantDocumentId(token), {
      ...stored!,
      expiresAt: new Date(Date.now() - 1000)
    });
    await expect(firstInstance.validateExitGrant(token, "course-1", "quiz-1", "generation-1")).resolves.toBe(false);
  });
});
