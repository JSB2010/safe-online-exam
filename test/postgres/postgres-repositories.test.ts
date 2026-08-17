// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/server/data/migrations.js";
import { createPostgresRepositories, PostgresOAuthTokenStore } from "../../src/server/data/postgres-repositories.js";
import { RepositoryProvider } from "../../src/server/data/repositories.js";
import { assessmentWithQuizSebSetting, type CourseRecord, type OAuthToken } from "../../src/shared/models.js";
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
    const persisted = await testDatabase.database.query<{ document: Record<string, unknown> }>(
      "SELECT document FROM canvas_oauth_tokens WHERE id = $1",
      ["user-1"]
    );
    expect(JSON.stringify(persisted.rows[0]?.document)).not.toContain("secret-token");
    expect(persisted.rows[0]?.document).not.toHaveProperty("accessToken");
    expect(persisted.rows[0]?.document).toHaveProperty("tokenEncryption.algorithm", "A256GCM");

    const expiry = new Date(Date.now() + 60_000);
    await repositories.sessions.save("session-1", { data: { userId: "user-1" }, expiresAt: expiry });
    await expect(repositories.sessions.get("session-1")).resolves.toMatchObject({
      id: "session-1",
      data: { userId: "user-1" },
      expiresAt: expect.any(Date)
    });
  });

  it("atomically resets course state while preserving OAuth and the admin connection", async () => {
    const oauthTokenEncryption = {
      mode: "enforce" as const,
      activeKeyId: "postgres-test-v1",
      keyring: JSON.stringify({ "postgres-test-v1": Buffer.alloc(32, 19).toString("base64url") })
    };
    const repositories = createPostgresRepositories(testDatabase.database, oauthTokenEncryption);
    const courseId = "reset-course-101";
    const connectionId = `7:${courseId}`;
    await repositories.courses.save(courseId, courseRecord(courseId, true));
    await repositories.assessments.save(
      "classicquiz_reset-501",
      assessmentWithQuizSebSetting(null, {
        quizId: "reset-501",
        courseId,
        sebRequired: true,
        enabled: true,
        accessCode: "RESET-CODE",
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        urlRules: [],
        externalTools: []
      })
    );
    await repositories.transientStates.save("reset-grant", {
      kind: "seb-config-grant",
      courseId,
      expiresAt: new Date(Date.now() + 60_000)
    });
    await repositories.oauthTokens.save("reset-user", {
      id: "reset-user",
      userId: "reset-user",
      accessToken: "preserved-oauth-token"
    });
    await repositories.adminCourseConnections.save(connectionId, {
      id: connectionId,
      rootAccountId: "7",
      canvasOrigin: "https://canvas.example.edu",
      courseId,
      name: "Reset Biology",
      accountId: "7",
      teacherNames: [],
      assessmentCount: 1,
      enabledAssessmentCount: 1,
      issueCount: 0,
      connectedByUserId: "reset-user"
    });
    await repositories.adminToolPresetAssignments.save(`preset-1:${courseId}`, {
      id: `preset-1:${courseId}`,
      rootAccountId: "7",
      presetId: "preset-1",
      courseId,
      desiredAssigned: true,
      status: "applied",
      error: null,
      appliedPresetUpdatedAt: new Date().toISOString(),
      updatedByUserId: "reset-user"
    });
    const provider = new RepositoryProvider(
      {
        profile: "prod",
        value: { security: { oauthTokenEncryption } }
      } as any,
      testDatabase.database
    );
    const operationId = "00000000-0000-4000-8000-000000000002";

    await expect(provider.resetCourseState(courseId, connectionId, operationId)).resolves.toMatchObject({
      version: 1,
      operationId,
      courseId,
      assessmentCount: 1,
      transientStateCount: 1,
      courseRecordCount: 1,
      presetAssignmentCount: 1
    });
    await expect(provider.getCourseResetOutcome(connectionId, operationId, courseId)).resolves.toMatchObject({
      version: 1,
      operationId,
      courseId,
      assessmentCount: 1,
      transientStateCount: 1,
      courseRecordCount: 1,
      presetAssignmentCount: 1
    });
    await expect(repositories.courses.get(courseId)).resolves.toBeNull();
    await expect(repositories.assessments.get("classicquiz_reset-501")).resolves.toBeNull();
    await expect(repositories.transientStates.get("reset-grant")).resolves.toBeNull();
    await expect(repositories.adminToolPresetAssignments.get(`preset-1:${courseId}`)).resolves.toBeNull();
    await expect(repositories.oauthTokens.get("reset-user")).resolves.toMatchObject({
      accessToken: "preserved-oauth-token"
    });
    await expect(repositories.adminCourseConnections.get(connectionId)).resolves.toMatchObject({
      assessmentCount: 0,
      enabledAssessmentCount: 0,
      issueCount: 0,
      lastResetOutcome: expect.objectContaining({ operationId, courseId })
    });
  });

  it("rewrites legacy plaintext OAuth tokens without exposing values in PostgreSQL", async () => {
    await testDatabase.database.query(
      `INSERT INTO canvas_oauth_tokens (id, user_id, document)
       VALUES ($1, $2, $3::jsonb)`,
      [
        "legacy-user",
        "legacy-user",
        JSON.stringify({
          id: "legacy-user",
          userId: "legacy-user",
          accessToken: "legacy-access-sentinel",
          refreshToken: "legacy-refresh-sentinel"
        })
      ]
    );
    const settings = {
      mode: "enforce" as const,
      activeKeyId: "rewrite-v1",
      keyring: JSON.stringify({
        "rewrite-v1": Buffer.alloc(32, 23).toString("base64url"),
        "postgres-test-v1": Buffer.alloc(32, 19).toString("base64url")
      })
    };
    const store = new PostgresOAuthTokenStore(testDatabase.database, settings);

    await expect(store.get("legacy-user")).resolves.toMatchObject({ accessToken: "legacy-access-sentinel" });
    await expect(store.rewriteLegacyAndRotatedTokens(1)).resolves.toMatchObject({ rewritten: expect.any(Number) });
    const persisted = await testDatabase.database.query<{ document: Record<string, unknown> }>(
      "SELECT document FROM canvas_oauth_tokens WHERE id = $1",
      ["legacy-user"]
    );
    expect(JSON.stringify(persisted.rows[0]?.document)).not.toContain("legacy-access-sentinel");
    expect(JSON.stringify(persisted.rows[0]?.document)).not.toContain("legacy-refresh-sentinel");
    await expect(store.get("legacy-user")).resolves.toMatchObject({
      accessToken: "legacy-access-sentinel",
      refreshToken: "legacy-refresh-sentinel"
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
