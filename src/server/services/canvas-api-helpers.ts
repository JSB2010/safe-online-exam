import type { CanvasOAuthGrantType, OAuthToken } from "../../shared/models.js";
import {
  CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES,
  CANVAS_OAUTH_SCOPE_VERSION,
  CANVAS_REQUIRED_OAUTH_SCOPES
} from "../../shared/models.js";
import type {
  CanvasAccountResponse,
  CanvasAccountSummary,
  CanvasAdminCourse,
  CanvasAdminCourseResponse,
  CanvasAssignmentResponse,
  CanvasOAuthTokenResponse,
  StoreAccessTokenOptions
} from "./canvas-api-types.js";

const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export function normalizeStoreAccessTokenOptions(
  scopeOrOptions?: string | StoreAccessTokenOptions | null
): StoreAccessTokenOptions {
  if (!scopeOrOptions) {
    return {};
  }
  if (typeof scopeOrOptions === "string") {
    return { scope: scopeOrOptions };
  }
  return scopeOrOptions;
}

export function oauthTokenId(userId: string, grantType: CanvasOAuthGrantType): string {
  void grantType;
  return userId;
}

export function canvasAdminCourse(course: CanvasAdminCourseResponse): CanvasAdminCourse {
  const id = String(course.id || "");
  const accountId = String(course.account_id || "");
  if (!/^\d+$/u.test(id) || !/^\d+$/u.test(accountId)) {
    throw new Error("Canvas returned an invalid administrative course record");
  }
  const rootAccountId = course.root_account_id === undefined ? null : String(course.root_account_id);
  return {
    id,
    name: course.name || "Unnamed course",
    courseCode: course.course_code || null,
    accountId,
    rootAccountId: rootAccountId && /^\d+$/u.test(rootAccountId) ? rootAccountId : null,
    workflowState: course.workflow_state || null,
    concluded: course.concluded === true,
    termId: String(course.term?.id || course.enrollment_term_id || "") || null,
    termName: course.term?.name || null,
    teacherNames: (course.teachers || []).map((teacher) => teacher.display_name || teacher.name || "").filter(Boolean)
  };
}

export function normalizedCanvasCourseName(value: string | undefined, courseId: string): string {
  const normalized = value?.trim().replace(/\s+/gu, " ");
  return normalized || `Course ${courseId}`;
}

export function normalizedCanvasCourseCode(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/gu, " ");
  return normalized || null;
}

export function canvasAccountSummary(account: CanvasAccountResponse): CanvasAccountSummary {
  const id = String(account.id || "");
  const parentAccountId = account.parent_account_id === null ? null : String(account.parent_account_id || "");
  const rootAccountId = account.root_account_id === null ? id : String(account.root_account_id || id);
  if (!/^\d+$/u.test(id) || !/^\d+$/u.test(rootAccountId)) {
    throw new Error("Canvas returned an invalid administrative account record");
  }
  return {
    id,
    name: account.name || "Canvas account",
    parentAccountId: parentAccountId && /^\d+$/u.test(parentAccountId) ? parentAccountId : null,
    rootAccountId
  };
}

export function expiresAtFromSeconds(expiresIn?: number | null): string | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

export function shouldRefreshToken(token: OAuthToken): boolean {
  if (!token.refreshToken || !token.expiresAt) {
    return false;
  }
  const expiresAt = Date.parse(token.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - TOKEN_REFRESH_SKEW_MS <= Date.now();
}

export function hasCurrentRequiredScopes(
  token: OAuthToken | null | undefined,
  grantType: CanvasOAuthGrantType
): boolean {
  if (token?.oauthScopeVersion !== CANVAS_OAUTH_SCOPE_VERSION || !token.requestedScopes) {
    return false;
  }
  const requiredScopes =
    grantType === "account_admin"
      ? [...CANVAS_REQUIRED_OAUTH_SCOPES, ...CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES]
      : CANVAS_REQUIRED_OAUTH_SCOPES;
  return requiredScopes.every((scope) => token.requestedScopes!.includes(scope));
}

export function hasRequiredAdminScopes(scopes: readonly string[] | null | undefined): boolean {
  return !!scopes && CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES.every((scope) => scopes.includes(scope));
}

export function normalizedIdentityValue(value: string | null | undefined, maximumLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= maximumLength ? normalized : undefined;
}

export function isSafeReadMethod(method?: string): boolean {
  const normalized = (method || "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

export function withCanvasPage(firstPageUrl: string, page: number): string {
  const url = new URL(firstPageUrl);
  url.searchParams.set("page", String(page));
  return url.toString();
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isCanvasOAuthTokenResponse(value: unknown): value is CanvasOAuthTokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const token = value as Record<string, unknown>;
  return (
    typeof token.access_token === "string" &&
    token.access_token.length > 0 &&
    (token.refresh_token === undefined || typeof token.refresh_token === "string") &&
    (token.scope === undefined || typeof token.scope === "string") &&
    (token.expires_in === undefined || (typeof token.expires_in === "number" && Number.isFinite(token.expires_in)))
  );
}

export function isNewQuizAssignment(assignment: CanvasAssignmentResponse): boolean {
  if (assignment.quiz_lti || assignment.is_quiz_assignment) {
    return true;
  }
  const url = assignment.external_tool_tag_attributes?.url || "";
  return url.includes("new_quizzes") || url.includes("quiz-lti") || url.includes("external_tools");
}
