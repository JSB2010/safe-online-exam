import { describe, expect, it, vi } from "vitest";
import {
  buildMigrationPlan,
  LEGACY_METADATA_FIELD,
  migrateLegacyNewQuizMetadata,
  NEW_QUIZ_CONTENT_TYPE,
  parseMigrationArguments,
  resolveMigrationTarget,
  stageMetadataFieldDeletion
} from "../../scripts/purge-legacy-new-quiz-metadata.mjs";

describe("legacy New Quiz metadata migration", () => {
  it("is a dry run by default and requires an explicit project and database", () => {
    expect(
      buildMigrationPlan([], {
        GCP_PROJECT_ID: "school-project-1",
        FIRESTORE_DATABASE_ID: "seb-canvaslti-prod"
      })
    ).toEqual({
      apply: false,
      help: false,
      projectId: "school-project-1",
      databaseId: "seb-canvaslti-prod",
      assessmentsCollection: "assessments"
    });

    expect(() => resolveMigrationTarget({ FIRESTORE_DATABASE_ID: "seb-canvaslti-prod" })).toThrow(
      "GCP_PROJECT_ID must be explicitly set"
    );
    expect(() => resolveMigrationTarget({ GCP_PROJECT_ID: "school-project-1" })).toThrow(
      "FIRESTORE_DATABASE_ID must be explicitly set"
    );
  });

  it("enables writes only with an explicit --apply and honors the configured collection", () => {
    expect(
      buildMigrationPlan(["--apply"], {
        GCP_PROJECT_ID: "school-project-1",
        FIRESTORE_DATABASE_ID: "seb-canvaslti-prod",
        FIRESTORE_ASSESSMENTS_COLLECTION: "schoolAssessments"
      })
    ).toEqual({
      apply: true,
      help: false,
      projectId: "school-project-1",
      databaseId: "seb-canvaslti-prod",
      assessmentsCollection: "schoolAssessments"
    });

    expect(() => parseMigrationArguments(["--apply", "--apply"])).toThrow("--apply may be supplied only once");
    expect(() => parseMigrationArguments(["--force"])).toThrow("Unknown argument: --force");
    expect(() =>
      resolveMigrationTarget({
        GCP_PROJECT_ID: "school-project-1",
        FIRESTORE_DATABASE_ID: "seb-canvaslti-prod",
        FIRESTORE_ASSESSMENTS_COLLECTION: "nested/assessments"
      })
    ).toThrow("must be one nonempty Firestore collection path segment");
  });

  it("stages deletion of only the legacy nested metadata field", () => {
    const update = vi.fn();
    const batch = { update };
    const documentReference = { path: "must-not-be-logged" };
    const deleteSentinel = Symbol("delete-field");

    stageMetadataFieldDeletion(batch, documentReference, deleteSentinel);

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(documentReference, LEGACY_METADATA_FIELD, deleteSentinel);
  });

  it("performs no writes during a dry run and reports only aggregate counts", async () => {
    const firestore = fakeFirestore([{ metadata: { secret: true } }, { metadata: undefined }]);

    await expect(
      migrateLegacyNewQuizMetadata(firestore.value, {
        apply: false,
        assessmentsCollection: "assessments"
      })
    ).resolves.toEqual({ mode: "dry-run", scanned: 2, matched: 1, updated: 0, batches: 0 });

    expect(firestore.select).toHaveBeenCalledWith(LEGACY_METADATA_FIELD);
    expect(firestore.where).toHaveBeenCalledWith("contentType", "==", NEW_QUIZ_CONTENT_TYPE);
    expect(firestore.batch).not.toHaveBeenCalled();
  });

  it("deletes only the target field in bounded batches during apply", async () => {
    const firestore = fakeFirestore([{ metadata: { one: 1 } }, { metadata: null }, { metadata: { two: 2 } }]);
    const deleteSentinel = Symbol("delete-field");

    await expect(
      migrateLegacyNewQuizMetadata(
        firestore.value,
        { apply: true, assessmentsCollection: "customAssessments" },
        { batchSize: 2, deleteValue: deleteSentinel }
      )
    ).resolves.toEqual({ mode: "apply", scanned: 3, matched: 3, updated: 3, batches: 2 });

    expect(firestore.collection).toHaveBeenCalledWith("customAssessments");
    expect(firestore.commit).toHaveBeenCalledTimes(2);
    expect(firestore.update).toHaveBeenCalledTimes(3);
    for (const call of firestore.update.mock.calls) {
      expect(call.slice(1)).toEqual([LEGACY_METADATA_FIELD, deleteSentinel]);
    }
  });
});

function fakeFirestore(documents: Array<{ metadata: unknown }>) {
  const update = vi.fn();
  const commit = vi.fn().mockResolvedValue(undefined);
  const batch = vi.fn(() => ({ update, commit }));
  const get = vi.fn().mockResolvedValue({
    docs: documents.map((document, index) => ({
      ref: { opaqueReference: index },
      get: vi.fn((field: string) => (field === LEGACY_METADATA_FIELD ? document.metadata : undefined))
    }))
  });
  const select = vi.fn(() => ({ get }));
  const where = vi.fn(() => ({ select }));
  const collection = vi.fn(() => ({ where }));

  return {
    value: { collection, batch },
    collection,
    where,
    select,
    batch,
    update,
    commit
  };
}
