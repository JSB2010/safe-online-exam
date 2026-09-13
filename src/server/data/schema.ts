import type { PostgresDatabase } from "./postgres-client.js";
import {
  GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE,
  isDatabaseSchemaCompatibilityProfile,
  STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE
} from "./schema-compatibility.js";

export const EXPECTED_SCHEMA_VERSION = 6;
const GOOGLE_DOCS_STAGE2_V7_MIGRATION = {
  version: 7,
  name: "google_docs_stage2",
  checksum: "c439022d14c0d2091151b3e468d59d7981babfb2c2ec334ae182ddee47a15dc5"
} as const;

interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

export async function assertSchemaReady(
  database: Pick<PostgresDatabase, "query">,
  compatibilityProfile = STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE
): Promise<void> {
  if (!isDatabaseSchemaCompatibilityProfile(compatibilityProfile)) {
    throw new Error(`Unsupported PostgreSQL schema compatibility profile: ${compatibilityProfile}`);
  }
  let appliedMigrations: AppliedMigration[];
  try {
    const result = await database.query<AppliedMigration>(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
    );
    appliedMigrations = result.rows.map((row) => ({ ...row, version: Number(row.version) }));
  } catch (error) {
    throw new Error("PostgreSQL schema is unavailable; run the database migrations", { cause: error });
  }

  const version = appliedMigrations.at(-1)?.version ?? 0;
  if (version === EXPECTED_SCHEMA_VERSION) {
    return;
  }
  if (
    compatibilityProfile === GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE &&
    version === GOOGLE_DOCS_STAGE2_V7_MIGRATION.version
  ) {
    const migration = appliedMigrations.find(({ version: migrationVersion }) => migrationVersion === version);
    if (
      migration?.name === GOOGLE_DOCS_STAGE2_V7_MIGRATION.name &&
      migration.checksum === GOOGLE_DOCS_STAGE2_V7_MIGRATION.checksum
    ) {
      return;
    }
    throw new Error(
      `PostgreSQL schema migration ${version} does not match the approved ${compatibilityProfile} migration`
    );
  }
  if (version !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`PostgreSQL schema version ${version} does not match required version ${EXPECTED_SCHEMA_VERSION}`);
  }
}
