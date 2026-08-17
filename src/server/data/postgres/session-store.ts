import { stripUndefinedValues } from "../document-values.js";
import type { PostgresDatabase } from "../postgres-client.js";
import type { CollectionStore, QueryFilter, SessionRecord } from "../repository-contracts.js";
import { SqlExecutor, buildWhereClause, queryRows, toDate, toIso } from "./collection-store.js";

export class PostgresSessionStore implements CollectionStore<SessionRecord> {
  constructor(private readonly database: PostgresDatabase) {}

  async get(id: string): Promise<SessionRecord | null> {
    await this.database.query("DELETE FROM sessions WHERE id = $1 AND expires_at <= now()", [id]);
    const rows = await queryRows<SessionRow>(
      this.database,
      "SELECT id, data, expires_at, created_at, updated_at FROM sessions WHERE id = $1",
      [id]
    );
    return rows[0] ? decodeSession(rows[0]) : null;
  }

  async save(id: string, value: SessionRecord): Promise<SessionRecord> {
    return this.write(this.database, id, value);
  }

  update(id: string, updater: (current: SessionRecord | null) => SessionRecord | null): Promise<SessionRecord | null> {
    return this.database.withTransaction(async (client) => {
      const rows = await queryRows<SessionRow>(
        client,
        "SELECT id, data, expires_at, created_at, updated_at FROM sessions WHERE id = $1 FOR UPDATE",
        [id]
      );
      const updated = updater(rows[0] ? decodeSession(rows[0]) : null);
      return updated ? this.write(client, id, updated) : null;
    });
  }

  async delete(id: string): Promise<void> {
    await this.database.query("DELETE FROM sessions WHERE id = $1", [id]);
  }

  async find(filters: QueryFilter[] = []): Promise<SessionRecord[]> {
    const { clause, values } = buildWhereClause(filters, { id: "id", expiresAt: "expires_at" });
    const rows = await queryRows<SessionRow>(
      this.database,
      `SELECT id, data, expires_at, created_at, updated_at FROM sessions${clause} ORDER BY id`,
      values
    );
    return rows.map(decodeSession);
  }

  saveMany(values: Array<{ id: string; value: SessionRecord }>): Promise<SessionRecord[]> {
    return this.database.withTransaction(async (client) => {
      const saved: SessionRecord[] = [];
      for (const entry of values) {
        saved.push(await this.write(client, entry.id, entry.value));
      }
      return saved;
    });
  }

  private async write(executor: SqlExecutor, id: string, value: SessionRecord): Promise<SessionRecord> {
    const now = new Date();
    const rows = await queryRows<SessionRow>(
      executor,
      `INSERT INTO sessions (id, data, expires_at, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $4)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at,
         updated_at = EXCLUDED.updated_at
       RETURNING id, data, expires_at, created_at, updated_at`,
      [id, JSON.stringify(stripUndefinedValues(value.data)), value.expiresAt, now]
    );
    return decodeSession(rows[0]!);
  }
}

interface SessionRow {
  id: string;
  data: Record<string, unknown>;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function decodeSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    data: row.data,
    expiresAt: toDate(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}
