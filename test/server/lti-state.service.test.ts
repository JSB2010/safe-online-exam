import { describe, expect, it, vi } from "vitest";
import type { AppConfig, AppProfile } from "../../src/server/config/app-config.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { LtiStateService, stateDocumentId } from "../../src/server/services/lti-state.service.js";

describe("LtiStateService", () => {
  it("encrypts state without persisting the cleartext payload and claims it once across instances", async () => {
    const repositories = createInMemoryRepositories();
    const provider = { value: repositories } as RepositoryProvider;
    const firstInstance = new LtiStateService(configDouble("state-key"), provider);
    const secondInstance = new LtiStateService(configDouble("state-key"), provider);
    const payload = {
      nonce: "nonce-1",
      issuer: "https://canvas.instructure.com",
      deploymentId: "deployment-1",
      targetLinkUri: "https://tool.example/lti/launch"
    };

    const state = await firstInstance.createState(payload);

    expect(state).not.toContain("nonce-1");
    expect(firstInstance.peekState(state)).toEqual(payload);
    await expect(repositories.transientStates.get(stateDocumentId(state))).resolves.toBeNull();

    await expect(secondInstance.claimState(state)).resolves.toBeUndefined();
    await expect(repositories.transientStates.get(stateDocumentId(state))).resolves.toMatchObject({
      kind: "lti-state",
      payload,
      consumedAt: expect.any(String)
    });
    await expect(firstInstance.claimState(state)).rejects.toThrow("Invalid or already consumed LTI state");
  });

  it("keeps consumeState as a one-use authenticated compatibility operation", async () => {
    const repositories = createInMemoryRepositories();
    const service = new LtiStateService(configDouble("state-key"), {
      value: repositories
    } as RepositoryProvider);
    const state = await service.createState({ nonce: "nonce-1", target: "launch" });

    await expect(service.consumeState(state)).resolves.toEqual({ nonce: "nonce-1", target: "launch" });
    await expect(service.consumeState(state)).rejects.toThrow("Invalid or already consumed LTI state");
  });

  it("rejects expired encrypted state before creating a replay claim", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const repositories = createInMemoryRepositories();
      const service = new LtiStateService(configDouble("state-key"), {
        value: repositories
      } as RepositoryProvider);
      const state = await service.createState({ nonce: "nonce-1" });

      vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));

      expect(() => service.peekState(state)).toThrow("Expired LTI state");
      await expect(service.claimState(state)).rejects.toThrow("Expired LTI state");
      await expect(repositories.transientStates.get(stateDocumentId(state))).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("authenticates every encrypted byte and rejects attacker-modified state", async () => {
    const repositories = createInMemoryRepositories();
    const service = new LtiStateService(configDouble("state-key"), {
      value: repositories
    } as RepositoryProvider);
    const state = await service.createState({ nonce: "nonce-1" });
    const modifiedIndex = Math.floor(state.length / 2);
    const tampered = `${state.slice(0, modifiedIndex)}${state[modifiedIndex] === "A" ? "B" : "A"}${state.slice(modifiedIndex + 1)}`;

    expect(() => service.peekState(tampered)).toThrow();
    await expect(service.claimState(tampered)).rejects.toThrow();
    await expect(repositories.transientStates.get(stateDocumentId(tampered))).resolves.toBeNull();
  });

  it("rejects missing, malformed, or differently keyed state", async () => {
    const repositories = createInMemoryRepositories();
    const service = new LtiStateService(configDouble("state-key"), {
      value: repositories
    } as RepositoryProvider);
    const state = await service.createState({ nonce: "nonce-1" });
    const wrongKeyService = new LtiStateService(configDouble("different-key"), {
      value: repositories
    } as RepositoryProvider);

    expect(() => service.peekState(undefined)).toThrow("Missing LTI state");
    expect(() => service.peekState("malformed")).toThrow("Invalid LTI state");
    expect(() => wrongKeyService.peekState(state)).toThrow();
  });

  it("requires an explicit state encryption key in production", async () => {
    const service = new LtiStateService(configDouble("", "prod"), {
      value: createInMemoryRepositories()
    } as RepositoryProvider);

    await expect(service.createState({ nonce: "nonce-1" })).rejects.toThrow("STATE_ENCRYPTION_KEY is required in prod");
  });
});

function configDouble(stateEncryptionKey: string, profile: AppProfile = "test"): AppConfig {
  return {
    profile,
    value: {
      security: { stateEncryptionKey }
    }
  } as AppConfig;
}
