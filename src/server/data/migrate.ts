import { AppConfig } from "../config/app-config.js";
import { runMigrations } from "./migrations.js";
import { PostgresDatabase } from "./postgres-client.js";
import { assertSchemaReady } from "./schema.js";

async function main(): Promise<void> {
  const config = new AppConfig();
  const database = new PostgresDatabase(config);
  try {
    await runMigrations(database);
    await assertSchemaReady(database, config.value.database.schemaCompatibilityProfile);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration failure";
  console.error(`PostgreSQL migration failed: ${message}`);
  process.exitCode = 1;
});
