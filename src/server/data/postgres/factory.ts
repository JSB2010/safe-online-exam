import type {
  AdminAccountSettingsRecord,
  AdminToolPresetRecord,
  AdminToolPresetAssignmentRecord,
  AssessmentRecord,
  CourseRecord
} from "../../../shared/models.js";
import type { PostgresDatabase } from "../postgres-client.js";
import type { AppRepositories } from "../repository-contracts.js";
import { type OAuthTokenEncryptionSettings } from "../../security/oauth-token-encryption.js";
import { PostgresAdminCourseConnectionStore } from "./admin-course-store.js";
import { DocumentMapping, PostgresCollectionStore } from "./collection-store.js";
import { PostgresOperationLockStore } from "./operation-lock-store.js";
import { PostgresOAuthTokenStore, localTestOAuthTokenEncryptionSettings } from "./oauth-token-store.js";
import { PostgresSessionStore } from "./session-store.js";
import { PostgresTransientStateStore } from "./transient-state-store.js";

const ASSESSMENT_MAPPING: DocumentMapping<AssessmentRecord> = {
  table: "assessments",
  extracted: [{ field: "courseId", column: "course_id" }]
};

const COURSE_MAPPING: DocumentMapping<CourseRecord> = {
  table: "courses",
  extracted: [{ field: "courseId", column: "course_id" }]
};

const ADMIN_ACCOUNT_SETTINGS_MAPPING: DocumentMapping<AdminAccountSettingsRecord> = {
  table: "admin_account_settings",
  extracted: [{ field: "rootAccountId", column: "root_account_id" }]
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

export function createPostgresRepositories(
  database: PostgresDatabase,
  oauthTokenEncryption: OAuthTokenEncryptionSettings = localTestOAuthTokenEncryptionSettings()
): AppRepositories {
  return {
    adminAccountSettings: new PostgresCollectionStore(database, ADMIN_ACCOUNT_SETTINGS_MAPPING),
    adminCourseConnections: new PostgresAdminCourseConnectionStore(database),
    adminToolPresetAssignments: new PostgresCollectionStore(database, ADMIN_TOOL_PRESET_ASSIGNMENT_MAPPING),
    adminToolPresets: new PostgresCollectionStore(database, ADMIN_TOOL_PRESET_MAPPING),
    assessments: new PostgresCollectionStore(database, ASSESSMENT_MAPPING),
    courses: new PostgresCollectionStore(database, COURSE_MAPPING),
    oauthTokens: new PostgresOAuthTokenStore(database, oauthTokenEncryption),
    sessions: new PostgresSessionStore(database),
    transientStates: new PostgresTransientStateStore(database),
    operationLocks: new PostgresOperationLockStore(database)
  };
}
