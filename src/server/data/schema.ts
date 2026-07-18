import type { PostgresDatabase } from "./postgres-client.js";

export const EXPECTED_SCHEMA_VERSION = 5;

export async function assertSchemaReady(database: Pick<PostgresDatabase, "query">): Promise<void> {
  let version: number;
  try {
    const result = await database.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0)::int AS version FROM schema_migrations"
    );
    version = Number(result.rows[0]?.version ?? 0);
  } catch (error) {
    throw new Error("PostgreSQL schema is unavailable; run the database migrations", { cause: error });
  }
  if (version !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`PostgreSQL schema version ${version} does not match required version ${EXPECTED_SCHEMA_VERSION}`);
  }
}
