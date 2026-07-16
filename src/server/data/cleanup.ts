import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { AppConfig } from "../config/app-config.js";
import { PostgresDatabase } from "./postgres-client.js";

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 10_000;

export interface CleanupCounts {
  sessions: number;
  transientStates: number;
  operationLocks: number;
}

export interface CleanupOptions {
  batchSize?: number;
  drain?: boolean;
}

export async function cleanupExpiredRuntimeState(
  database: Pick<PostgresDatabase, "query">,
  options: CleanupOptions = {}
): Promise<CleanupCounts> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Cleanup batch size must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  const totals: CleanupCounts = { sessions: 0, transientStates: 0, operationLocks: 0 };
  let continueDraining = true;
  while (continueDraining) {
    const pass = {
      sessions: await deleteExpiredBatch(database, "sessions", batchSize),
      transientStates: await deleteExpiredBatch(database, "transient_states", batchSize),
      operationLocks: await deleteExpiredBatch(database, "operation_locks", batchSize)
    };
    totals.sessions += pass.sessions;
    totals.transientStates += pass.transientStates;
    totals.operationLocks += pass.operationLocks;
    continueDraining =
      options.drain === true && Math.max(pass.sessions, pass.transientStates, pass.operationLocks) >= batchSize;
  }
  return totals;
}

async function deleteExpiredBatch(
  database: Pick<PostgresDatabase, "query">,
  table: "sessions" | "transient_states" | "operation_locks",
  batchSize: number
): Promise<number> {
  const result = await database.query<{ id: string }>(
    `WITH expired AS (
       SELECT id FROM ${table}
       WHERE expires_at <= now()
       ORDER BY expires_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM ${table} target
     USING expired
     WHERE target.id = expired.id
     RETURNING target.id`,
    [batchSize]
  );
  return result.rowCount ?? result.rows.length;
}

async function main(): Promise<void> {
  const database = new PostgresDatabase(new AppConfig());
  try {
    const counts = await cleanupExpiredRuntimeState(database, {
      batchSize: parseBatchSize(process.env.DATABASE_CLEANUP_BATCH_SIZE),
      drain: process.argv.includes("--drain")
    });
    console.log(
      `Expired runtime cleanup complete: sessions=${counts.sessions} transientStates=${counts.transientStates} operationLocks=${counts.operationLocks}`
    );
  } finally {
    await database.close();
  }
}

function parseBatchSize(value: string | undefined): number {
  if (!value) {
    return DEFAULT_BATCH_SIZE;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    throw new Error(`DATABASE_CLEANUP_BATCH_SIZE must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  return parsed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown cleanup failure";
    console.error(`PostgreSQL cleanup failed: ${message}`);
    process.exitCode = 1;
  });
}
