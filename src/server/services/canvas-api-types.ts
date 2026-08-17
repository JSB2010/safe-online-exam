import type { CanvasOAuthGrantType } from "../../shared/models.js";

export interface CanvasQuizResponse {
  id: number | string;
  title?: string;
  description?: string;
  html_url?: string;
  quiz_type?: string;
  published?: boolean;
  unlock_at?: string | null;
  lock_at?: string | null;
  access_code?: string | null;
}

export interface CanvasAssignmentResponse {
  id: number | string;
  name?: string;
  description?: string;
  html_url?: string;
  url?: string;
  external_tool_tag_attributes?: {
    url?: string;
    content_id?: string | number;
  };
  is_quiz_assignment?: boolean;
  quiz_lti?: boolean;
  published?: boolean;
  unlock_at?: string | null;
  lock_at?: string | null;
}

export interface CanvasNewQuizResponse {
  title?: string;
  instructions?: string | null;
  description?: string | null;
  canvas_launch_url?: string | null;
  launch_url?: string | null;
  resource_link_uuid?: string | null;
  lookup_uuid?: string | null;
  quiz_settings?: {
    require_student_access_code?: boolean;
    student_access_code?: string | null;
  };
}

export interface CanvasAdminCourse {
  id: string;
  name: string;
  courseCode: string | null;
  accountId: string;
  rootAccountId: string | null;
  workflowState: string | null;
  concluded: boolean;
  termId: string | null;
  termName: string | null;
  teacherNames: string[];
}

/** A Canvas course in which the current OAuth user has a teacher enrollment. */
export interface CanvasInstructorCourse {
  id: string;
  name: string;
  courseCode: string | null;
}

export interface CanvasInstructorCourseResponse {
  id: number | string;
  name?: string;
  course_code?: string;
}

export interface CanvasAdminCourseResponse {
  id: number | string;
  name?: string;
  course_code?: string;
  account_id?: number | string;
  root_account_id?: number | string;
  workflow_state?: string;
  concluded?: boolean;
  enrollment_term_id?: number | string;
  term?: { id?: number | string; name?: string };
  teachers?: Array<{ display_name?: string; name?: string }>;
}

export interface CanvasEnrollmentTerm {
  id: string;
  name: string;
  startAt: string | null;
  endAt: string | null;
  workflowState: string | null;
}

export interface CanvasEnrollmentTermResponse {
  id: number | string;
  name?: string;
  start_at?: string | null;
  end_at?: string | null;
  workflow_state?: string;
}

export interface CanvasAccountSummary {
  id: string;
  name: string;
  parentAccountId: string | null;
  rootAccountId: string;
}

export interface CanvasAccountResponse {
  id: number | string;
  name?: string;
  parent_account_id?: number | string | null;
  root_account_id?: number | string | null;
}

export interface CanvasOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface StoreAccessTokenOptions {
  grantType?: CanvasOAuthGrantType;
  refreshToken?: string | null;
  scope?: string | null;
  expiresIn?: number | null;
  expiresAt?: string | null;
  requestedScopes?: string[] | null;
  oauthScopeVersion?: number | null;
  displayName?: string | null;
  email?: string | null;
}

export class CanvasApiAuthorizationError extends Error {
  readonly responseBody = "";

  constructor(
    message: string,
    readonly userId: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "CanvasApiAuthorizationError";
  }
}

export function isCanvasApiAuthorizationError(error: unknown): error is CanvasApiAuthorizationError {
  return error instanceof CanvasApiAuthorizationError;
}

export class CanvasApiPermissionError extends Error {
  readonly responseBody = "";

  constructor(
    message: string,
    readonly userId: string,
    readonly url: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CanvasApiPermissionError";
  }
}

export function isCanvasApiPermissionError(error: unknown): error is CanvasApiPermissionError {
  return error instanceof CanvasApiPermissionError;
}

export class CanvasApiRequestError extends Error {
  readonly responseBody = "";

  constructor(
    message: string,
    readonly userId: string,
    readonly url: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CanvasApiRequestError";
  }
}

export function isCanvasApiRequestError(error: unknown): error is CanvasApiRequestError {
  return error instanceof CanvasApiRequestError;
}
