import type { PostgresDatabase } from "../postgres-client.js";
import type { OperationLockRecord, OperationLockStore, QueryFilter } from "../repository-contracts.js";
import { buildWhereClause, queryRows, toDate, toIso } from "./collection-store.js";

export class PostgresOperationLockStore implements OperationLockStore {
  constructor(private readonly database: PostgresDatabase) {}

  async get(id: string): Promise<OperationLockRecord | null> {
    const rows = await queryRows<LockRow>(
      this.database,
      "SELECT id, owner_id, expires_at, created_at, updated_at FROM operation_locks WHERE id = $1",
      [id]
    );
    return rows[0] ? decodeLock(rows[0]) : null;
  }

  async save(id: string, value: OperationLockRecord): Promise<OperationLockRecord> {
    const now = new Date();
    const rows = await queryRows<LockRow>(
      this.database,
      `INSERT INTO operation_locks (id, owner_id, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at
       RETURNING id, owner_id, expires_at, created_at, updated_at`,
      [id, value.ownerId, value.expiresAt, now]
    );
    return decodeLock(rows[0]!);
  }

  async update(
    id: string,
    updater: (current: OperationLockRecord | null) => OperationLockRecord | null
  ): Promise<OperationLockRecord | null> {
    return this.database.withTransaction(async (client) => {
      const rows = await queryRows<LockRow>(
        client,
        "SELECT id, owner_id, expires_at, created_at, updated_at FROM operation_locks WHERE id = $1 FOR UPDATE",
        [id]
      );
      const updated = updater(rows[0] ? decodeLock(rows[0]) : null);
      return updated ? this.save(id, updated) : null;
    });
  }

  async delete(id: string): Promise<void> {
    await this.database.query("DELETE FROM operation_locks WHERE id = $1", [id]);
  }

  async find(filters: QueryFilter[] = []): Promise<OperationLockRecord[]> {
    const { clause, values } = buildWhereClause(filters, { id: "id", ownerId: "owner_id" });
    const rows = await queryRows<LockRow>(
      this.database,
      `SELECT id, owner_id, expires_at, created_at, updated_at FROM operation_locks${clause} ORDER BY id`,
      values
    );
    return rows.map(decodeLock);
  }

  saveMany(values: Array<{ id: string; value: OperationLockRecord }>): Promise<OperationLockRecord[]> {
    return this.database.withTransaction(async () => {
      const saved: OperationLockRecord[] = [];
      for (const entry of values) {
        saved.push(await this.save(entry.id, entry.value));
      }
      return saved;
    });
  }

  async acquire(id: string, ownerId: string, ttlMs: number): Promise<boolean> {
    if (!validTtl(ttlMs)) {
      return false;
    }
    const now = new Date();
    const rows = await queryRows<{ id: string }>(
      this.database,
      `INSERT INTO operation_locks (id, owner_id, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at
       WHERE operation_locks.owner_id = EXCLUDED.owner_id OR operation_locks.expires_at <= now()
       RETURNING id`,
      [id, ownerId, new Date(now.getTime() + ttlMs), now]
    );
    return rows.length === 1;
  }

  async renew(id: string, ownerId: string, ttlMs: number): Promise<boolean> {
    if (!validTtl(ttlMs)) {
      return false;
    }
    const rows = await queryRows<{ id: string }>(
      this.database,
      `UPDATE operation_locks SET expires_at = $3, updated_at = $2
       WHERE id = $1 AND owner_id = $4 AND expires_at > $2 RETURNING id`,
      [id, new Date(), new Date(Date.now() + ttlMs), ownerId]
    );
    return rows.length === 1;
  }

  async release(id: string, ownerId: string): Promise<void> {
    await this.database.query("DELETE FROM operation_locks WHERE id = $1 AND (owner_id = $2 OR expires_at <= now())", [
      id,
      ownerId
    ]);
  }
}

interface LockRow {
  id: string;
  owner_id: string;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function decodeLock(row: LockRow): OperationLockRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    expiresAt: toDate(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function validTtl(ttlMs: number): boolean {
  return Number.isSafeInteger(ttlMs) && ttlMs > 0;
}
