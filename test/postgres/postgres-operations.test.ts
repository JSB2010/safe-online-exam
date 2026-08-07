// @vitest-environment node

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupExpiredRuntimeState } from "../../src/server/data/cleanup.js";
import { runMigrations } from "../../src/server/data/migrations.js";
import { createPostgresRepositories } from "../../src/server/data/postgres-repositories.js";
import { assertSchemaReady } from "../../src/server/data/schema.js";
import { createPostgresTestDatabase, type PostgresTestDatabase } from "./helpers.js";

let testDatabase: PostgresTestDatabase;

beforeAll(async () => {
  testDatabase = await createPostgresTestDatabase();
});

afterAll(async () => {
  await testDatabase?.cleanup();
});

describe("PostgreSQL schema operations", () => {
  it("applies the complete schema idempotently and reports readiness", async () => {
    await runMigrations(testDatabase.database);
    await runMigrations(testDatabase.database);
    await expect(assertSchemaReady(testDatabase.database)).resolves.toBeUndefined();

    const tables = await testDatabase.database.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name"
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "admin_account_settings",
      "admin_course_connections",
      "admin_tool_preset_assignments",
      "admin_tool_presets",
      "assessments",
      "canvas_oauth_tokens",
      "courses",
      "operation_locks",
      "schema_migrations",
      "sessions",
      "transient_states"
    ]);

    const indexes = await testDatabase.database.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() ORDER BY indexname"
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "admin_course_connections_root_name_idx",
        "admin_course_connections_root_term_concluded_name_idx",
        "admin_account_settings_root_account_id_idx",
        "admin_tool_preset_assignments_preset_status_idx",
        "admin_tool_presets_root_account_id_idx",
        "assessments_course_id_idx",
        "canvas_oauth_tokens_user_id_unique_idx",
        "courses_course_id_idx",
        "operation_locks_expires_at_idx",
        "sessions_expires_at_idx",
        "transient_states_expires_at_idx"
      ])
    );
  });

  it("rejects checksum drift for an already-applied migration", async () => {
    const directory = copyMigrationDirectory();
    writeFileSync(join(directory, "001_initial_postgresql.sql"), "SELECT 1;\n", "utf8");
    await expect(runMigrations(testDatabase.database, directory)).rejects.toThrow(
      "PostgreSQL migration 1 does not match its applied checksum and name"
    );
    rmSync(directory, { recursive: true, force: true });
  });

  it("pages and summarizes root-account course connections without cross-tenant scans", async () => {
    const repositories = createPostgresRepositories(testDatabase.database);
    await repositories.adminCourseConnections.save("7:101", adminCourseConnection("7", "101", "Biology", 3, 2));
    await repositories.adminCourseConnections.save("7:102", adminCourseConnection("7", "102", "Chemistry", 4, 1));
    await repositories.adminCourseConnections.save("7:103", {
      ...adminCourseConnection("7", "103", "Archived Physics", 6, 4),
      termId: "21",
      concluded: true
    });
    await repositories.adminCourseConnections.save("9:201", adminCourseConnection("9", "201", "Biology II", 9, 9));

    await expect(repositories.adminCourseConnections.listForRoot("7", { search: "bio", limit: 25 })).resolves.toEqual([
      expect.objectContaining({ courseId: "101", name: "Biology" })
    ]);
    await expect(repositories.adminCourseConnections.summarizeForRoot("7")).resolves.toEqual({
      courseCount: 2,
      assessmentCount: 7,
      enabledAssessmentCount: 3,
      issueCount: 0
    });
    await expect(
      repositories.adminCourseConnections.listForRoot("7", { termId: "22", limit: 25 })
    ).resolves.toHaveLength(2);
    await expect(
      repositories.adminCourseConnections.listForRoot("7", { includePast: true, limit: 25 })
    ).resolves.toHaveLength(3);
    await repositories.adminAccountSettings.save("7", {
      id: "7",
      rootAccountId: "7",
      operationalTermId: "22",
      updatedByUserId: "42"
    });
    await expect(repositories.adminAccountSettings.get("7")).resolves.toMatchObject({ operationalTermId: "22" });
  });

  it("rolls back a failed migration without recording or retaining partial changes", async () => {
    const directory = copyMigrationDirectory();
    writeFileSync(
      join(directory, "007_broken.sql"),
      "CREATE TABLE must_rollback (id integer);\nSELECT definitely_not_valid;\n",
      "utf8"
    );

    await expect(runMigrations(testDatabase.database, directory)).rejects.toThrow();
    const table = await testDatabase.database.query<{ exists: boolean }>(
      "SELECT to_regclass(current_schema() || '.must_rollback') IS NOT NULL AS exists"
    );
    expect(table.rows[0]?.exists).toBe(false);
    const ledger = await testDatabase.database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations WHERE version = 7"
    );
    expect(ledger.rows[0]?.count).toBe("0");
    rmSync(directory, { recursive: true, force: true });
  });

  it("consolidates purpose-prefixed OAuth rows into one administrator-capable user record", async () => {
    const consolidationDatabase = await createPostgresTestDatabase();
    const preConsolidationDirectory = copyMigrationDirectory();
    rmSync(join(preConsolidationDirectory, "004_unify_canvas_oauth_tokens.sql"));
    try {
      await runMigrations(consolidationDatabase.database, preConsolidationDirectory);
      await consolidationDatabase.database.query(
        `INSERT INTO canvas_oauth_tokens (id, user_id, document)
         VALUES
           ($1, $2, $3::jsonb),
           ($4, $2, $5::jsonb)`,
        [
          "782",
          "782",
          JSON.stringify({
            id: "782",
            userId: "782",
            accessToken: "course-token",
            studentReadinessPromptDismissedAt: "2026-07-17T20:00:00.000Z"
          }),
          "account_admin:782",
          JSON.stringify({
            id: "account_admin:782",
            userId: "782",
            grantType: "account_admin",
            accessToken: "admin-token",
            requestedScopes: ["admin-scope"]
          })
        ]
      );

      await runMigrations(consolidationDatabase.database);

      const rows = await consolidationDatabase.database.query<{
        id: string;
        user_id: string;
        document: Record<string, unknown>;
      }>("SELECT id, user_id, document FROM canvas_oauth_tokens WHERE user_id = $1", ["782"]);
      expect(rows.rows).toEqual([
        expect.objectContaining({
          id: "782",
          user_id: "782",
          document: expect.objectContaining({
            id: "782",
            userId: "782",
            grantType: "account_admin",
            accessToken: "admin-token",
            studentReadinessPromptDismissedAt: "2026-07-17T20:00:00.000Z"
          })
        })
      ]);
      await expect(
        consolidationDatabase.database.query(
          "INSERT INTO canvas_oauth_tokens (id, user_id, document) VALUES ($1, $2, $3::jsonb)",
          ["duplicate-782", "782", JSON.stringify({ userId: "782", accessToken: "duplicate" })]
        )
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      rmSync(preConsolidationDirectory, { recursive: true, force: true });
      await consolidationDatabase.cleanup();
    }
  });

  it("deletes expired runtime rows in bounded, concurrent-safe batches", async () => {
    const repositories = createPostgresRepositories(testDatabase.database);
    const now = Date.now();
    for (const suffix of ["a", "b", "c"]) {
      await repositories.sessions.save(`cleanup-session-${suffix}`, {
        data: { suffix },
        expiresAt: new Date(now - 60_000)
      });
      await repositories.transientStates.save(`cleanup-state-${suffix}`, {
        kind: "seb-proof",
        expiresAt: new Date(now - 60_000)
      });
      await repositories.operationLocks.save(`cleanup-lock-${suffix}`, {
        ownerId: "expired-owner",
        expiresAt: new Date(now - 60_000)
      });
    }
    await repositories.sessions.save("cleanup-session-live", {
      data: { live: true },
      expiresAt: new Date(now + 60_000)
    });
    await repositories.transientStates.save("cleanup-state-live", {
      kind: "seb-proof",
      expiresAt: new Date(now + 60_000)
    });
    await repositories.operationLocks.save("cleanup-lock-live", {
      ownerId: "live-owner",
      expiresAt: new Date(now + 60_000)
    });

    const first = await cleanupExpiredRuntimeState(testDatabase.database, { batchSize: 1 });
    expect(first).toEqual({ sessions: 1, transientStates: 1, operationLocks: 1 });
    await Promise.all([
      cleanupExpiredRuntimeState(testDatabase.database, { batchSize: 1 }),
      cleanupExpiredRuntimeState(testDatabase.database, { batchSize: 1 })
    ]);
    await cleanupExpiredRuntimeState(testDatabase.database, { batchSize: 1, drain: true });

    for (const table of ["sessions", "transient_states", "operation_locks"]) {
      const rows = await testDatabase.database.query<{ id: string }>(
        `SELECT id FROM ${table} WHERE id LIKE 'cleanup-%' ORDER BY id`
      );
      expect(rows.rows.map((row) => row.id)).toEqual([expect.stringContaining("-live")]);
    }
  });
});

function adminCourseConnection(
  rootAccountId: string,
  courseId: string,
  name: string,
  assessmentCount: number,
  enabledAssessmentCount: number
) {
  return {
    id: `${rootAccountId}:${courseId}`,
    rootAccountId,
    canvasOrigin: "https://canvas.example.edu",
    courseId,
    name,
    courseCode: `${name.slice(0, 3).toUpperCase()}-${courseId}`,
    accountId: rootAccountId,
    workflowState: "available",
    concluded: false,
    termId: "22",
    termName: "Fall 2026",
    teacherNames: [],
    assessmentCount,
    enabledAssessmentCount,
    issueCount: 0,
    connectedByUserId: "42"
  };
}

function copyMigrationDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "seb-postgres-migrations-"));
  cpSync(join(process.cwd(), "src/server/data/migrations"), directory, { recursive: true });
  return directory;
}
