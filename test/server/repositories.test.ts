import { describe, expect, it } from "vitest";
import { InMemoryCollectionStore, stripUndefinedValues } from "../../src/server/data/repositories.js";

describe("InMemoryCollectionStore", () => {
  it("saves, finds, batches, and deletes documents", async () => {
    const store = new InMemoryCollectionStore<{ id?: string; courseId: string; title: string }>();

    await store.save("quiz-1", { courseId: "course-1", title: "Quiz 1" });
    await store.saveMany([{ id: "quiz-2", value: { courseId: "course-1", title: "Quiz 2" } }]);

    await expect(store.get("quiz-1")).resolves.toMatchObject({ id: "quiz-1", title: "Quiz 1" });
    await expect(store.find([{ field: "courseId", op: "==", value: "course-1" }])).resolves.toHaveLength(2);
    await expect(store.find([{ field: "id", op: "in", value: ["quiz-2"] }])).resolves.toHaveLength(1);

    await store.delete("quiz-1");
    await expect(store.get("quiz-1")).resolves.toBeNull();
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
