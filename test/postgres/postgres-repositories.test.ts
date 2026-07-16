// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/server/data/migrations.js";
import { createPostgresRepositories } from "../../src/server/data/postgres-repositories.js";
import type { CourseRecord, OAuthToken } from "../../src/shared/models.js";
import { createPostgresTestDatabase, type PostgresTestDatabase } from "./helpers.js";

let testDatabase: PostgresTestDatabase;

beforeAll(async () => {
  testDatabase = await createPostgresTestDatabase();
  await runMigrations(testDatabase.database);
});

afterAll(async () => {
  await testDatabase?.cleanup();
});

describe("PostgreSQL document repositories", () => {
  it("gets, saves, updates, filters, batches, and deletes mapped documents", async () => {
    const repositories = createPostgresRepositories(testDatabase.database);
    const store = repositories.courses;
    await expect(store.get("missing")).resolves.toBeNull();

    const created = await store.save("course-1", courseRecord("course-1", false));
    expect(created).toMatchObject({
      id: "course-1",
      courseId: "course-1",
      setupCompleted: false,
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const updated = await store.update("course-1", (current) => ({ ...current!, setupCompleted: true }));
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated!.updatedAt!)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt!));

    await store.saveMany([
      { id: "course-2", value: courseRecord("course-2", false) },
      { id: "course-3", value: courseRecord("course-3", true) }
    ]);
    await expect(store.find([{ field: "courseId", op: "==", value: "course-2" }])).resolves.toHaveLength(1);
    await expect(store.find([{ field: "id", op: "in", value: ["course-1", "course-3"] }])).resolves.toHaveLength(2);
    await expect(store.find([{ field: "courseId", op: "!=", value: "course-1" }])).resolves.toHaveLength(2);
    await store.delete("course-3");
    await expect(store.get("course-3")).resolves.toBeNull();
  });

  it("rolls back an invalid batch and serializes concurrent updater callbacks", async () => {
    const repositories = createPostgresRepositories(testDatabase.database);
    const store = repositories.courses;
    await expect(
      store.saveMany([
        { id: "batch-good", value: courseRecord("batch-good", false) },
        { id: "batch-invalid", value: { ...courseRecord("batch-invalid", false), courseId: undefined } as never }
      ])
    ).rejects.toThrow();
    await expect(store.get("batch-good")).resolves.toBeNull();

    await store.save("counter", { ...courseRecord("counter", false), revision: 0 } as CourseRecord);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        store.update("counter", (current) => ({
          ...current!,
          revision: Number((current as CourseRecord & { revision?: number })?.revision ?? 0) + 1
        }))
      )
    );
    await expect(store.get("counter")).resolves.toMatchObject({ revision: 12 });
  });

  it("persists OAuth documents and expiring sessions in their dedicated mappings", async () => {
    const repositories = createPostgresRepositories(testDatabase.database);
    const token: OAuthToken = { id: "user-1", userId: "user-1", accessToken: "secret-token" };
    await repositories.oauthTokens.save("user-1", token);
    await expect(repositories.oauthTokens.get("user-1")).resolves.toMatchObject(token);

    const expiry = new Date(Date.now() + 60_000);
    await repositories.sessions.save("session-1", { data: { userId: "user-1" }, expiresAt: expiry });
    await expect(repositories.sessions.get("session-1")).resolves.toMatchObject({
      id: "session-1",
      data: { userId: "user-1" },
      expiresAt: expect.any(Date)
    });
  });
});

describe("PostgreSQL atomic runtime repositories", () => {
  it("allows exactly one live claim and exactly one consume across concurrent clients", async () => {
    const store = createPostgresRepositories(testDatabase.database).transientStates;
    const claim = {
      kind: "lti-state" as const,
      payload: { nonce: "nonce-1" },
      expiresAt: new Date(Date.now() + 60_000)
    };
    const claims = await Promise.all(Array.from({ length: 12 }, () => store.claim("race-claim", claim)));
    expect(claims.filter(Boolean)).toHaveLength(1);

    const consumed = await Promise.all(Array.from({ length: 12 }, () => store.consume("race-claim")));
    expect(consumed.filter(Boolean)).toHaveLength(1);
  });

  it("never admits more requests than the configured budget", async () => {
    const store = createPostgresRepositories(testDatabase.database).transientStates;
    const results = await Promise.all(Array.from({ length: 30 }, () => store.consumeBudget("budget-race", 7, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(7);
  });

  it("preserves lease ownership, renewal, expiry, and release atomically", async () => {
    const store = createPostgresRepositories(testDatabase.database).operationLocks;
    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, index) => store.acquire("lock-race", `owner-${index}`, 60_000))
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const winningOwner = `owner-${attempts.findIndex(Boolean)}`;
    await expect(store.renew("lock-race", "attacker", 60_000)).resolves.toBe(false);
    await expect(store.renew("lock-race", winningOwner, 60_000)).resolves.toBe(true);
    await expect(store.acquire("invalid-ttl", "owner", 0)).resolves.toBe(false);

    await store.release("lock-race", "attacker");
    await expect(store.acquire("lock-race", "new-owner", 60_000)).resolves.toBe(false);
    await store.release("lock-race", winningOwner);
    await expect(store.acquire("lock-race", "new-owner", 60_000)).resolves.toBe(true);

    await store.save("expired-lock", { ownerId: "old-owner", expiresAt: new Date(Date.now() - 1_000) });
    await store.release("expired-lock", "not-owner");
    await expect(store.get("expired-lock")).resolves.toBeNull();
  });
});

function courseRecord(courseId: string, setupCompleted: boolean): CourseRecord {
  return {
    id: courseId,
    courseId,
    setupCompleted,
    sebDefaults: { quitPassword: null, startPassword: null, urlRules: [], externalTools: [] }
  };
}
