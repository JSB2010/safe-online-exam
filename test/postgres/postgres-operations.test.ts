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
        "assessments_course_id_idx",
        "canvas_oauth_tokens_user_id_idx",
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

  it("rolls back a failed migration without recording or retaining partial changes", async () => {
    const directory = copyMigrationDirectory();
    writeFileSync(
      join(directory, "002_broken.sql"),
      "CREATE TABLE must_rollback (id integer);\nSELECT definitely_not_valid;\n",
      "utf8"
    );

    await expect(runMigrations(testDatabase.database, directory)).rejects.toThrow();
    const table = await testDatabase.database.query<{ exists: boolean }>(
      "SELECT to_regclass(current_schema() || '.must_rollback') IS NOT NULL AS exists"
    );
    expect(table.rows[0]?.exists).toBe(false);
    const ledger = await testDatabase.database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations WHERE version = 2"
    );
    expect(ledger.rows[0]?.count).toBe("0");
    rmSync(directory, { recursive: true, force: true });
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

function copyMigrationDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "seb-postgres-migrations-"));
  cpSync(join(process.cwd(), "src/server/data/migrations"), directory, { recursive: true });
  return directory;
}
