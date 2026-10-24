import { diagnosticSpan } from "../diagnostics/tracing.js";
import { diagnostics } from "../diagnostics/runtime.js";
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import { AppConfig, type AppConfigSnapshot } from "../config/app-config.js";

export const POSTGRES_POOL = Symbol("POSTGRES_POOL");

export interface PostgresClientLike {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
  release(): void;
}

export interface PostgresPoolLike {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
  connect(): Promise<PostgresClientLike>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
}

export function createPoolConfig(database: AppConfigSnapshot["database"]): PoolConfig {
  return {
    host: database.host,
    port: database.port,
    database: database.name,
    user: database.user,
    password: database.password,
    ssl: sslConfiguration(database.sslMode),
    max: database.poolMax,
    connectionTimeoutMillis: database.connectionTimeoutMs,
    statement_timeout: database.statementTimeoutMs
  };
}

export async function withTransaction<T>(
  pool: Pick<PostgresPoolLike, "connect">,
  operation: (client: PostgresClientLike) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the operation error; the broken connection is discarded on release.
    }
    throw error;
  } finally {
    client.release();
  }
}

@Injectable()
export class PostgresDatabase implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresDatabase.name);
  private readonly pool: PostgresPoolLike;
  private closePromise?: Promise<void>;

  constructor(config: AppConfig, @Optional() @Inject(POSTGRES_POOL) pool?: PostgresPoolLike) {
    this.pool = pool ?? (new Pool(createPoolConfig(config.value.database)) as PostgresPoolLike);
    this.pool.on("error", (error) => {
      const code = typeof error.code === "string" ? error.code : "unknown";
      this.logger.error(`PostgreSQL idle client error (${code})`);
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<T>> {
    const started = Date.now();
    try {
      return (await diagnosticSpan("database.query", () => this.pool.query(text, values))) as QueryResult<T>;
    } catch (error) {
      diagnostics.failure("database.query", error, {
        durationMs: Date.now() - started,
        details: {
          queryCategory: /^\s*(SELECT|UPDATE|INSERT|DELETE|BEGIN|COMMIT)/iu.exec(text)?.[1]?.toUpperCase() || "OTHER"
        }
      });
      throw error;
    }
  }

  async connect(): Promise<PostgresClientLike> {
    const started = Date.now();
    try {
      const client = await this.pool.connect();
      diagnostics.record("database.pool", { outcome: "succeeded", durationMs: Date.now() - started });
      return client;
    } catch (error) {
      diagnostics.failure("database.pool", error, { durationMs: Date.now() - started });
      throw error;
    }
  }

  withTransaction<T>(operation: (client: PostgresClientLike) => Promise<T>): Promise<T> {
    return withTransaction({ connect: () => this.connect() }, async (client) => {
      const wrapped: PostgresClientLike = {
        query: async (text, values) => {
          try {
            return await client.query(text, values);
          } catch (error) {
            diagnostics.failure("database.transaction", error);
            throw error;
          }
        },
        release: () => client.release()
      };
      return operation(wrapped);
    });
  }

  async checkConnection(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  close(): Promise<void> {
    this.closePromise ??= this.pool.end();
    return this.closePromise;
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}

function sslConfiguration(mode: AppConfigSnapshot["database"]["sslMode"]): PoolConfig["ssl"] {
  switch (mode) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-ca":
    case "verify-full":
      return { rejectUnauthorized: true };
  }
}
