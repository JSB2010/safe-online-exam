import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PostgresClientLike } from "./postgres-client.js";

const MIGRATION_LOCK_ID = 741_037_197;
const MIGRATION_FILENAME = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/u;

export interface PostgresMigration {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface MigrationDatabase {
  connect(): Promise<PostgresClientLike>;
}

export function migrationDirectoryCandidates(cwd = process.cwd()): string[] {
  return [join(cwd, "src/server/data/migrations"), join(cwd, "dist/server/server/data/migrations")];
}

export function discoverMigrations(directory = resolveMigrationDirectory()): PostgresMigration[] {
  const migrations = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .map((fileName) => readMigration(directory, fileName))
    .sort((left, right) => left.version - right.version);
  const versions = new Set<number>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate PostgreSQL migration version ${migration.version}`);
    }
    versions.add(migration.version);
  }
  return migrations;
}

export async function runMigrations(database: MigrationDatabase, directory?: string): Promise<void> {
  const migrations = discoverMigrations(directory);
  const client = await database.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = (await client.query(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
    )) as { rows: Array<{ version: number; name: string; checksum: string }> };
    const applied = new Map(appliedResult.rows.map((row) => [Number(row.version), row]));

    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing) {
        if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
          throw new Error(`PostgreSQL migration ${migration.version} does not match its applied checksum and name`);
        }
        continue;
      }
      await applyMigration(client, migration);
    }
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
      } catch {
        // Releasing the dedicated client also releases its session-level advisory lock.
      }
    }
    client.release();
  }
}

function resolveMigrationDirectory(): string {
  const directory = migrationDirectoryCandidates().find((candidate) => existsSync(candidate));
  if (!directory) {
    throw new Error("PostgreSQL migration assets are missing");
  }
  return directory;
}

function readMigration(directory: string, fileName: string): PostgresMigration {
  const match = MIGRATION_FILENAME.exec(fileName);
  if (!match) {
    throw new Error(`Invalid PostgreSQL migration filename: ${fileName}`);
  }
  const version = Number.parseInt(match[1]!, 10);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`Invalid PostgreSQL migration version in ${fileName}`);
  }
  const sql = readFileSync(join(directory, fileName), "utf8");
  return {
    version,
    name: match[2]!,
    fileName,
    sql,
    checksum: createHash("sha256").update(sql, "utf8").digest("hex")
  };
}

async function applyMigration(client: PostgresClientLike, migration: PostgresMigration): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
      migration.version,
      migration.name,
      migration.checksum
    ]);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the migration failure.
    }
    throw error;
  }
}
