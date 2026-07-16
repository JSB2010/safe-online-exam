import { AppConfig } from "../config/app-config.js";
import { runMigrations } from "./migrations.js";
import { PostgresDatabase } from "./postgres-client.js";

async function main(): Promise<void> {
  const database = new PostgresDatabase(new AppConfig());
  try {
    await runMigrations(database);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration failure";
  console.error(`PostgreSQL migration failed: ${message}`);
  process.exitCode = 1;
});
