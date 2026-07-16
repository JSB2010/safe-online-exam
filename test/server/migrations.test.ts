// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverMigrations, migrationDirectoryCandidates, runMigrations } from "../../src/server/data/migrations.js";
import { EXPECTED_SCHEMA_VERSION } from "../../src/server/data/schema.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PostgreSQL migrations", () => {
  it("discovers ordered numeric migrations with stable SHA-256 checksums", () => {
    const directory = temporaryMigrationDirectory({
      "010_tenth.sql": "SELECT 10;\n",
      "002_second.sql": "SELECT 2;\n"
    });

    const first = discoverMigrations(directory);
    const second = discoverMigrations(directory);
    expect(first.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 2, name: "second" },
      { version: 10, name: "tenth" }
    ]);
    expect(first[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.map((migration) => migration.checksum)).toEqual(first.map((migration) => migration.checksum));
  });

  it("rejects duplicate versions and malformed migration filenames", () => {
    expect(() =>
      discoverMigrations(
        temporaryMigrationDirectory({ "001_initial.sql": "SELECT 1;", "001_duplicate.sql": "SELECT 2;" })
      )
    ).toThrow("Duplicate PostgreSQL migration version 1");
    expect(() => discoverMigrations(temporaryMigrationDirectory({ "initial.sql": "SELECT 1;" }))).toThrow(
      "Invalid PostgreSQL migration filename: initial.sql"
    );
  });

  it("searches both source and built SQL asset locations", () => {
    expect(migrationDirectoryCandidates("/workspace/app")).toEqual([
      "/workspace/app/src/server/data/migrations",
      "/workspace/app/dist/server/server/data/migrations"
    ]);
  });

  it("declares the initial schema as version one", () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe(1);
    expect(discoverMigrations().map((migration) => migration.version)).toEqual([1]);
  });

  it("locks, applies pending migrations transactionally, and unlocks", async () => {
    const directory = temporaryMigrationDirectory({ "001_initial.sql": "SELECT 'schema';" });
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] }),
      release: vi.fn()
    };
    const database = { connect: vi.fn().mockResolvedValue(client) };

    await runMigrations(database, directory);

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining(["BEGIN", "SELECT 'schema';", "COMMIT"])
    );
    expect(client.query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

function temporaryMigrationDirectory(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "seb-migrations-"));
  temporaryDirectories.push(directory);
  mkdirSync(directory, { recursive: true });
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(directory, name), sql, "utf8");
  }
  return directory;
}
