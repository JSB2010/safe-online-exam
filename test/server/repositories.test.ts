import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryRepositories,
  FirestoreCollectionStore,
  FirestoreOperationLockStore,
  FirestoreTransientStateStore,
  InMemoryOperationLockStore,
  InMemoryCollectionStore,
  InMemoryTransientStateStore,
  isExpired,
  stripUndefinedValues
} from "../../src/server/data/repositories.js";
import { RepositorySessionStore, sessionDocumentId } from "../../src/server/data/session-store.js";
import { assessmentWithQuizSebSetting } from "../../src/shared/models.js";

describe("InMemoryCollectionStore", () => {
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

  it("exposes the reset Firestore stores for assessments, courses, and OAuth tokens", async () => {
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

  it("consumes Firestore transient state atomically", async () => {
    const firestore = firestoreDouble({
      "state-1": {
        kind: "seb-proof",
        courseId: "course-1",
        contentId: "quiz-1",
        expiresAt: timestampLike(futureDate())
      },
      expired: { kind: "seb-proof", courseId: "course-1", contentId: "quiz-1", expiresAt: new Date(Date.now() - 1000) },
      consumed: { kind: "seb-proof", consumedAt: new Date().toISOString(), expiresAt: futureDate() }
    });
    const store = new FirestoreTransientStateStore(firestore as any, "transientStates");

    await expect(
      store.claim("fresh-claim", {
        kind: "lti-state",
        payload: { nonce: "nonce-1" },
        expiresAt: futureDate(),
        consumedAt: new Date().toISOString()
      })
    ).resolves.toBe(true);
    await expect(
      store.claim("fresh-claim", {
        kind: "lti-state",
        payload: { nonce: "attacker" },
        expiresAt: futureDate(),
        consumedAt: new Date().toISOString()
      })
    ).resolves.toBe(false);
    await expect(store.consume("missing")).resolves.toBeNull();
    await expect(store.consume("expired")).resolves.toBeNull();
    expect(firestore.docs.has("expired")).toBe(false);
    await expect(store.consume("consumed")).resolves.toBeNull();
    await expect(store.consume("state-1")).resolves.toMatchObject({
      courseId: "course-1",
      contentId: "quiz-1",
      consumedAt: expect.any(String)
    });
    expect(firestore.docs.get("state-1")).toMatchObject({ consumedAt: expect.any(String) });
  });

  it("acquires, renews, and releases Firestore operation locks atomically", async () => {
    const firestore = firestoreDouble({
      live: { ownerId: "owner-1", expiresAt: futureDate() },
      expired: { ownerId: "owner-1", expiresAt: new Date(Date.now() - 1000), createdAt: "created" }
    });
    const store = new FirestoreOperationLockStore(firestore as any, "operationLocks");

    await expect(store.acquire("fresh", "owner-1", 60_000)).resolves.toBe(true);
    expect(firestore.docs.get("fresh")).toMatchObject({ ownerId: "owner-1", expiresAt: expect.any(Date) });
    await expect(store.acquire("live", "owner-2", 60_000)).resolves.toBe(false);
    const liveExpiry = new Date(firestore.docs.get("live")!.expiresAt as Date).getTime();
    await expect(store.renew("live", "owner-2", 120_000)).resolves.toBe(false);
    await expect(store.renew("live", "owner-1", 120_000)).resolves.toBe(true);
    expect(new Date(firestore.docs.get("live")!.expiresAt as Date).getTime()).toBeGreaterThan(liveExpiry);
    await expect(store.renew("expired", "owner-1", 60_000)).resolves.toBe(false);
    await expect(store.acquire("expired", "owner-2", 60_000)).resolves.toBe(true);

    await store.release("missing", "owner-1");
    await store.release("live", "owner-2");
    expect(firestore.docs.has("live")).toBe(true);
    await store.release("live", "owner-1");
    expect(firestore.docs.has("live")).toBe(false);
  });

  it("parses supported expiry shapes", () => {
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
    expect(isExpired(new Date(Date.now() - 60_000))).toBe(true);
    expect(isExpired({ toDate: () => new Date(Date.now() + 60_000) })).toBe(false);
    expect(isExpired({ _seconds: Math.floor((Date.now() + 60_000) / 1000), _nanoseconds: 0 })).toBe(false);
    expect(isExpired(undefined)).toBe(true);
  });
});

describe("FirestoreCollectionStore", () => {
  it("reads, writes, queries, deletes, and batches Firestore documents with canonical metadata", async () => {
    const batchSet = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue(undefined);
    const transactionSet = vi.fn();
    const transactionGet = vi.fn(async (reference: { get: () => unknown }) => reference.get());
    const runTransaction = vi.fn(async (callback: (transaction: unknown) => unknown) =>
      callback({
        get: transactionGet,
        set: transactionSet,
        update: vi.fn(),
        delete: vi.fn()
      })
    );
    const docs = new Map<
      string,
      { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
    >();
    const doc = vi.fn((id: string) => ({
      get: getDocRef(docs, id).get,
      set: getDocRef(docs, id).set,
      delete: getDocRef(docs, id).delete
    }));
    const where = vi.fn().mockReturnThis();
    const get = vi.fn().mockResolvedValue({
      docs: [
        {
          id: "quiz-2",
          data: () => ({ title: "Queried Quiz" })
        }
      ]
    });
    const collection = vi.fn(() => ({ doc, where, get }));
    const firestore = {
      collection,
      batch: vi.fn(() => ({
        set: batchSet,
        commit: batchCommit
      })),
      runTransaction
    };
    const store = new FirestoreCollectionStore<{ id?: string; courseId?: string; title: string }>(
      firestore as any,
      "assessments"
    );

    await expect(store.get("quiz-1")).resolves.toMatchObject({ id: "quiz-1", title: "Stored Quiz" });
    await expect(store.get("missing")).resolves.toBeNull();

    const saved = await store.save("quiz-1", { title: "Saved Quiz", courseId: undefined });
    expect(saved).toMatchObject({
      id: "quiz-1",
      title: "Saved Quiz",
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    });
    expect(saved).not.toHaveProperty("courseId");
    expect(getDocRef(docs, "quiz-1").set).toHaveBeenCalledWith(saved, { merge: true });

    const updated = await store.update("quiz-1", (current) => ({ ...current, title: "Updated Quiz" }));
    expect(updated).toMatchObject({ id: "quiz-1", title: "Updated Quiz" });
    expect(transactionSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "Updated Quiz" }), {
      merge: true
    });

    await expect(store.find([{ field: "courseId", op: "==", value: "course-1" }])).resolves.toEqual([
      { id: "quiz-2", title: "Queried Quiz" }
    ]);
    expect(where).toHaveBeenCalledWith("courseId", "==", "course-1");

    await store.delete("quiz-1");
    expect(getDocRef(docs, "quiz-1").delete).toHaveBeenCalled();

    const batched = await store.saveMany([
      { id: "quiz-3", value: { title: "Quiz 3" } },
      { id: "quiz-4", value: { id: "canvas-4", title: "Quiz 4" } }
    ]);
    expect(batched).toEqual([
      expect.objectContaining({ id: "quiz-3", title: "Quiz 3" }),
      expect.objectContaining({ id: "canvas-4", title: "Quiz 4" })
    ]);
    expect(batchSet).toHaveBeenCalledTimes(2);
    expect(batchSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "quiz-3" }), {
      merge: true
    });
    expect(batchCommit).toHaveBeenCalled();
  });
});

