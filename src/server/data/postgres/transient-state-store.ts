import { prepareDocument } from "../document-values.js";
import type { PostgresDatabase } from "../postgres-client.js";
import type { QueryFilter, TransientStateRecord, TransientStateStore } from "../repository-contracts.js";
import { DocumentRow, SqlExecutor, buildWhereClause, queryRows, toDate, toIso } from "./collection-store.js";

export class PostgresTransientStateStore implements TransientStateStore {
  constructor(private readonly database: PostgresDatabase) {}

  async get(id: string): Promise<TransientStateRecord | null> {
    const rows = await this.select(this.database, "WHERE id = $1", [id]);
    return rows[0] ? decodeTransient(rows[0]) : null;
  }

  save(id: string, value: TransientStateRecord): Promise<TransientStateRecord> {
    return this.write(this.database, id, value);
  }

  update(
    id: string,
    updater: (current: TransientStateRecord | null) => TransientStateRecord | null
  ): Promise<TransientStateRecord | null> {
    return this.database.withTransaction(async (client) => {
      const rows = await this.select(client, "WHERE id = $1 FOR UPDATE", [id]);
      const updated = updater(rows[0] ? decodeTransient(rows[0]) : null);
      return updated ? this.write(client, id, updated) : null;
    });
  }

  async delete(id: string): Promise<void> {
    await this.database.query("DELETE FROM transient_states WHERE id = $1", [id]);
  }

  async find(filters: QueryFilter[] = []): Promise<TransientStateRecord[]> {
    const { clause, values } = buildWhereClause(filters, {
      id: "id",
      kind: "kind",
      courseId: "course_id",
      contentId: "content_id",
      consumedAt: "consumed_at"
    });
    return (await this.select(this.database, clause, values)).map(decodeTransient);
  }

  saveMany(values: Array<{ id: string; value: TransientStateRecord }>): Promise<TransientStateRecord[]> {
    return this.database.withTransaction(async (client) => {
      const saved: TransientStateRecord[] = [];
      for (const entry of values) {
        saved.push(await this.write(client, entry.id, entry.value));
      }
      return saved;
    });
  }

  async claim(id: string, value: TransientStateRecord): Promise<boolean> {
    const now = new Date();
    const document = prepareDocument(id, value, now.toISOString());
    const rows = await queryRows<{ id: string }>(
      this.database,
      `INSERT INTO transient_states
         (id, kind, document, course_id, content_id, budget_count, expires_at, consumed_at, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, document = EXCLUDED.document,
         course_id = EXCLUDED.course_id, content_id = EXCLUDED.content_id,
         budget_count = EXCLUDED.budget_count, expires_at = EXCLUDED.expires_at,
         consumed_at = EXCLUDED.consumed_at, updated_at = EXCLUDED.updated_at
       WHERE transient_states.expires_at <= now()
       RETURNING id`,
      transientParameters(id, document, now)
    );
    return rows.length === 1;
  }

  async consume(id: string): Promise<TransientStateRecord | null> {
    const consumedAt = new Date().toISOString();
    const rows = await queryRows<TransientRow>(
      this.database,
      `UPDATE transient_states
       SET consumed_at = $2, updated_at = $2,
         document = document || jsonb_build_object('consumedAt', $3::text, 'updatedAt', $3::text)
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING id, kind, document, course_id, content_id, budget_count, expires_at, consumed_at,
         created_at, updated_at`,
      [id, new Date(consumedAt), consumedAt]
    );
    if (rows[0]) {
      return decodeTransient(rows[0]);
    }
    await this.database.query("DELETE FROM transient_states WHERE id = $1 AND expires_at <= now()", [id]);
    return null;
  }

  async consumeBudget(id: string, limit: number, windowMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      return false;
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowMs);
    const document = prepareDocument(
      id,
      { kind: "admission-budget", count: 1, expiresAt } as TransientStateRecord,
      now.toISOString()
    );
    const rows = await queryRows<{ id: string }>(
      this.database,
      `INSERT INTO transient_states
         (id, kind, document, budget_count, expires_at, created_at, updated_at)
       VALUES ($1, 'admission-budget', $2::jsonb, 1, $3, $4, $4)
       ON CONFLICT (id) DO UPDATE SET
         kind = 'admission-budget',
         budget_count = CASE
           WHEN transient_states.kind <> 'admission-budget' OR transient_states.expires_at <= now() THEN 1
           ELSE COALESCE(transient_states.budget_count, 0) + 1 END,
         expires_at = CASE
           WHEN transient_states.kind <> 'admission-budget' OR transient_states.expires_at <= now()
             THEN EXCLUDED.expires_at ELSE transient_states.expires_at END,
         document = CASE
           WHEN transient_states.kind <> 'admission-budget' OR transient_states.expires_at <= now()
             THEN EXCLUDED.document
           ELSE transient_states.document || jsonb_build_object(
             'count', COALESCE(transient_states.budget_count, 0) + 1,
             'updatedAt', EXCLUDED.document->'updatedAt') END,
         consumed_at = NULL,
         updated_at = EXCLUDED.updated_at
       WHERE transient_states.kind <> 'admission-budget'
          OR transient_states.expires_at <= now()
          OR COALESCE(transient_states.budget_count, 0) < $5
       RETURNING id`,
      [id, JSON.stringify(document), expiresAt, now, limit]
    );
    return rows.length === 1;
  }

  private select(executor: SqlExecutor, suffix: string, values: readonly unknown[]): Promise<TransientRow[]> {
    return queryRows<TransientRow>(
      executor,
      `SELECT id, kind, document, course_id, content_id, budget_count, expires_at, consumed_at,
         created_at, updated_at FROM transient_states ${suffix}`,
      values
    );
  }

  private async write(executor: SqlExecutor, id: string, value: TransientStateRecord): Promise<TransientStateRecord> {
    const now = new Date();
    const document = prepareDocument(id, value, now.toISOString());
    const rows = await queryRows<TransientRow>(
      executor,
      `INSERT INTO transient_states
         (id, kind, document, course_id, content_id, budget_count, expires_at, consumed_at, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, document = EXCLUDED.document,
         course_id = EXCLUDED.course_id, content_id = EXCLUDED.content_id,
         budget_count = EXCLUDED.budget_count, expires_at = EXCLUDED.expires_at,
         consumed_at = EXCLUDED.consumed_at, updated_at = EXCLUDED.updated_at
       RETURNING id, kind, document, course_id, content_id, budget_count, expires_at, consumed_at,
         created_at, updated_at`,
      transientParameters(id, document, now)
    );
    return decodeTransient(rows[0]!);
  }
}

interface TransientRow extends DocumentRow {
  kind: TransientStateRecord["kind"];
  course_id: string | null;
  content_id: string | null;
  budget_count: number | null;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

function decodeTransient(row: TransientRow): TransientStateRecord {
  return {
    ...row.document,
    id: row.id,
    kind: row.kind,
    courseId: row.course_id,
    contentId: row.content_id,
    count: row.budget_count ?? row.document.count,
    expiresAt: toDate(row.expires_at),
    consumedAt: row.consumed_at ? toIso(row.consumed_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  } as TransientStateRecord;
}

function transientParameters(id: string, document: TransientStateRecord, now: Date): readonly unknown[] {
  return [
    id,
    document.kind,
    JSON.stringify(document),
    document.courseId ?? null,
    document.contentId ?? null,
    document.kind === "admission-budget" ? Number(document.count) || 0 : null,
    document.expiresAt,
    document.consumedAt ? new Date(document.consumedAt) : null,
    now
  ];
}
