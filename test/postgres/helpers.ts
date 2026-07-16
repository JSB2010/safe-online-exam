import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { AppConfig } from "../../src/server/config/app-config.js";
import { PostgresDatabase, type PostgresPoolLike } from "../../src/server/data/postgres-client.js";

export interface PostgresTestDatabase {
  database: PostgresDatabase;
  schema: string;
  cleanup(): Promise<void>;
}

export async function createPostgresTestDatabase(): Promise<PostgresTestDatabase> {
  const connectionString = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests");
  }
  const schema = `seb_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000 });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
    max: 8,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000
  });
  const database = new PostgresDatabase(configDouble(), pool as unknown as PostgresPoolLike);

  return {
    database,
    schema,
    async cleanup() {
      await database.close();
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await adminPool.end();
      }
    }
  };
}

function configDouble(): AppConfig {
  return {
    value: {
      database: {
        host: "127.0.0.1",
        port: 5432,
        name: "test",
        user: "test",
        sslMode: "disable",
        poolMax: 8,
        connectionTimeoutMs: 10_000,
        statementTimeoutMs: 30_000
      }
    }
  } as AppConfig;
}
