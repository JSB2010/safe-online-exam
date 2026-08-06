import { Injectable, OnModuleInit } from "@nestjs/common";
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
    adminConnectionId: string
  ): Promise<{
    assessmentCount: number;
    transientStateCount: number;
    courseRecordCount: number;
    presetAssignmentCount: number;
  }> {
    if (usesInMemoryRepositories(this.config)) {
      const [assessments, transientStates, courses, presetAssignments] = await Promise.all([
        this.value.assessments.find([{ field: "courseId", op: "==", value: courseId }]),
        this.value.transientStates.find([{ field: "courseId", op: "==", value: courseId }]),
        this.value.courses.find([{ field: "courseId", op: "==", value: courseId }]),
        this.value.adminToolPresetAssignments.find([{ field: "courseId", op: "==", value: courseId }])
      ]);
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
              lastRefreshedAt: new Date().toISOString()
            }
          : null
      );
      return {
        assessmentCount: assessments.length,
        transientStateCount: transientStates.length,
        courseRecordCount: courses.length,
        presetAssignmentCount: presetAssignments.length
      };
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
         ), updated_connection AS (
           UPDATE admin_course_connections
           SET document = document || jsonb_build_object(
                 'assessmentCount', 0,
                 'enabledAssessmentCount', 0,
                 'issueCount', 0,
                 'lastRefreshedAt', $3::text
               ),
               updated_at = $3::timestamptz
           WHERE id = $2
           RETURNING id
         )
         SELECT
           (SELECT count(*)::int FROM removed_assessments) AS assessment_count,
           (SELECT count(*)::int FROM removed_transient_states) AS transient_state_count,
           (SELECT count(*)::int FROM removed_courses) AS course_record_count,
           (SELECT count(*)::int FROM removed_preset_assignments) AS preset_assignment_count`,
        [courseId, adminConnectionId, new Date().toISOString()]
      )) as {
        rows?: Array<{
          assessment_count?: number | string;
          transient_state_count?: number | string;
          course_record_count?: number | string;
          preset_assignment_count?: number | string;
        }>;
      };
      const row = result.rows?.[0];
      return {
        assessmentCount: Number(row?.assessment_count || 0),
        transientStateCount: Number(row?.transient_state_count || 0),
        courseRecordCount: Number(row?.course_record_count || 0),
        presetAssignmentCount: Number(row?.preset_assignment_count || 0)
      };
    });
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
  return createPostgresRepositories(database);
}

export function usesInMemoryRepositories(config: Pick<AppConfig, "profile">): boolean {
  return config.profile === "test" || process.env.USE_IN_MEMORY_STORE === "true";
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
