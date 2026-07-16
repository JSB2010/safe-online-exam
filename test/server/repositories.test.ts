import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createInMemoryRepositories,
  InMemoryCollectionStore,
  InMemoryOperationLockStore,
  InMemoryTransientStateStore
} from "../../src/server/data/in-memory-repositories.js";
import { isExpired, stripUndefinedValues } from "../../src/server/data/document-values.js";
import type { QueryOperator } from "../../src/server/data/repository-contracts.js";
import { createRepositories } from "../../src/server/data/repositories.js";
import { RepositorySessionStore, sessionDocumentId } from "../../src/server/data/session-store.js";
import { assessmentWithQuizSebSetting } from "../../src/shared/models.js";

describe("InMemoryCollectionStore", () => {
  it("selects in-memory only when explicit and PostgreSQL for production", () => {
    const previous = process.env.USE_IN_MEMORY_STORE;
    try {
      process.env.USE_IN_MEMORY_STORE = "true";
      expect(
        createRepositories({ profile: "dev", isHardenedRuntime: () => false } as any, {} as any).assessments
      ).toBeInstanceOf(InMemoryCollectionStore);
      expect(() => createRepositories({ profile: "prod", isHardenedRuntime: () => true } as any, {} as any)).toThrow(
        "USE_IN_MEMORY_STORE is local/test only and cannot be enabled in a hardened runtime"
      );

      delete process.env.USE_IN_MEMORY_STORE;
      expect(
        createRepositories({ profile: "prod", isHardenedRuntime: () => true } as any, {} as any).assessments.constructor
          .name
      ).toBe("PostgresCollectionStore");
    } finally {
      if (previous === undefined) delete process.env.USE_IN_MEMORY_STORE;
      else process.env.USE_IN_MEMORY_STORE = previous;
    }
  });

  it("keeps provider-neutral query operators and contracts free of retired provider types", () => {
    const operators: QueryOperator[] = ["==", "!=", "in"];
    expect(operators).toEqual(["==", "!=", "in"]);
    expect(readFileSync(join(process.cwd(), "src/server/data/repository-contracts.ts"), "utf8")).not.toContain(
      ["Firebase", "Fire", "store"].join("")
    );
  });

  it("saves, finds, batches, and deletes documents", async () => {
    const store = new InMemoryCollectionStore<{ id?: string; courseId: string; title: string }>();

    await store.save("quiz-1", { courseId: "course-1", title: "Quiz 1" });
    await store.saveMany([{ id: "quiz-2", value: { courseId: "course-1", title: "Quiz 2" } }]);

    await expect(store.get("quiz-1")).resolves.toMatchObject({
      id: "quiz-1",
      title: "Quiz 1",
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    });
    await expect(store.find([{ field: "courseId", op: "==", value: "course-1" }])).resolves.toHaveLength(2);
    await expect(store.find([{ field: "id", op: "in", value: ["quiz-2"] }])).resolves.toHaveLength(1);

    await store.delete("quiz-1");
    await expect(store.get("quiz-1")).resolves.toBeNull();
  });

  it("exposes the reset stores for assessments, courses, and OAuth tokens", async () => {
    const repositories = createInMemoryRepositories();
    await repositories.assessments.save(
      "classicquiz_42",
      assessmentWithQuizSebSetting(null, {
        quizId: "42",
        courseId: "course-1",
        sebRequired: true,
        enabled: true,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        externalTools: []
      })
    );
    await repositories.courses.save("course-1", {
      id: "course-1",
      courseId: "course-1",
      setupCompleted: true,
      sebDefaults: { quitPassword: null, startPassword: null, urlRules: [], externalTools: [] }
    });
    await repositories.oauthTokens.save("user-1", { id: "user-1", userId: "user-1", accessToken: "token" });

    await expect(
      repositories.assessments.find([{ field: "courseId", op: "==", value: "course-1" }])
    ).resolves.toHaveLength(1);
    await expect(repositories.courses.get("course-1")).resolves.toMatchObject({ setupCompleted: true });
    await expect(repositories.oauthTokens.get("user-1")).resolves.toMatchObject({ accessToken: "token" });
    await repositories.sessions.save("session-1", {
      data: { userId: "user-1" },
      expiresAt: new Date(Date.now() + 1000)
    });
    await expect(repositories.sessions.get("session-1")).resolves.toMatchObject({ data: { userId: "user-1" } });
  });

  it("strips undefined values before documents are written", () => {
    expect(
      stripUndefinedValues({
        keep: "value",
        remove: undefined,
        nested: { remove: undefined, keep: "nested-value" },
        list: ["a", undefined, { remove: undefined, keep: "b" }]
      })
    ).toEqual({
      keep: "value",
      nested: { keep: "nested-value" },
      list: ["a", { keep: "b" }]
    });
  });

  it("rejects unsupported in-memory query operators clearly", async () => {
    const store = new InMemoryCollectionStore<{ id?: string; courseId: string }>();
    await store.save("quiz-1", { courseId: "course-1" });

    await expect(store.find([{ field: "courseId", op: "array-contains" as any, value: "course-1" }])).rejects.toThrow(
      "Unsupported in-memory query operator: array-contains"
    );
  });
});