function getDocRef(
  docs: Map<string, { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }>,
  id: string
) {
  const existing = docs.get(id);
  if (existing) {
    return existing;
  }
  const next = {
    get: vi.fn().mockResolvedValue({
      exists: id === "quiz-1",
      id,
      data: () => ({ title: "Stored Quiz" })
    }),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  };
  docs.set(id, next);
  return next;
}

function futureDate(): Date {
  return new Date(Date.now() + 60_000);
}

function timestampLike(date: Date): { toDate: () => Date } {
  return Object.create(
    {
      toDate: () => date
    },
    {
      seconds: { value: Math.floor(date.getTime() / 1000), enumerable: true }
    }
  ) as { toDate: () => Date };
}

function firestoreDouble(seed: Record<string, Record<string, unknown>>) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(seed));
  const doc = vi.fn((id: string) => ({
    id,
    get: vi.fn().mockResolvedValue({
      exists: docs.has(id),
      id,
      data: () => docs.get(id)
    }),
    set: vi.fn(async (value: Record<string, unknown>) => {
      docs.set(id, value);
    }),
    delete: vi.fn(async () => {
      docs.delete(id);
    })
  }));
  const collection = vi.fn(() => ({ doc }));
  return {
    docs,
    collection,
    runTransaction: vi.fn(async (callback: (transaction: any) => unknown) =>
      callback({
        get: async (reference: { get: () => unknown }) => reference.get(),
        set: (reference: { id: string }, value: Record<string, unknown>) => {
          docs.set(reference.id, value);
        },
        update: (reference: { id: string }, value: Record<string, unknown>) => {
          docs.set(reference.id, { ...(docs.get(reference.id) || {}), ...value });
        },
        delete: (reference: { id: string }) => {
          docs.delete(reference.id);
        }
      })
    )
  };
}

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
