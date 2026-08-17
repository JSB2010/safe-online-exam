export type ContentType = "CLASSIC_QUIZ" | "NEW_QUIZ" | "ASSIGNMENT" | "DISCUSSION" | "EXTERNAL_TOOL" | "PAGE";

/**
 * Every OAuth connection receives this complete capability set so a Canvas
 * user can later launch the tool in either a learner or instructor context.
 */
export const CANVAS_REQUIRED_OAUTH_SCOPES = [
  "url:GET|/api/v1/courses",
  "url:GET|/api/v1/courses/:course_id/quizzes",
  "url:GET|/api/v1/courses/:course_id/assignments",
  "url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
  "url:PUT|/api/v1/courses/:course_id/quizzes/:id",
  "url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
  "url:GET|/api/v1/login/session_token"
] as const;

/** Additional capabilities requested only by the root-account administrator flow. */
export const CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES = [
  "url:GET|/api/v1/accounts/:id",
  "url:GET|/api/v1/accounts/:account_id/permissions",
  "url:GET|/api/v1/accounts/:account_id/courses",
  "url:GET|/api/v1/accounts/:account_id/terms",
  "url:GET|/api/v1/courses/:id",
  "url:GET|/api/v1/courses/:course_id/quizzes/:id"
] as const;

/**
 * Version of the role-independent OAuth scope contract. Changes to this
 * common scope set require a fresh Canvas authorization for every user.
 */
export const CANVAS_OAUTH_SCOPE_VERSION = 3;

export interface Quiz {
  id: string;
  title: string;
  description?: string | null;
  courseId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  canvasQuizId?: string | null;
  htmlUrl?: string | null;
  quizEngine?: string | null;
  quizTypeDisplay?: string | null;
  contentType?: ContentType | null;
  published?: boolean | null;
  unlockAt?: string | null;
  lockAt?: string | null;
}

export interface ContentItem {
  id: string;
  courseId: string;
  canvasId: string;
  assignmentId?: string | null;
  contentType: ContentType;
  title: string;
  description?: string | null;
  htmlUrl?: string | null;
  apiUrl?: string | null;
  canvasLaunchUrl?: string | null;
  resourceLinkUuid?: string | null;
  lookupUuid?: string | null;
  externalToolUrl?: string | null;
  quizEngine?: string | null;
  quizTypeDisplay?: string | null;
  published?: boolean | null;
  unlockAt?: string | null;
  lockAt?: string | null;
}

export interface OAuthToken {
  id?: string | null;
  userId: string;
  grantType?: CanvasOAuthGrantType | null;
  accessToken: string;
  refreshToken?: string | null;
  scope?: string | null;
  /** Scopes this application requested; Canvas may omit scope from its response. */
  requestedScopes?: string[] | null;
  /** App-owned required-scope contract for reconnect decisions. */
  oauthScopeVersion?: number | null;
  expiresAt?: string | null;
  /** Latest display name from the verified Canvas OAuth/LTI identity. */
  displayName?: string | null;
  /** Latest email address from the verified Canvas LTI identity, when provided. */
  email?: string | null;
  /** When the stored display name or email last changed. */
  identityUpdatedAt?: string | null;
  /**
   * UI-only preference. This never represents device trust or readiness; it
   * only prevents the optional student setup-check prompt from reappearing.
   */
  studentReadinessPromptDismissedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type CanvasOAuthGrantType = "instructor" | "student_session" | "account_admin";

export interface LtiLaunchData {
  /** The opaque LTI subject from the validated id_token. */
  ltiSubject?: string | null;
  /** The signed Canvas REST user id from custom.canvas_user_id. */
  canvasUserId?: string | null;
  issuer?: string | null;
  userId: string;
  fullName?: string | null;
  email?: string | null;
  courseId?: string | null;
  courseName?: string | null;
  roles: string[];
  deploymentId?: string | null;
  targetLinkUri?: string | null;
  messageType?: string | null;
  ltiVersion?: string | null;
  resourceLinkId?: string | null;
  resourceLinkTitle?: string | null;
  resourceLinkDescription?: string | null;
  custom?: Record<string, string>;
  platform?: Record<string, unknown>;
  ags?: Record<string, unknown>;
}