describe("Runtime state stores", () => {
  it("atomically claims a state digest once and permits reuse only after expiry", async () => {
    const store = new InMemoryTransientStateStore();
    const liveClaim = {
      kind: "lti-state" as const,
      payload: { nonce: "nonce-1" },
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date().toISOString()
    };

    await expect(store.claim("state-digest", liveClaim)).resolves.toBe(true);
    await expect(store.claim("state-digest", { ...liveClaim, payload: { nonce: "attacker" } })).resolves.toBe(false);
    await store.save("state-digest", { ...liveClaim, expiresAt: new Date(Date.now() - 1) });
    await expect(store.claim("state-digest", { ...liveClaim, payload: { nonce: "replacement" } })).resolves.toBe(true);
    await expect(store.get("state-digest")).resolves.toMatchObject({ payload: { nonce: "replacement" } });
  });

  it("atomically consumes transient state once", async () => {
    const store = new InMemoryTransientStateStore();
    await store.save("state-1", {
      kind: "lti-state",
      payload: { nonce: "nonce-1" },
      expiresAt: new Date(Date.now() + 60_000)
    });

    await expect(store.consume("state-1")).resolves.toMatchObject({ payload: { nonce: "nonce-1" } });
    await expect(store.consume("state-1")).resolves.toBeNull();
  });

  it("rejects live operation locks, renews only the live owner, and allows release or expiry", async () => {
    const store = new InMemoryOperationLockStore();

    await expect(store.acquire("assessment:quiz-1", "owner-1", 60_000)).resolves.toBe(true);
    await expect(store.acquire("assessment:quiz-1", "owner-2", 60_000)).resolves.toBe(false);
    const originalExpiry = (await store.get("assessment:quiz-1"))!.expiresAt;
    await expect(store.renew("assessment:quiz-1", "owner-2", 120_000)).resolves.toBe(false);
    await expect(store.renew("assessment:quiz-1", "owner-1", 120_000)).resolves.toBe(true);
    expect(new Date((await store.get("assessment:quiz-1"))!.expiresAt).getTime()).toBeGreaterThan(
      new Date(originalExpiry).getTime()
    );
    await store.release("assessment:quiz-1", "owner-1");
    await expect(store.acquire("assessment:quiz-1", "owner-2", 60_000)).resolves.toBe(true);

    await store.save("assessment:quiz-2", { ownerId: "owner-1", expiresAt: new Date(Date.now() - 1000) });
    await expect(store.renew("assessment:quiz-2", "owner-1", 60_000)).resolves.toBe(false);
    await expect(store.acquire("assessment:quiz-2", "owner-2", 60_000)).resolves.toBe(true);
  });

  it("stores, touches, reads, and destroys Express sessions through the repository", async () => {
    const repositories = createInMemoryRepositories();
    const firstInstance = new RepositorySessionStore(repositories.sessions, 60_000);
    const secondInstance = new RepositorySessionStore(repositories.sessions, 60_000);
    const sessionData = {
      cookie: { originalMaxAge: 60_000, expires: new Date(Date.now() + 60_000), httpOnly: true, path: "/" },
      launchData: { userId: "user-1", roles: [] }
    } as any;

    await callStore((done) => firstInstance.set("sid-1", sessionData, done));
    await expect(repositories.sessions.get(sessionDocumentId("sid-1"))).resolves.toMatchObject({
      data: { launchData: { userId: "user-1", roles: [] } }
    });

    const restored = await callGet(secondInstance, "sid-1");
    expect(restored?.launchData).toEqual({ userId: "user-1", roles: [] });

    await callStore((done) => secondInstance.touch("sid-1", sessionData, done));
    await callStore((done) => firstInstance.destroy("sid-1", done));
    await expect(callGet(secondInstance, "sid-1")).resolves.toBeNull();
  });

  it("expires repository-backed sessions and falls back to ttl for invalid cookie dates", async () => {
    const repositories = createInMemoryRepositories();
    const store = new RepositorySessionStore(repositories.sessions, 60_000);
    await repositories.sessions.save("expired", {
      data: { userId: "user-1" },
      expiresAt: new Date(Date.now() - 1000)
    });

    await expect(callGet(store, "sid-without-record")).resolves.toBeNull();
    await repositories.sessions.save(sessionDocumentId("expired-sid"), {
      data: { userId: "user-1" },
      expiresAt: new Date(Date.now() - 1000)
    });
    await expect(callGet(store, "expired-sid")).resolves.toBeNull();
    await expect(repositories.sessions.get(sessionDocumentId("expired-sid"))).resolves.toBeNull();

    await callStore((done) =>
      store.set(
        "invalid-expiry",
        { cookie: { expires: "not-a-date", originalMaxAge: 60_000, httpOnly: true, path: "/" } } as any,
        done
      )
    );
    const saved = await repositories.sessions.get(sessionDocumentId("invalid-expiry"));
    expect(saved?.expiresAt).toBeInstanceOf(Date);
    expect((saved?.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("parses supported expiry shapes", () => {
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
    expect(isExpired(new Date(Date.now() - 60_000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
    expect(isExpired(Date.now() + 60_000)).toBe(false);
    expect(isExpired(undefined)).toBe(true);
  });
});

function callStore(run: (done: (err?: unknown) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    run((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function callGet(store: RepositorySessionStore, sid: string): Promise<any> {
  return new Promise((resolve, reject) => {
    store.get(sid, (error, session) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(session);
    });
  });
}
