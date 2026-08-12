import { prepareDocument } from "../document-values.js";
import type { PostgresClientLike, PostgresDatabase } from "../postgres-client.js";
import type { CollectionStore, QueryFilter, QueryOptions } from "../repository-contracts.js";

export interface DocumentMapping<T> {
  table: string;
  extracted: Array<{ field: keyof T & string; column: string }>;
}

export interface DocumentRow {
  id: string;
  document: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

export type SqlExecutor = Pick<PostgresDatabase, "query"> | PostgresClientLike;

export class PostgresCollectionStore<T extends Record<string, any>> implements CollectionStore<T> {
  constructor(
    protected readonly database: PostgresDatabase,
    private readonly mapping: DocumentMapping<T>
  ) {}

  async get(id: string): Promise<T | null> {
    const rows = await queryRows<DocumentRow>(
      this.database,
      `SELECT id, document, created_at, updated_at FROM ${this.mapping.table} WHERE id = $1`,
      [id]
    );
    return rows[0] ? decodeDocument<T>(rows[0]) : null;
  }

  save(id: string, value: T): Promise<T> {
    return this.write(this.database, id, value);
  }

  async update(id: string, updater: (current: T | null) => T | null): Promise<T | null> {
    return this.database.withTransaction(async (client) => {
      const rows = await queryRows<DocumentRow>(
        client,
        `SELECT id, document, created_at, updated_at FROM ${this.mapping.table} WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const updated = updater(rows[0] ? decodeDocument<T>(rows[0]) : null);
      return updated ? this.write(client, id, updated) : null;
    });
  }

  async delete(id: string): Promise<void> {
    await this.database.query(`DELETE FROM ${this.mapping.table} WHERE id = $1`, [id]);
  }

  async find(filters: QueryFilter[] = [], options: QueryOptions = {}): Promise<T[]> {
    const { clause, values } = buildWhereClause(filters, fieldColumns(this.mapping));
    const orderBy =
      options.orderBy === "createdAt" ? "created_at" : options.orderBy === "updatedAt" ? "updated_at" : "id";
    const direction = options.direction === "desc" ? "DESC" : "ASC";
    const limit = normalizedQueryLimit(options.limit);
    const rows = await queryRows<DocumentRow>(
      this.database,
      `SELECT id, document, created_at, updated_at FROM ${this.mapping.table}${clause} ORDER BY ${orderBy} ${direction}${limit ? ` LIMIT ${limit}` : ""}`,
      values
    );
    return rows.map((row) => decodeDocument<T>(row));
  }

  saveMany(values: Array<{ id: string; value: T }>): Promise<T[]> {
    return this.database.withTransaction(async (client) => {
      const saved: T[] = [];
      for (const entry of values) {
        saved.push(await this.write(client, entry.id, entry.value));
      }
      return saved;
    });
  }

  private async write(executor: SqlExecutor, id: string, value: T): Promise<T> {
    const now = new Date();
    const document = prepareDocument(id, value, now.toISOString());
    const columns = this.mapping.extracted.map(({ column }) => column);
    const extractedValues = this.mapping.extracted.map(({ field }) => document[field] ?? null);
    const parameters = [id, JSON.stringify(document), now, ...extractedValues];
    const insertColumns = ["id", "document", "created_at", "updated_at", ...columns];
    const placeholders = ["$1", "$2::jsonb", "$3", "$3", ...columns.map((_, index) => `$${index + 4}`)];
    const updates = ["document = EXCLUDED.document", "updated_at = EXCLUDED.updated_at"]
      .concat(columns.map((column) => `${column} = EXCLUDED.${column}`))
      .join(", ");
    const rows = await queryRows<DocumentRow>(
      executor,
      `INSERT INTO ${this.mapping.table} (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")})
       ON CONFLICT (id) DO UPDATE SET ${updates}
       RETURNING id, document, created_at, updated_at`,
      parameters
    );
    return decodeDocument<T>(rows[0]!);
  }
}

function normalizedQueryLimit(limit: number | undefined): number | null {
  return Number.isSafeInteger(limit) && Number(limit) > 0 ? Math.min(Number(limit), 10_000) : null;
}

export async function queryRows<T>(executor: SqlExecutor, text: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = (await executor.query(text, values)) as { rows: T[] };
  return result.rows;
}

export function decodeDocument<T extends Record<string, any>>(row: DocumentRow): T {
  return {
    ...row.document,
    id: row.id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  } as unknown as T;
}

function fieldColumns<T>(mapping: DocumentMapping<T>): Record<string, string> {
  return Object.fromEntries([["id", "id"], ...mapping.extracted.map(({ field, column }) => [field, column])]);
}

export function buildWhereClause(
  filters: QueryFilter[],
  allowedColumns: Record<string, string>
): { clause: string; values: unknown[] } {
  if (filters.length === 0) {
    return { clause: "", values: [] };
  }
  const values: unknown[] = [];
  const predicates = filters.map((filter) => {
    const column = allowedColumns[filter.field];
    if (!column) {
      throw new Error(`Unsupported PostgreSQL query field: ${filter.field}`);
    }
    if (filter.op === "in") {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        return "FALSE";
      }
      values.push(filter.value);
      return `${column} = ANY($${values.length}::text[])`;
    }
    values.push(filter.value);
    return `${column} ${filter.op === "==" ? "=" : "<>"} $${values.length}`;
  });
  return { clause: ` WHERE ${predicates.join(" AND ")}`, values };
}

export function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

export function toIso(value: Date | string): string {
  return toDate(value).toISOString();
}
