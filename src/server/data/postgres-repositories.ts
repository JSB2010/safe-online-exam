import type {
  AdminCourseConnectionRecord,
  AdminToolPresetRecord,
  AdminToolPresetAssignmentRecord,
  AssessmentRecord,
  CourseRecord,
  OAuthToken
} from "../../shared/models.js";
import { prepareDocument, stripUndefinedValues } from "./document-values.js";
import type { PostgresClientLike, PostgresDatabase } from "./postgres-client.js";
import type {
  AppRepositories,
  AdminCourseConnectionListOptions,
  AdminCourseConnectionStore,
  AdminCourseConnectionSummary,
  CollectionStore,
  OperationLockRecord,
  OperationLockStore,
  QueryFilter,
  QueryOptions,
  SessionRecord,
  TransientStateRecord,
  TransientStateStore
} from "./repository-contracts.js";

interface DocumentMapping<T> {
  table: string;
  extracted: Array<{ field: keyof T & string; column: string }>;
}

interface DocumentRow {
  id: string;
  document: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

type SqlExecutor = Pick<PostgresDatabase, "query"> | PostgresClientLike;

const ASSESSMENT_MAPPING: DocumentMapping<AssessmentRecord> = {
  table: "assessments",
  extracted: [{ field: "courseId", column: "course_id" }]
};
const COURSE_MAPPING: DocumentMapping<CourseRecord> = {
  table: "courses",
  extracted: [{ field: "courseId", column: "course_id" }]
};
const OAUTH_MAPPING: DocumentMapping<OAuthToken> = {
  table: "canvas_oauth_tokens",
  extracted: [{ field: "userId", column: "user_id" }]
};
const ADMIN_COURSE_CONNECTION_MAPPING: DocumentMapping<AdminCourseConnectionRecord> = {
  table: "admin_course_connections",
  extracted: [
    { field: "rootAccountId", column: "root_account_id" },
    { field: "courseId", column: "course_id" },
    { field: "name", column: "course_name" },
    { field: "courseCode", column: "course_code" }
  ]
};
const ADMIN_TOOL_PRESET_MAPPING: DocumentMapping<AdminToolPresetRecord> = {
  table: "admin_tool_presets",
  extracted: [{ field: "rootAccountId", column: "root_account_id" }]
};
const ADMIN_TOOL_PRESET_ASSIGNMENT_MAPPING: DocumentMapping<AdminToolPresetAssignmentRecord> = {
  table: "admin_tool_preset_assignments",
  extracted: [
    { field: "rootAccountId", column: "root_account_id" },
    { field: "presetId", column: "preset_id" },
    { field: "courseId", column: "course_id" },
    { field: "status", column: "status" }
  ]
};

export function createPostgresRepositories(database: PostgresDatabase): AppRepositories {
  return {
    adminCourseConnections: new PostgresAdminCourseConnectionStore(database),
    adminToolPresetAssignments: new PostgresCollectionStore(database, ADMIN_TOOL_PRESET_ASSIGNMENT_MAPPING),
    adminToolPresets: new PostgresCollectionStore(database, ADMIN_TOOL_PRESET_MAPPING),
    assessments: new PostgresCollectionStore(database, ASSESSMENT_MAPPING),
    courses: new PostgresCollectionStore(database, COURSE_MAPPING),
    oauthTokens: new PostgresCollectionStore(database, OAUTH_MAPPING),
    sessions: new PostgresSessionStore(database),
    transientStates: new PostgresTransientStateStore(database),
    operationLocks: new PostgresOperationLockStore(database)
  };
}

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

class PostgresAdminCourseConnectionStore
  extends PostgresCollectionStore<AdminCourseConnectionRecord>
  implements AdminCourseConnectionStore
{
  constructor(database: PostgresDatabase) {
    super(database, ADMIN_COURSE_CONNECTION_MAPPING);
  }

  async listForRoot(
    rootAccountId: string,
    options: AdminCourseConnectionListOptions
  ): Promise<AdminCourseConnectionRecord[]> {
    const values: unknown[] = [rootAccountId];
    const conditions = ["root_account_id = $1"];
    const search = options.search?.trim();
    if (search) {
      values.push(`%${search.replace(/[\\\\%_]/gu, "\\$&")}%`);
      conditions.push(
        `(course_name ILIKE $${values.length} ESCAPE '\\' OR COALESCE(course_code, '') ILIKE $${values.length} ESCAPE '\\' OR course_id ILIKE $${values.length} ESCAPE '\\' OR document->>'termName' ILIKE $${values.length} ESCAPE '\\' OR document->>'teacherNames' ILIKE $${values.length} ESCAPE '\\')`
      );
    }
    if (options.afterName) {
      values.push(options.afterName, options.afterCourseId || "");
      conditions.push(
        `(lower(course_name), course_id) > (lower($${values.length - 1}::text), $${values.length}::text)`
      );
    }
    values.push(Math.min(Math.max(options.limit, 1), 100));
    const rows = await queryRows<DocumentRow>(
      this.database,
      `SELECT id, document, created_at, updated_at
       FROM admin_course_connections
       WHERE ${conditions.join(" AND ")}
       ORDER BY lower(course_name), course_id
       LIMIT $${values.length}`,
      values
    );
    return rows.map((row) => decodeDocument<AdminCourseConnectionRecord>(row));
  }

  async summarizeForRoot(rootAccountId: string): Promise<AdminCourseConnectionSummary> {
    const result = await this.database.query<{
      course_count: number | string;
      assessment_count: number | string;
      enabled_assessment_count: number | string;
      issue_count: number | string;
    }>(
      `SELECT
         count(*)::int AS course_count,
         COALESCE(sum(COALESCE((document->>'assessmentCount')::int, 0)), 0)::int AS assessment_count,
         COALESCE(sum(COALESCE((document->>'enabledAssessmentCount')::int, 0)), 0)::int AS enabled_assessment_count,
         COALESCE(sum(COALESCE((document->>'issueCount')::int, 0)), 0)::int AS issue_count
       FROM admin_course_connections
       WHERE root_account_id = $1`,
      [rootAccountId]
    );
    const row = result.rows[0];
    return {
      courseCount: Number(row?.course_count || 0),
      assessmentCount: Number(row?.assessment_count || 0),
      enabledAssessmentCount: Number(row?.enabled_assessment_count || 0),
      issueCount: Number(row?.issue_count || 0)
    };
  }
}

function normalizedQueryLimit(limit: number | undefined): number | null {
  return Number.isSafeInteger(limit) && Number(limit) > 0 ? Math.min(Number(limit), 10_000) : null;
}

class PostgresSessionStore implements CollectionStore<SessionRecord> {
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

interface SessionRow {
  id: string;
  data: Record<string, unknown>;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TransientRow extends DocumentRow {
  kind: TransientStateRecord["kind"];
  course_id: string | null;
  content_id: string | null;
  budget_count: number | null;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

interface LockRow {
  id: string;
  owner_id: string;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

async function queryRows<T>(executor: SqlExecutor, text: string, values: readonly unknown[] = []): Promise<T[]> {
  const result = (await executor.query(text, values)) as { rows: T[] };
  return result.rows;
}

function decodeDocument<T extends Record<string, any>>(row: DocumentRow): T {
  return {
    ...row.document,
    id: row.id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  } as unknown as T;
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

function decodeLock(row: LockRow): OperationLockRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    expiresAt: toDate(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
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

function fieldColumns<T>(mapping: DocumentMapping<T>): Record<string, string> {
  return Object.fromEntries([["id", "id"], ...mapping.extracted.map(({ field, column }) => [field, column])]);
}

function buildWhereClause(
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

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

function toIso(value: Date | string): string {
  return toDate(value).toISOString();
}

function validTtl(ttlMs: number): boolean {
  return Number.isSafeInteger(ttlMs) && ttlMs > 0;
}
