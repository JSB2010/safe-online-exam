import { describe, expect, it } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { LtiStateService, stateDocumentId } from "../../src/server/services/lti-state.service.js";

describe("LtiStateService", () => {
  it("encrypts state and consumes it once across service instances", async () => {
    const repositories = createInMemoryRepositories();
    const firstInstance = new LtiStateService(new AppConfig(), { value: repositories } as RepositoryProvider);
    const secondInstance = new LtiStateService(new AppConfig(), { value: repositories } as RepositoryProvider);
    const state = await firstInstance.createState({ nonce: "nonce-1", target: "launch" });

    await expect(secondInstance.consumeState(state)).resolves.toEqual({ nonce: "nonce-1", target: "launch" });
    await expect(firstInstance.consumeState(state)).rejects.toThrow("Invalid or already consumed LTI state");
  });

  it("rejects expired stored state", async () => {
    const repositories = createInMemoryRepositories();
    const service = new LtiStateService(new AppConfig(), { value: repositories } as RepositoryProvider);
    const state = await service.createState({ nonce: "nonce-1" });
    const stored = await repositories.transientStates.get(stateDocumentId(state));
    await repositories.transientStates.save(stateDocumentId(state), {
      ...stored!,
      expiresAt: new Date(Date.now() - 1000)
    });

    await expect(service.consumeState(state)).rejects.toThrow("Invalid or already consumed LTI state");
  });

  it("rejects missing or malformed state", async () => {
    const repositories = createInMemoryRepositories();
    const service = new LtiStateService(new AppConfig(), { value: repositories } as RepositoryProvider);

    await expect(service.consumeState(undefined)).rejects.toThrow("Missing LTI state");
    await repositories.transientStates.save(stateDocumentId("malformed"), {
      kind: "lti-state",
      payload: { nonce: "nonce-1" },
      expiresAt: new Date(Date.now() + 60_000)
    });
    await expect(service.consumeState("malformed")).rejects.toThrow("Invalid LTI state");
  });

  it("requires a state encryption key in production", async () => {
    const previousAppEnv = process.env.APP_ENV;
    const previousStateKey = process.env.STATE_ENCRYPTION_KEY;
    process.env.APP_ENV = "prod";
    delete process.env.STATE_ENCRYPTION_KEY;
    try {
      const service = new LtiStateService(new AppConfig(), {
        value: createInMemoryRepositories()
      } as RepositoryProvider);
      await expect(service.createState({ nonce: "nonce-1" })).rejects.toThrow(
        "STATE_ENCRYPTION_KEY is required in prod"
      );
    } finally {
      restoreEnv("APP_ENV", previousAppEnv);
      restoreEnv("STATE_ENCRYPTION_KEY", previousStateKey);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
