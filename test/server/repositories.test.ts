import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryRepositories,
  FirestoreCollectionStore,
  InMemoryCollectionStore,
  stripUndefinedValues
} from "../../src/server/data/repositories.js";
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

describe("FirestoreCollectionStore", () => {
  it("reads, writes, queries, deletes, and batches Firestore documents with canonical metadata", async () => {
    const batchSet = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue(undefined);
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
      }))
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
