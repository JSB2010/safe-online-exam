import type {
  AdminAccountSettingsRecord,
  AdminCourseConnectionRecord,
  AdminToolPresetRecord,
  AdminToolPresetAssignmentRecord,
  AssessmentRecord,
  CourseRecord,
  OAuthToken
} from "../../shared/models.js";

export type QueryOperator = "==" | "!=" | "in";

export interface QueryFilter {
  field: string;
  op: QueryOperator;
  value: unknown;
}

export interface QueryOptions {
  orderBy?: "id" | "createdAt" | "updatedAt";
  direction?: "asc" | "desc";
  limit?: number;
}

export interface CollectionStore<T extends Record<string, any>> {
  get(id: string): Promise<T | null>;
  save(id: string, value: T): Promise<T>;
  update(id: string, updater: (current: T | null) => T | null): Promise<T | null>;
  delete(id: string): Promise<void>;
  find(filters?: QueryFilter[], options?: QueryOptions): Promise<T[]>;
  saveMany(values: Array<{ id: string; value: T }>): Promise<T[]>;
}

export interface AdminCourseConnectionListOptions {
  search?: string;
  termId?: string;
  includePast?: boolean;
  afterName?: string;
  afterCourseId?: string;
  limit: number;
}

export interface AdminCourseConnectionSummary {
  courseCount: number;
  assessmentCount: number;
  enabledAssessmentCount: number;
  issueCount: number;
}

export interface AdminCourseConnectionStore extends CollectionStore<AdminCourseConnectionRecord> {
  listForRoot(rootAccountId: string, options: AdminCourseConnectionListOptions): Promise<AdminCourseConnectionRecord[]>;
  summarizeForRoot(
    rootAccountId: string,
    options?: Pick<AdminCourseConnectionListOptions, "termId" | "includePast">
  ): Promise<AdminCourseConnectionSummary>;
}

export interface SessionRecord extends Record<string, any> {
  id?: string | null;
  data: Record<string, unknown>;
  expiresAt: Date | string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TransientStateRecord extends Record<string, any> {
  id?: string | null;
  kind:
    | "lti-state"
    | "seb-proof"
    | "seb-proof-v2"
    | "seb-exit-grant"
    | "seb-config-grant"
    | "seb-session-handoff-config"
    | "admission-budget";
  payload?: Record<string, string>;
  courseId?: string | null;
  contentId?: string | null;
  expiresAt: Date | string;
  consumedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface OperationLockRecord extends Record<string, any> {
  id?: string | null;
  ownerId: string;
  expiresAt: Date | string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TransientStateStore extends CollectionStore<TransientStateRecord> {
  consume(id: string): Promise<TransientStateRecord | null>;
  claim(id: string, value: TransientStateRecord): Promise<boolean>;
  consumeBudget(id: string, limit: number, windowMs: number): Promise<boolean>;
}

export interface OperationLockStore extends CollectionStore<OperationLockRecord> {
  acquire(id: string, ownerId: string, ttlMs: number): Promise<boolean>;
  renew(id: string, ownerId: string, ttlMs: number): Promise<boolean>;
  release(id: string, ownerId: string): Promise<void>;
}

export interface AppRepositories {
  adminAccountSettings: CollectionStore<AdminAccountSettingsRecord>;
  adminCourseConnections: AdminCourseConnectionStore;
  adminToolPresetAssignments: CollectionStore<AdminToolPresetAssignmentRecord>;
  adminToolPresets: CollectionStore<AdminToolPresetRecord>;
  assessments: CollectionStore<AssessmentRecord>;
  courses: CollectionStore<CourseRecord>;
  oauthTokens: CollectionStore<OAuthToken>;
  sessions: CollectionStore<SessionRecord>;
  transientStates: TransientStateStore;
  operationLocks: OperationLockStore;
}
