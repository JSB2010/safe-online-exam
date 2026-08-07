import { Injectable, OnModuleInit } from "@nestjs/common";
import type { AdminCourseResetOutcome } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { createInMemoryRepositories } from "./in-memory-repositories.js";
import { PostgresDatabase } from "./postgres-client.js";
import { createPostgresRepositories } from "./postgres-repositories.js";
import type { AppRepositories } from "./repository-contracts.js";
import { assertSchemaReady } from "./schema.js";

@Injectable()
export class RepositoryProvider implements OnModuleInit {
  private repositories?: AppRepositories;

  constructor(
    private readonly config: AppConfig,
    private readonly database: PostgresDatabase
  ) {}

  onModuleInit(): void {
    this.repositories = createRepositories(this.config, this.database);
  }

  get value(): AppRepositories {
    if (!this.repositories) {
      this.repositories = createRepositories(this.config, this.database);
    }
    return this.repositories;
  }

  async resetCourseState(
    courseId: string,
    adminConnectionId: string,
    operationId: string
  ): Promise<AdminCourseResetOutcome> {
    const completedAt = new Date().toISOString();
    if (usesInMemoryRepositories(this.config)) {
      const [connection, assessments, transientStates, courses, presetAssignments] = await Promise.all([
        this.value.adminCourseConnections.get(adminConnectionId),
        this.value.assessments.find([{ field: "courseId", op: "==", value: courseId }]),
        this.value.transientStates.find([{ field: "courseId", op: "==", value: courseId }]),
        this.value.courses.find([{ field: "courseId", op: "==", value: courseId }]),
        this.value.adminToolPresetAssignments.find([{ field: "courseId", op: "==", value: courseId }])
      ]);
      if (!connection || connection.courseId !== courseId) {
        throw new Error("The retained administrator course connection is unavailable for this reset.");
      }
      const outcome: AdminCourseResetOutcome = {
        version: 1,
        operationId,
        courseId,
        completedAt,
        assessmentCount: assessments.length,
        transientStateCount: transientStates.length,
        courseRecordCount: courses.length,
        presetAssignmentCount: presetAssignments.length
      };
      await Promise.all([
        ...assessments.map((assessment) => this.value.assessments.delete(assessment.id)),
        ...transientStates.map((state) => this.value.transientStates.delete(String(state.id))),
        ...courses.map((course) => this.value.courses.delete(String(course.id || course.courseId))),
        ...presetAssignments.map((assignment) => this.value.adminToolPresetAssignments.delete(assignment.id)),
        this.value.courses.delete(courseId)
      ]);
      await this.value.adminCourseConnections.update(adminConnectionId, (connection) =>
        connection
          ? {
              ...connection,
              assessmentCount: 0,
              enabledAssessmentCount: 0,
              issueCount: 0,
              lastRefreshedAt: completedAt,
              lastResetOutcome: outcome
            }
          : null
      );
      return outcome;
    }

    return this.database.withTransaction(async (client) => {
      const result = (await client.query(
        `WITH removed_transient_states AS (
           DELETE FROM transient_states WHERE course_id = $1 RETURNING id
         ), removed_assessments AS (
           DELETE FROM assessments WHERE course_id = $1 RETURNING id
         ), removed_courses AS (
           DELETE FROM courses WHERE id = $1 OR course_id = $1 RETURNING id
         ), removed_preset_assignments AS (
           DELETE FROM admin_tool_preset_assignments WHERE course_id = $1 RETURNING id
         ), reset_counts AS (
           SELECT
             (SELECT count(*)::int FROM removed_assessments) AS assessment_count,
             (SELECT count(*)::int FROM removed_transient_states) AS transient_state_count,
             (SELECT count(*)::int FROM removed_courses) AS course_record_count,
             (SELECT count(*)::int FROM removed_preset_assignments) AS preset_assignment_count
         ), updated_connection AS (
           UPDATE admin_course_connections
           SET document = document || jsonb_build_object(
                 'assessmentCount', 0,
                 'enabledAssessmentCount', 0,
                 'issueCount', 0,
                 'lastRefreshedAt', $3::text,
                 'lastResetOutcome', jsonb_build_object(
                   'version', 1,
                   'operationId', $4::text,
                   'courseId', $1::text,
                   'completedAt', $3::text,
                   'assessmentCount', reset_counts.assessment_count,
                   'transientStateCount', reset_counts.transient_state_count,
                   'courseRecordCount', reset_counts.course_record_count,
                   'presetAssignmentCount', reset_counts.preset_assignment_count
                 )
               ),
               updated_at = $3::timestamptz
           FROM reset_counts
           WHERE id = $2
           RETURNING id
         )
         SELECT
           reset_counts.*,
           (SELECT count(*)::int FROM updated_connection) AS updated_connection_count
         FROM reset_counts`,
        [courseId, adminConnectionId, completedAt, operationId]
      )) as {
        rows?: Array<{
          assessment_count?: number | string;
          transient_state_count?: number | string;
          course_record_count?: number | string;
          preset_assignment_count?: number | string;
          updated_connection_count?: number | string;
        }>;
      };
      const row = result.rows?.[0];
      if (Number(row?.updated_connection_count || 0) !== 1) {
        throw new Error("The retained administrator course connection is unavailable for this reset.");
      }
      return {
        version: 1,
        operationId,
        courseId,
        completedAt,
        assessmentCount: Number(row?.assessment_count || 0),
        transientStateCount: Number(row?.transient_state_count || 0),
        courseRecordCount: Number(row?.course_record_count || 0),
        presetAssignmentCount: Number(row?.preset_assignment_count || 0)
      };
    });
  }

  async getCourseResetOutcome(
    adminConnectionId: string,
    operationId: string,
    courseId: string
  ): Promise<AdminCourseResetOutcome | null> {
    const connection = await this.value.adminCourseConnections.get(adminConnectionId);
    const outcome = connection?.lastResetOutcome;
    if (
      !outcome ||
      outcome.version !== 1 ||
      outcome.operationId !== operationId ||
      outcome.courseId !== courseId ||
      !isValidIsoTimestamp(outcome.completedAt) ||
      !isNonNegativeInteger(outcome.assessmentCount) ||
      !isNonNegativeInteger(outcome.transientStateCount) ||
      !isNonNegativeInteger(outcome.courseRecordCount) ||
      !isNonNegativeInteger(outcome.presetAssignmentCount)
    ) {
      return null;
    }
    return outcome;
  }

  async assertReady(): Promise<void> {
    void this.value;
    if (usesInMemoryRepositories(this.config)) {
      return;
    }
    await this.database.checkConnection();
    await assertSchemaReady(this.database);
  }
}

export function createRepositories(config: AppConfig, database: PostgresDatabase): AppRepositories {
  if (usesInMemoryRepositories(config)) {
    if (config.isHardenedRuntime()) {
      throw new Error("USE_IN_MEMORY_STORE is local/test only and cannot be enabled in a hardened runtime");
    }
    return createInMemoryRepositories();
  }
  return createPostgresRepositories(database, config.value.security.oauthTokenEncryption);
}

export function usesInMemoryRepositories(config: Pick<AppConfig, "profile">): boolean {
  return config.profile === "test" || process.env.USE_IN_MEMORY_STORE === "true";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export { createInMemoryRepositories } from "./in-memory-repositories.js";
export { isExpired, stripUndefinedValues } from "./document-values.js";
export type {
  AppRepositories,
  CollectionStore,
  OperationLockRecord,
  OperationLockStore,
  QueryFilter,
  QueryOperator,
  SessionRecord,
  TransientStateRecord,
  TransientStateStore
} from "./repository-contracts.js";
