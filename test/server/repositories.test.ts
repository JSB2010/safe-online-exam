import { describe, expect, it } from "vitest";
import {
  createInMemoryRepositories,
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
});
