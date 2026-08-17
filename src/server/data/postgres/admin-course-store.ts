import type { AdminCourseConnectionRecord } from "../../../shared/models.js";
import type { PostgresDatabase } from "../postgres-client.js";
import type {
  AdminCourseConnectionListOptions,
  AdminCourseConnectionStore,
  AdminCourseConnectionSummary
} from "../repository-contracts.js";
import {
  DocumentMapping,
  DocumentRow,
  PostgresCollectionStore,
  decodeDocument,
  queryRows
} from "./collection-store.js";

const ADMIN_COURSE_CONNECTION_MAPPING: DocumentMapping<AdminCourseConnectionRecord> = {
  table: "admin_course_connections",
  extracted: [
    { field: "rootAccountId", column: "root_account_id" },
    { field: "courseId", column: "course_id" },
    { field: "name", column: "course_name" },
    { field: "courseCode", column: "course_code" }
  ]
};

export class PostgresAdminCourseConnectionStore
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
    if (!options.includePast) {
      conditions.push("COALESCE((document->>'concluded')::boolean, false) = false");
      if (options.termId) {
        values.push(options.termId);
        conditions.push(`document->>'termId' = $${values.length}`);
      }
    }
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

  async summarizeForRoot(
    rootAccountId: string,
    options: Pick<AdminCourseConnectionListOptions, "termId" | "includePast"> = {}
  ): Promise<AdminCourseConnectionSummary> {
    const values: unknown[] = [rootAccountId];
    const conditions = ["root_account_id = $1"];
    if (!options.includePast) {
      conditions.push("COALESCE((document->>'concluded')::boolean, false) = false");
      if (options.termId) {
        values.push(options.termId);
        conditions.push(`document->>'termId' = $${values.length}`);
      }
    }
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
       WHERE ${conditions.join(" AND ")}`,
      values
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
