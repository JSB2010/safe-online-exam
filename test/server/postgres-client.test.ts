// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { AppConfig, AppConfigSnapshot } from "../../src/server/config/app-config.js";
import {
  createPoolConfig,
  PostgresDatabase,
  type PostgresPoolLike,
  withTransaction
} from "../../src/server/data/postgres-client.js";

describe("PostgreSQL client", () => {
  it.each([
    ["disable", false],
    ["require", { rejectUnauthorized: false }],
    ["verify-ca", { rejectUnauthorized: true }],
    ["verify-full", { rejectUnauthorized: true }]
  ] as const)("maps %s SSL explicitly", (sslMode, expected) => {
    expect(createPoolConfig(databaseConfig({ sslMode })).ssl).toEqual(expected);
  });

  it("builds a bounded pool configuration", () => {
    expect(createPoolConfig(databaseConfig())).toMatchObject({
      host: "db.internal",
      port: 5432,
      database: "canvas_seb",
      user: "canvas_runtime",
      password: "database-secret",
      max: 7,
      connectionTimeoutMillis: 12_000,
      statement_timeout: 45_000
    });
  });

  it("commits and releases successful transactions", async () => {
    const client = transactionClient();
    const pool = { connect: vi.fn().mockResolvedValue(client) };

    await expect(withTransaction(pool, async () => "ok")).resolves.toBe("ok");
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back, releases, and preserves the original transaction error", async () => {
    const client = transactionClient();
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    const failure = new Error("operation failed");

    await expect(
      withTransaction(pool, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("checks connectivity and closes the pool idempotently", async () => {
    const pool = poolDouble();
    const database = new PostgresDatabase(configDouble(), pool);

    await expect(database.checkConnection()).resolves.toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
    await Promise.all([database.close(), database.close()]);
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("registers an idle-client error handler without reflecting query or password values", () => {
    const pool = poolDouble();
    new PostgresDatabase(configDouble(), pool);

    expect(pool.on).toHaveBeenCalledWith("error", expect.any(Function));
    const handler = pool.on.mock.calls.find(([event]) => event === "error")?.[1] as (error: Error) => void;
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    handler(Object.assign(new Error("SELECT secret_value FROM tokens"), { code: "XX001" }));
    expect(logger.mock.calls.flat().join(" ")).not.toContain("secret_value");
    logger.mockRestore();
  });
});

function databaseConfig(overrides: Partial<AppConfigSnapshot["database"]> = {}): AppConfigSnapshot["database"] {
  return {
    host: "db.internal",
    port: 5432,
    name: "canvas_seb",
    user: "canvas_runtime",
    password: "database-secret",
    sslMode: "disable",
    poolMax: 7,
    connectionTimeoutMs: 12_000,
    statementTimeoutMs: 45_000,
    ...overrides
  };
}

function configDouble(): AppConfig {
  return { value: { database: databaseConfig() } } as AppConfig;
}

function transactionClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn()
  };
}

function poolDouble() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    connect: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn()
  } satisfies PostgresPoolLike & { on: ReturnType<typeof vi.fn> };
}
