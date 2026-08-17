import { ExternalToolConfig } from "./external-tools.js";

export interface AdminToolPresetRecord {
  id: string;
  rootAccountId: string;
  name: string;
  description?: string | null;
  tool: ExternalToolConfig;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AdminCourseResetOutcome {
  version: 1;
  operationId: string;
  courseId: string;
  completedAt: string;
  assessmentCount: number;
  transientStateCount: number;
  courseRecordCount: number;
  presetAssignmentCount: number;
}

export interface AdminCourseConnectionRecord {
  id: string;
  rootAccountId: string;
  canvasOrigin: string;
  courseId: string;
  name: string;
  courseCode?: string | null;
  accountId: string;
  workflowState?: string | null;
  concluded?: boolean | null;
  termId?: string | null;
  termName?: string | null;
  teacherNames: string[];
  assessmentCount: number;
  enabledAssessmentCount: number;
  issueCount: number;
  connectedByUserId: string;
  lastCanvasCheckedAt?: string | null;
  lastRefreshedAt?: string | null;
  /** Durable receipt used to resolve an ambiguous reset transaction commit. */
  lastResetOutcome?: AdminCourseResetOutcome | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AdminAccountSettingsRecord {
  id: string;
  rootAccountId: string;
  operationalTermId?: string | null;
  updatedByUserId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type AdminToolPresetAssignmentStatus = "pending" | "applied" | "failed";

export interface AdminToolPresetAssignmentRecord {
  id: string;
  rootAccountId: string;
  presetId: string;
  courseId: string;
  desiredAssigned: boolean;
  status: AdminToolPresetAssignmentStatus;
  error?: string | null;
  appliedPresetUpdatedAt?: string | null;
  updatedByUserId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}
