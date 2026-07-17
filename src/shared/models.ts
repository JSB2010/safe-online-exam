export type ContentType = "CLASSIC_QUIZ" | "NEW_QUIZ" | "ASSIGNMENT" | "DISCUSSION" | "EXTERNAL_TOOL" | "PAGE";

/**
 * Every OAuth connection receives this complete capability set so a Canvas
 * user can later launch the tool in either a learner or instructor context.
 */
export const CANVAS_REQUIRED_OAUTH_SCOPES = [
  "url:GET|/api/v1/courses/:course_id/quizzes",
  "url:GET|/api/v1/courses/:course_id/assignments",
  "url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
  "url:PUT|/api/v1/courses/:course_id/quizzes/:id",
  "url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
  "url:GET|/api/v1/login/session_token"
] as const;

/** Increment when a new required Canvas OAuth capability is introduced. */
export const CANVAS_OAUTH_SCOPE_VERSION = 2;

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

export interface AssessmentCanvasState {
  id: string;
  quizId?: string | null;
  assignmentId?: string | null;
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
  /**
   * Legacy records may contain a raw Canvas API response here. It is never
   * returned across an application boundary and is cleared on the next write.
   */
  metadata?: Record<string, unknown> | null;
}

export interface AssessmentSebState {
  required: boolean;
  enabled: boolean;
  accessCode?: string | null;
  configKey?: string | null;
  configKeySalt?: string | null;
  quitPassword?: string | null;
  startPassword?: string | null;
  usesCourseDefaults: boolean;
  quitPasswordOverride: boolean;
  startPasswordOverride: boolean;
  ssoDomains: string[];
  educationalToolDomains: string[];
  customDomains: string[];
  urlRules: SebUrlRule[];
  externalTools: ExternalToolConfig[];
  /**
   * `null` means this assessment inherits the course tool defaults. An array
   * is an explicit allowlist of course-tool ids, including an empty array when
   * the instructor wants no tools for this assessment.
   */
  externalToolIds?: string[] | null;
}

export type AssessmentCanvasVerificationStatus = "verified" | "missing" | "stale";

export interface AssessmentCanvasVerification {
  /**
   * `verified` means the assessment was present in the most recent successful,
   * complete Canvas discovery for its content type. `missing` is an
   * authoritative tombstone. `stale` means discovery was attempted but failed.
   * Legacy records without this object are intentionally unverified.
   */
  status: AssessmentCanvasVerificationStatus;
  checkedAt: string;
  lastVerifiedAt?: string | null;
}

export interface AssessmentRecord {
  id: string;
  courseId: string;
  contentType: ContentType;
  canvas: AssessmentCanvasState;
  seb: AssessmentSebState;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastSyncedAt?: string | null;
  canvasVerification?: AssessmentCanvasVerification | null;
}

export interface QuizSebSetting {
  id?: string | null;
  quizId: string;
  courseId?: string | null;
  sebRequired: boolean;
  enabled: boolean;
  accessCode?: string | null;
  configKey?: string | null;
  externalToolUrl?: string | null;
  ssoDomains: string[];
  educationalToolDomains: string[];
  customDomains: string[];
  urlRules?: SebUrlRule[] | null;
  externalTools: ExternalToolConfig[];
  externalToolIds?: string[] | null;
  canvasDomain?: string | null;
  quitPassword?: string | null;
  startPassword?: string | null;
  configKeySalt?: string | null;
  usesCourseDefaults?: boolean | null;
  quitPasswordOverride?: boolean | null;
  startPasswordOverride?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ContentSebSetting {
  id?: string | null;
  contentId: string;
  canvasId?: string | null;
  assignmentId?: string | null;
  contentType?: ContentType | null;
  courseId?: string | null;
  htmlUrl?: string | null;
  canvasLaunchUrl?: string | null;
  resourceLinkUuid?: string | null;
  lookupUuid?: string | null;
  sebRequired: boolean;
  enabled: boolean;
  accessCode?: string | null;
  configKey?: string | null;
  externalToolUrl?: string | null;
  ssoDomains: string[];
  educationalToolDomains: string[];
  customDomains: string[];
  urlRules?: SebUrlRule[] | null;
  externalTools: ExternalToolConfig[];
  externalToolIds?: string[] | null;
  quitPassword?: string | null;
  startPassword?: string | null;
  configKeySalt?: string | null;
  usesCourseDefaults?: boolean | null;
  quitPasswordOverride?: boolean | null;
  startPasswordOverride?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type SebUrlRuleMatch = "exact" | "domain" | "regex";

export interface SebUrlRule {
  id: string;
  value: string;
  match: SebUrlRuleMatch;
}

export interface CourseSebDefaults {
  id?: string | null;
  courseId: string;
  quitPassword?: string | null;
  startPassword?: string | null;
  urlRules: SebUrlRule[];
  externalTools: ExternalToolConfig[];
  /**
   * Internal persistence marker. A missing marker denotes a pre-catalog
   * course, which is seeded once; an explicit empty catalog means an
   * instructor intentionally removed every preloaded tool.
   */
  externalToolsInitialized?: boolean;
  setupCompleted: boolean;
  /** Secret-free response hint; never persisted as configuration. */
  hasEffectiveQuitPassword?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SebQuitPasswordAvailability {
  hasEffectiveQuitPassword?: boolean;
}

export function canEnableSebAssessment(
  setting?: SebQuitPasswordAvailability | null,
  defaults?: SebQuitPasswordAvailability | null
): boolean {
  return setting?.hasEffectiveQuitPassword === true || defaults?.hasEffectiveQuitPassword === true;
}

export interface CourseRecord {
  id?: string | null;
  courseId: string;
  setupCompleted: boolean;
  sebDefaults: {
    quitPassword?: string | null;
    startPassword?: string | null;
    urlRules: SebUrlRule[];
    externalTools: ExternalToolConfig[];
    externalToolsInitialized?: boolean;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface OAuthToken {
  id?: string | null;
  userId: string;
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

export interface StructuredSebConfigRequest {
  quizId?: string | null;
  contentId?: string | null;
  courseId?: string | null;
  ssoDomains?: string[] | null;
  educationalToolDomains?: string[] | null;
  customDomains?: string[] | null;
  urlRules?: SebUrlRule[] | null;
  externalTools?: ExternalToolConfig[] | null;
  externalToolIds?: string[] | null;
  externalToolUrl?: string | null;
  quitPassword?: string | null;
  startPassword?: string | null;
  usesCourseDefaults?: boolean | null;
  quitPasswordOverride?: boolean | null;
  startPasswordOverride?: boolean | null;
}

export interface ExternalToolConfig {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  preset?: string | null;
  /** Explicit, visible URL access beyond the launch page. */
  allowedRules?: ExternalToolAccessRule[] | null;
  /** @deprecated Legacy persisted representation. Normalized into allowedRules. */
  allowedDomains?: string[] | null;
  /** @deprecated Legacy persisted representation. */
  matchType?: SebUrlRuleMatch | null;
  /** @deprecated Legacy persisted representation. */
  allowedPattern?: string | null;
}

export type ExternalToolAccessMatch = "exact" | "path" | "domain";

export interface ExternalToolAccessRule {
  id: string;
  value: string;
  match: ExternalToolAccessMatch;
  /** Required when a custom rule permits an entire HTTPS domain. */
  broadDomainConfirmed?: boolean;
}

export const EXTERNAL_TOOL_PRESETS: ExternalToolConfig[] = [
  {
    id: "desmos-graphing",
    label: "Desmos Graphing Calculator",
    url: "https://www.desmos.com/calculator",
    enabled: false,
    preset: "desmos-graphing",
    allowedRules: [
      { id: "desmos-build", value: "https://www.desmos.com/assets/build/*", match: "path" },
      { id: "desmos-graphing-images", value: "https://www.desmos.com/assets/img/apps/graphing/*", match: "path" },
      { id: "desmos-pwa", value: "https://www.desmos.com/assets/pwa/*", match: "path" }
    ]
  },
  {
    id: "desmos-scientific",
    label: "Desmos Scientific Calculator",
    url: "https://www.desmos.com/scientific",
    enabled: false,
    preset: "desmos-scientific",
    allowedRules: [
      { id: "desmos-build", value: "https://www.desmos.com/assets/build/*", match: "path" },
      { id: "desmos-scientific-images", value: "https://www.desmos.com/assets/img/apps/scientific/*", match: "path" },
      { id: "desmos-pwa", value: "https://www.desmos.com/assets/pwa/*", match: "path" }
    ]
  },
  {
    id: "geogebra-graphing",
    label: "GeoGebra Graphing Calculator",
    url: "https://www.geogebra.org/graphing",
    enabled: false,
    preset: "geogebra-graphing",
    allowedRules: [
      { id: "geogebra-apps", value: "https://www.geogebra.org/apps/*", match: "path" },
      { id: "geogebra-cdn-apps", value: "https://cdn.geogebra.org/apps/*", match: "path" }
    ]
  },
  {
    id: "geogebra-scientific",
    label: "GeoGebra Scientific Calculator",
    url: "https://www.geogebra.org/scientific",
    enabled: false,
    preset: "geogebra-scientific",
    allowedRules: [
      { id: "geogebra-apps", value: "https://www.geogebra.org/apps/*", match: "path" },
      { id: "geogebra-cdn-apps", value: "https://cdn.geogebra.org/apps/*", match: "path" }
    ]
  }
];

export function classicQuizContentId(quizId: string): string {
  return `classicquiz_${quizId}`;
}

export function newQuizContentId(courseId: string, assignmentId: string): string {
  return `newquiz:${courseId}:${assignmentId}`;
}

export function parseNewQuizContentId(
  contentId: string | undefined | null
): { courseId: string; assignmentId: string } | null {
  if (!contentId?.startsWith("newquiz:")) {
    return null;
  }
  const parts = contentId.split(":");
  if (
    parts.length !== 3 ||
    !parts[1] ||
    !parts[2] ||
    !/^[a-z0-9_-]{1,128}$/iu.test(parts[1]) ||
    !/^[a-z0-9_-]{1,128}$/iu.test(parts[2])
  ) {
    return null;
  }
  return { courseId: parts[1], assignmentId: parts[2] };
}

export function extractClassicQuizId(contentId: string | undefined | null): string | null {
  if (!contentId) {
    return null;
  }
  if (contentId.startsWith("classicquiz_")) {
    return contentId.slice("classicquiz_".length);
  }
  if (!contentId.includes("_") && !contentId.startsWith("newquiz:")) {
    return contentId;
  }
  return null;
}

export function assessmentIdForClassicQuiz(quizId: string): string {
  return classicQuizContentId(extractClassicQuizId(quizId) || quizId);
}

export function canonicalAssessmentId(id: string): string {
  if (parseNewQuizContentId(id)) {
    return id;
  }
  const classicId = extractClassicQuizId(id);
  return classicId ? classicQuizContentId(classicId) : id;
}

export function defaultAssessmentSebState(): AssessmentSebState {
  return {
    required: false,
    enabled: false,
    usesCourseDefaults: true,
    quitPasswordOverride: false,
    startPasswordOverride: false,
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    urlRules: [],
    externalTools: [],
    externalToolIds: null
  };
}

export function quizToContentItem(quiz: Quiz): ContentItem {
  const canvasId = quiz.canvasQuizId || quiz.id;
  return {
    id: classicQuizContentId(canvasId),
    courseId: quiz.courseId || "",
    canvasId,
    contentType: "CLASSIC_QUIZ",
    title: quiz.title,
    description: quiz.description,
    htmlUrl: quiz.htmlUrl,
    quizEngine: quiz.quizEngine || "classic",
    quizTypeDisplay: quiz.quizTypeDisplay || "Classic Quiz",
    published: quiz.published ?? null,
    unlockAt: quiz.unlockAt || null,
    lockAt: quiz.lockAt || null
  };
}

export function quizToAssessmentRecord(
  quiz: Quiz,
  existing?: AssessmentRecord | null,
  syncedAt?: string
): AssessmentRecord {
  const canvasId = quiz.canvasQuizId || quiz.id;
  return {
    ...existing,
    id: classicQuizContentId(canvasId),
    courseId: quiz.courseId || existing?.courseId || "",
    contentType: "CLASSIC_QUIZ",
    canvas: {
      ...(existing?.canvas || {}),
      id: canvasId,
      quizId: canvasId,
      assignmentId: null,
      title: quiz.title,
      description: quiz.description,
      htmlUrl: quiz.htmlUrl,
      quizEngine: quiz.quizEngine || "classic",
      quizTypeDisplay: quiz.quizTypeDisplay || "Classic Quiz",
      published: quiz.published ?? null,
      unlockAt: quiz.unlockAt || null,
      lockAt: quiz.lockAt || null
    },
    seb: normalizeAssessmentSebState(existing?.seb),
    lastSyncedAt: syncedAt || existing?.lastSyncedAt || null,
    canvasVerification: syncedAt
      ? { status: "verified", checkedAt: syncedAt, lastVerifiedAt: syncedAt }
      : existing?.canvasVerification || null,
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt
  };
}

export function contentItemToAssessmentRecord(
  item: ContentItem,
  existing?: AssessmentRecord | null,
  syncedAt?: string
): AssessmentRecord {
  const parsedNewQuiz = parseNewQuizContentId(item.id);
  const quizId = item.contentType === "CLASSIC_QUIZ" ? extractClassicQuizId(item.id) || item.canvasId : null;
  return {
    ...existing,
    id: item.id,
    courseId: item.courseId || existing?.courseId || parsedNewQuiz?.courseId || "",
    contentType: item.contentType,
    canvas: {
      ...(existing?.canvas || {}),
      id: item.canvasId,
      quizId,
      assignmentId: item.assignmentId || parsedNewQuiz?.assignmentId || null,
      title: item.title,
      description: item.description,
      htmlUrl: item.htmlUrl,
      apiUrl: item.apiUrl,
      canvasLaunchUrl: item.canvasLaunchUrl,
      resourceLinkUuid: item.resourceLinkUuid,
      lookupUuid: item.lookupUuid,
      externalToolUrl: item.externalToolUrl,
      quizEngine: item.quizEngine,
      quizTypeDisplay: item.quizTypeDisplay,
      published: item.published ?? null,
      unlockAt: item.unlockAt || null,
      lockAt: item.lockAt || null,
      metadata: null
    },
    seb: normalizeAssessmentSebState(existing?.seb),
    lastSyncedAt: syncedAt || existing?.lastSyncedAt || null,
    canvasVerification: syncedAt
      ? { status: "verified", checkedAt: syncedAt, lastVerifiedAt: syncedAt }
      : existing?.canvasVerification || null,
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt
  };
}

export function assessmentToQuiz(record: AssessmentRecord): Quiz | null {
  if (record.contentType !== "CLASSIC_QUIZ") {
    return null;
  }
  const quizId = record.canvas.quizId || extractClassicQuizId(record.id) || record.canvas.id;
  return {
    id: quizId,
    canvasQuizId: record.canvas.quizId || record.canvas.id,
    courseId: record.courseId,
    title: record.canvas.title || "Canvas Quiz",
    description: record.canvas.description,
    htmlUrl: record.canvas.htmlUrl,
    quizEngine: record.canvas.quizEngine || "classic",
    quizTypeDisplay: record.canvas.quizTypeDisplay || "Classic Quiz",
    contentType: "CLASSIC_QUIZ",
    published: record.canvas.published ?? null,
    unlockAt: record.canvas.unlockAt || null,
    lockAt: record.canvas.lockAt || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function assessmentToContentItem(record: AssessmentRecord): ContentItem {
  return {
    id: record.id,
    courseId: record.courseId,
    canvasId: record.canvas.id,
    assignmentId: record.canvas.assignmentId,
    contentType: record.contentType,
    title: record.canvas.title || "Canvas content",
    description: record.canvas.description,
    htmlUrl: record.canvas.htmlUrl,
    apiUrl: record.canvas.apiUrl,
    canvasLaunchUrl: record.canvas.canvasLaunchUrl,
    resourceLinkUuid: record.canvas.resourceLinkUuid,
    lookupUuid: record.canvas.lookupUuid,
    externalToolUrl: record.canvas.externalToolUrl,
    quizEngine: record.canvas.quizEngine,
    quizTypeDisplay:
      record.canvas.quizTypeDisplay ||
      (record.contentType === "CLASSIC_QUIZ" ? "Classic Quiz" : record.contentType === "NEW_QUIZ" ? "New Quiz" : null),
    published: record.canvas.published ?? null,
    unlockAt: record.canvas.unlockAt || null,
    lockAt: record.canvas.lockAt || null
  };
}

export function assessmentToQuizSebSetting(record: AssessmentRecord): QuizSebSetting | null {
  const quizId = record.canvas.quizId || extractClassicQuizId(record.id);
  if (!quizId) {
    return null;
  }
  const seb = normalizeAssessmentSebState(record.seb);
  return {
    id: quizId,
    quizId,
    courseId: record.courseId || null,
    sebRequired: seb.required,
    enabled: seb.enabled,
    accessCode: seb.accessCode || null,
    configKey: seb.configKey || null,
    externalToolUrl: record.canvas.externalToolUrl || null,
    ssoDomains: seb.ssoDomains,
    educationalToolDomains: seb.educationalToolDomains,
    customDomains: seb.customDomains,
    urlRules: seb.urlRules,
    externalTools: seb.externalTools,
    externalToolIds: seb.externalToolIds,
    canvasDomain: null,
    quitPassword: seb.quitPassword || null,
    startPassword: seb.startPassword || null,
    configKeySalt: seb.configKeySalt || null,
    usesCourseDefaults: seb.usesCourseDefaults,
    quitPasswordOverride: seb.quitPasswordOverride,
    startPasswordOverride: seb.startPasswordOverride,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function assessmentToContentSebSetting(record: AssessmentRecord): ContentSebSetting {
  const seb = normalizeAssessmentSebState(record.seb);
  return {
    id: record.id,
    contentId: record.id,
    canvasId: record.canvas.id,
    assignmentId: record.canvas.assignmentId || null,
    contentType: record.contentType,
    courseId: record.courseId || null,
    htmlUrl: record.canvas.htmlUrl || null,
    canvasLaunchUrl: record.canvas.canvasLaunchUrl || null,
    resourceLinkUuid: record.canvas.resourceLinkUuid || null,
    lookupUuid: record.canvas.lookupUuid || null,
    sebRequired: seb.required,
    enabled: seb.enabled,
    accessCode: seb.accessCode || null,
    configKey: seb.configKey || null,
    externalToolUrl: record.canvas.externalToolUrl || null,
    ssoDomains: seb.ssoDomains,
    educationalToolDomains: seb.educationalToolDomains,
    customDomains: seb.customDomains,
    urlRules: seb.urlRules,
    externalTools: seb.externalTools,
    externalToolIds: seb.externalToolIds,
    quitPassword: seb.quitPassword || null,
    startPassword: seb.startPassword || null,
    configKeySalt: seb.configKeySalt || null,
    usesCourseDefaults: seb.usesCourseDefaults,
    quitPasswordOverride: seb.quitPasswordOverride,
    startPasswordOverride: seb.startPasswordOverride,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function assessmentWithQuizSebSetting(
  existing: AssessmentRecord | null | undefined,
  setting: QuizSebSetting
): AssessmentRecord {
  const quizId = extractClassicQuizId(setting.quizId) || setting.quizId;
  return {
    ...existing,
    id: classicQuizContentId(quizId),
    courseId: setting.courseId || existing?.courseId || "",
    contentType: "CLASSIC_QUIZ",
    canvas: {
      ...(existing?.canvas || {}),
      id: existing?.canvas.id || quizId,
      quizId,
      assignmentId: null,
      title: existing?.canvas.title || "Canvas Quiz",
      externalToolUrl: setting.externalToolUrl || existing?.canvas.externalToolUrl || null,
      quizEngine: existing?.canvas.quizEngine || "classic",
      quizTypeDisplay: existing?.canvas.quizTypeDisplay || "Classic Quiz"
    },
    seb: quizSebSettingToAssessmentSebState(setting),
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt,
    lastSyncedAt: existing?.lastSyncedAt || null
  };
}

export function assessmentWithContentSebSetting(
  existing: AssessmentRecord | null | undefined,
  setting: ContentSebSetting
): AssessmentRecord {
  const parsed = parseNewQuizContentId(setting.contentId);
  const assignmentId = setting.assignmentId || parsed?.assignmentId || setting.canvasId || null;
  return {
    ...existing,
    id: setting.contentId,
    courseId: setting.courseId || existing?.courseId || parsed?.courseId || "",
    contentType: setting.contentType || existing?.contentType || (parsed ? "NEW_QUIZ" : "ASSIGNMENT"),
    canvas: {
      ...(existing?.canvas || {}),
      id: setting.canvasId || existing?.canvas.id || assignmentId || setting.contentId,
      quizId: null,
      assignmentId,
      title: existing?.canvas.title || (parsed ? "New Quiz" : "Canvas content"),
      description: existing?.canvas.description,
      htmlUrl: setting.htmlUrl || existing?.canvas.htmlUrl || null,
      canvasLaunchUrl: setting.canvasLaunchUrl || existing?.canvas.canvasLaunchUrl || null,
      resourceLinkUuid: setting.resourceLinkUuid || existing?.canvas.resourceLinkUuid || null,
      lookupUuid: setting.lookupUuid || existing?.canvas.lookupUuid || null,
      externalToolUrl: setting.externalToolUrl || existing?.canvas.externalToolUrl || null,
      quizEngine: existing?.canvas.quizEngine || (parsed ? "new_quiz" : null),
      quizTypeDisplay: existing?.canvas.quizTypeDisplay || (parsed ? "New Quiz" : null),
      metadata: null
    },
    seb: contentSebSettingToAssessmentSebState(setting),
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt,
    lastSyncedAt: existing?.lastSyncedAt || null
  };
}

export function defaultQuizSebSetting(quizId: string, courseId?: string | null): QuizSebSetting {
  return {
    id: quizId,
    quizId,
    courseId,
    sebRequired: false,
    enabled: false,
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    urlRules: [],
    externalTools: [],
    externalToolIds: null
  };
}

export function defaultContentSebSetting(contentId: string, courseId?: string | null): ContentSebSetting {
  const parsed = parseNewQuizContentId(contentId);
  return {
    id: contentId,
    contentId,
    courseId: courseId || parsed?.courseId || null,
    canvasId: parsed?.assignmentId || null,
    assignmentId: parsed?.assignmentId || null,
    contentType: parsed ? "NEW_QUIZ" : null,
    sebRequired: false,
    enabled: false,
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    urlRules: [],
    externalTools: [],
    externalToolIds: null
  };
}

export function defaultCourseSebDefaults(courseId: string): CourseSebDefaults {
  return {
    id: courseId,
    courseId,
    quitPassword: null,
    startPassword: null,
    urlRules: [],
    externalTools: seedCourseExternalTools(),
    externalToolsInitialized: true,
    setupCompleted: false
  };
}

export function courseRecordToDefaults(record: CourseRecord | null | undefined, courseId: string): CourseSebDefaults {
  return normalizeCourseSebDefaults({
    id: record?.id || courseId,
    courseId: record?.courseId || courseId,
    setupCompleted: !!record?.setupCompleted,
    quitPassword: record?.sebDefaults?.quitPassword || null,
    startPassword: record?.sebDefaults?.startPassword || null,
    urlRules: record?.sebDefaults?.urlRules || [],
    externalTools: record?.sebDefaults?.externalTools,
    externalToolsInitialized: record?.sebDefaults?.externalToolsInitialized === true,
    createdAt: record?.createdAt,
    updatedAt: record?.updatedAt
  });
}

export function courseDefaultsToRecord(
  courseId: string,
  defaults: Partial<CourseSebDefaults>,
  existing?: CourseRecord | null
): CourseRecord {
  const normalized = normalizeCourseSebDefaults({
    ...defaultCourseSebDefaults(courseId),
    ...defaults,
    id: courseId,
    courseId
  });
  return {
    ...existing,
    id: courseId,
    courseId,
    setupCompleted: normalized.setupCompleted,
    sebDefaults: {
      quitPassword: normalized.quitPassword,
      startPassword: normalized.startPassword,
      urlRules: normalized.urlRules,
      externalTools: normalized.externalTools,
      externalToolsInitialized: true
    },
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt
  };
}

export function normalizeCourseSebDefaults(input: Partial<CourseSebDefaults> | null | undefined): CourseSebDefaults {
  const courseId = input?.courseId?.trim() || input?.id?.trim() || "";
  return {
    ...defaultCourseSebDefaults(courseId),
    ...input,
    id: input?.id || courseId,
    courseId,
    quitPassword: normalizeOptionalText(input?.quitPassword),
    startPassword: normalizeOptionalText(input?.startPassword),
    urlRules: normalizeUrlRules(input?.urlRules),
    externalTools:
      input?.externalToolsInitialized === true
        ? normalizeCourseExternalTools(input?.externalTools)
        : seedCourseExternalTools(input?.externalTools),
    externalToolsInitialized: input?.externalToolsInitialized === true,
    setupCompleted: !!input?.setupCompleted
  };
}

export function normalizeExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.slice(0, 16).flatMap((tool, index) => {
    const requestedId = sanitizeToolId(tool.id || tool.preset || `tool-${index + 1}`);
    // The retired ACT/testing preset is the only server-side conversion we
    // retain. Current preloaded tools are normal course records: instructors
    // may rename, retarget, edit their resources, or delete them.
    if (requestedId === "desmos-calculator" || tool.preset === "desmos-calculator") {
      const replacement = findExternalToolPreset("desmos-graphing");
      if (!replacement || seen.has(replacement.id)) {
        return [];
      }
      seen.add(replacement.id);
      return [cloneExternalTool({ ...replacement, enabled: !!tool.enabled })];
    }
    if (tool.matchType === "regex" || typeof tool.allowedPattern === "string") {
      return [];
    }
    const label = tool.label?.trim();
    const url = normalizeToolUrl(tool.url);
    if (!label || !url) {
      return [];
    }
    const id = sanitizeToolId(tool.id || label || `tool-${index + 1}`);
    const uniqueId = seen.has(id) ? `${id}-${index + 1}` : id;
    const allowedRules = normalizeExternalToolAccessRules(
      Array.isArray(tool.allowedRules) && tool.allowedRules.length
        ? tool.allowedRules
        : legacyToolAccessRules(tool, url)
    );
    seen.add(uniqueId);
    return [
      {
        id: uniqueId,
        label,
        url,
        enabled: !!tool.enabled,
        preset: findExternalToolPreset(requestedId, tool.preset)?.preset || null,
        allowedRules,
        allowedDomains: toolAllowlistEntries(allowedRules)
      }
    ];
  });
}

/** Normalizes a stored course catalog without restoring deleted entries. */
export function normalizeCourseExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  const normalized = normalizeExternalTools(input);
  return normalized.slice(0, 16);
}

/** Supplies the four templates only while initializing a legacy/new course. */
export function seedCourseExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  const normalized = normalizeExternalTools(input);
  const byPreset = new Map(
    normalized
      .map((tool) => [tool.preset || tool.id, tool] as const)
      .filter(([key]) => EXTERNAL_TOOL_PRESETS.some((preset) => preset.id === key || preset.preset === key))
  );
  const seeded = EXTERNAL_TOOL_PRESETS.map(
    (preset) => byPreset.get(preset.preset || preset.id) || cloneExternalTool(preset)
  );
  const presetIds = new Set(seeded.map((tool) => tool.id));
  return [...seeded, ...normalized.filter((tool) => !presetIds.has(tool.id))].slice(0, 16);
}

export function normalizeExternalToolIds(input?: string[] | null): string[] | null | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === null) {
    return null;
  }
  if (!Array.isArray(input)) {
    return null;
  }
  return uniqueStrings(
    input
      .slice(0, 16)
      .map((id) => sanitizeToolId(id))
      .filter(Boolean)
  );
}

export function resolveExternalToolsForAssessment(
  courseTools?: ExternalToolConfig[] | null,
  externalToolIds?: string[] | null,
  legacyTools?: ExternalToolConfig[] | null,
  usesCourseDefaults = true
): ExternalToolConfig[] {
  const catalog = normalizeCourseExternalTools(courseTools);
  if (externalToolIds === undefined) {
    return usesCourseDefaults ? catalog : normalizeExternalTools(legacyTools);
  }
  if (externalToolIds === null) {
    return catalog;
  }
  const selected = new Set(normalizeExternalToolIds(externalToolIds) || []);
  return catalog.map((tool) => ({ ...tool, enabled: selected.has(tool.id) }));
}

export function enabledExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  return normalizeExternalTools(input).filter((tool) => tool.enabled);
}

export function allowlistEntriesForExternalTools(input?: ExternalToolConfig[] | null): string[] {
  const entries = new Set<string>();
  for (const tool of enabledExternalTools(input)) {
    entries.add(`exact:${tool.url}`);
    for (const entry of toolAllowlistEntries(tool.allowedRules || [])) {
      entries.add(entry);
    }
  }
  return Array.from(entries);
}

export function normalizeUrlRules(input?: SebUrlRule[] | string[] | null): SebUrlRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.slice(0, 32).flatMap((entry, index) => {
    const candidate = normalizeUrlRule(entry, index);
    if (!candidate) {
      return [];
    }
    const dedupeKey = `${candidate.match}:${candidate.value.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return [];
    }
    seen.add(dedupeKey);
    return [candidate];
  });
}

export function isUnsafeBroadUrlPattern(value?: string | null): boolean {
  const stripped = stripRulePrefix(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "");
  if (!stripped) {
    return true;
  }
  const normalizedRegexDots = stripped.replace(/\\\./gu, ".");
  const withoutAnchors = normalizedRegexDots.replace(/^\^/u, "").replace(/\$$/u, "");
  return (
    [
      "*",
      "*/*",
      ".*",
      "https://*/*",
      "http://*/*",
      "https?://.*",
      "https://.*",
      "http://.*",
      "*.com",
      "*.org",
      "*.net",
      "*.edu",
      "*.amazonaws.com",
      "*.s3.amazonaws.com"
    ].includes(withoutAnchors) ||
    /^(?:https?:\/\/)?\*\.[a-z]{2,}(?:\/\*)?$/u.test(withoutAnchors) ||
    /^https\?:\/\/\.\*$/u.test(withoutAnchors) ||
    /^https?:\/\/\.\*$/u.test(withoutAnchors)
  );
}

export function legacyDomainsToUrlRules(input?: string[] | null): SebUrlRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const rules: SebUrlRule[] = input
    .filter((entry) => !entry.trim().startsWith("regex:"))
    .map((entry, index) => ({
      id: `domain-${index + 1}`,
      value: stripRulePrefix(entry),
      match: entry.trim().startsWith("exact:") ? "exact" : "domain"
    }));
  return normalizeUrlRules(rules);
}

export function urlRulesToAllowedEntries(input?: SebUrlRule[] | null): string[] {
  return normalizeUrlRules(input)
    .map((rule) => {
      switch (rule.match) {
        case "exact":
          return `exact:${normalizeRuleUrl(rule.value) || rule.value}`;
        case "regex":
          return "";
        case "domain":
        default:
          return `domain:${normalizeDomainRule(rule.value) || rule.value}`;
      }
    })
    .filter(Boolean);
}

export function settingUsesCourseDefaults(
  setting?: {
    usesCourseDefaults?: boolean | null;
    customDomains?: string[] | null;
    urlRules?: SebUrlRule[] | null;
    externalTools?: ExternalToolConfig[] | null;
  } | null
): boolean {
  if (!setting) {
    return true;
  }
  if (typeof setting.usesCourseDefaults === "boolean") {
    return setting.usesCourseDefaults;
  }
  return (
    normalizeUrlRules(setting.urlRules).length === 0 &&
    (setting.customDomains || []).filter(Boolean).length === 0 &&
    normalizeExternalTools(setting.externalTools).length === 0
  );
}

export function applyCourseDefaultsToQuizSetting(
  setting: QuizSebSetting,
  defaults?: CourseSebDefaults | null
): QuizSebSetting {
  const normalizedDefaults = defaults ? normalizeCourseSebDefaults(defaults) : null;
  const usesDefaults = settingUsesCourseDefaults(setting);
  const quitPasswordOverride = setting.quitPasswordOverride === true;
  const startPasswordOverride = setting.startPasswordOverride === true;
  const urlRules = usesDefaults ? normalizedDefaults?.urlRules || [] : normalizeUrlRules(setting.urlRules);
  const externalToolIds = normalizeExternalToolIds(setting.externalToolIds);
  return {
    ...setting,
    ssoDomains: setting.ssoDomains || [],
    educationalToolDomains: setting.educationalToolDomains || [],
    customDomains: usesDefaults
      ? urlRulesToAllowedEntries(urlRules)
      : setting.customDomains?.length
        ? setting.customDomains
        : urlRulesToAllowedEntries(urlRules),
    urlRules,
    externalTools: resolveExternalToolsForAssessment(
      normalizedDefaults?.externalTools,
      externalToolIds,
      setting.externalTools,
      usesDefaults
    ),
    ...(externalToolIds !== undefined ? { externalToolIds } : {}),
    quitPassword: quitPasswordOverride
      ? normalizeOptionalText(setting.quitPassword)
      : normalizedDefaults?.quitPassword || null,
    startPassword: startPasswordOverride
      ? normalizeOptionalText(setting.startPassword)
      : normalizedDefaults?.startPassword || null,
    usesCourseDefaults: usesDefaults,
    quitPasswordOverride,
    startPasswordOverride
  };
}

export function applyCourseDefaultsToContentSetting(
  setting: ContentSebSetting,
  defaults?: CourseSebDefaults | null
): ContentSebSetting {
  const normalizedDefaults = defaults ? normalizeCourseSebDefaults(defaults) : null;
  const usesDefaults = settingUsesCourseDefaults(setting);
  const quitPasswordOverride = setting.quitPasswordOverride === true;
  const startPasswordOverride = setting.startPasswordOverride === true;
  const urlRules = usesDefaults ? normalizedDefaults?.urlRules || [] : normalizeUrlRules(setting.urlRules);
  const externalToolIds = normalizeExternalToolIds(setting.externalToolIds);
  return {
    ...setting,
    ssoDomains: setting.ssoDomains || [],
    educationalToolDomains: setting.educationalToolDomains || [],
    customDomains: usesDefaults
      ? urlRulesToAllowedEntries(urlRules)
      : setting.customDomains?.length
        ? setting.customDomains
        : urlRulesToAllowedEntries(urlRules),
    urlRules,
    externalTools: resolveExternalToolsForAssessment(
      normalizedDefaults?.externalTools,
      externalToolIds,
      setting.externalTools,
      usesDefaults
    ),
    ...(externalToolIds !== undefined ? { externalToolIds } : {}),
    quitPassword: quitPasswordOverride
      ? normalizeOptionalText(setting.quitPassword)
      : normalizedDefaults?.quitPassword || null,
    startPassword: startPasswordOverride
      ? normalizeOptionalText(setting.startPassword)
      : normalizedDefaults?.startPassword || null,
    usesCourseDefaults: usesDefaults,
    quitPasswordOverride,
    startPasswordOverride
  };
}

function quizSebSettingToAssessmentSebState(setting: QuizSebSetting): AssessmentSebState {
  return normalizeAssessmentSebState({
    required: setting.sebRequired,
    enabled: setting.enabled,
    accessCode: setting.accessCode || null,
    configKey: setting.configKey || null,
    configKeySalt: setting.configKeySalt || null,
    quitPassword: setting.quitPassword || null,
    startPassword: setting.startPassword || null,
    usesCourseDefaults: setting.usesCourseDefaults !== false,
    quitPasswordOverride: setting.quitPasswordOverride === true,
    startPasswordOverride: setting.startPasswordOverride === true,
    ssoDomains: setting.ssoDomains || [],
    educationalToolDomains: setting.educationalToolDomains || [],
    customDomains: setting.customDomains || [],
    urlRules: setting.urlRules || [],
    externalTools: setting.externalTools || [],
    externalToolIds: setting.externalToolIds
  });
}

function contentSebSettingToAssessmentSebState(setting: ContentSebSetting): AssessmentSebState {
  return normalizeAssessmentSebState({
    required: setting.sebRequired,
    enabled: setting.enabled,
    accessCode: setting.accessCode || null,
    configKey: setting.configKey || null,
    configKeySalt: setting.configKeySalt || null,
    quitPassword: setting.quitPassword || null,
    startPassword: setting.startPassword || null,
    usesCourseDefaults: setting.usesCourseDefaults !== false,
    quitPasswordOverride: setting.quitPasswordOverride === true,
    startPasswordOverride: setting.startPasswordOverride === true,
    ssoDomains: setting.ssoDomains || [],
    educationalToolDomains: setting.educationalToolDomains || [],
    customDomains: setting.customDomains || [],
    urlRules: setting.urlRules || [],
    externalTools: setting.externalTools || [],
    externalToolIds: setting.externalToolIds
  });
}

function normalizeAssessmentSebState(input?: Partial<AssessmentSebState> | null): AssessmentSebState {
  const urlRules = normalizeUrlRules(
    input?.urlRules?.length ? input.urlRules : legacyDomainsToUrlRules(input?.customDomains)
  );
  return {
    ...defaultAssessmentSebState(),
    ...input,
    required: input?.required === true,
    enabled: input?.enabled === true,
    accessCode: input?.accessCode || null,
    configKey: input?.configKey || null,
    configKeySalt: input?.configKeySalt || null,
    quitPassword: normalizeOptionalText(input?.quitPassword),
    startPassword: normalizeOptionalText(input?.startPassword),
    usesCourseDefaults: input?.usesCourseDefaults !== false,
    quitPasswordOverride: input?.quitPasswordOverride === true,
    startPasswordOverride: input?.startPasswordOverride === true,
    ssoDomains: normalizeConcreteDomains(input?.ssoDomains),
    educationalToolDomains: normalizeConcreteDomains(input?.educationalToolDomains),
    customDomains: urlRulesToAllowedEntries(urlRules),
    urlRules,
    externalTools: normalizeExternalTools(input?.externalTools),
    externalToolIds: normalizeExternalToolIds(input?.externalToolIds)
  };
}

export function normalizeExternalToolAccessRules(input?: ExternalToolAccessRule[] | null): ExternalToolAccessRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.slice(0, 12).flatMap((rule, index) => {
    const match = rule?.match;
    const value = typeof rule?.value === "string" ? rule.value.trim() : "";
    const id = sanitizeToolId(rule?.id || `resource-${index + 1}`);
    let normalized: string | null = null;
    if (match === "exact") {
      normalized = normalizeToolUrl(value);
    } else if (match === "path") {
      normalized = normalizeToolPathRule(value);
    } else if (match === "domain") {
      normalized = normalizeToolDomainRule(value);
    }
    if (!normalized) {
      return [];
    }
    const key = `${match}:${normalized}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [
      {
        id,
        value: normalized,
        match,
        ...(match === "domain" && rule.broadDomainConfirmed === true ? { broadDomainConfirmed: true } : {})
      }
    ];
  });
}

function legacyToolAccessRules(tool: ExternalToolConfig, url: string): ExternalToolAccessRule[] {
  if (tool.matchType === "domain") {
    return [{ id: "legacy-domain", value: url, match: "domain" }];
  }
  if (!Array.isArray(tool.allowedDomains)) {
    return [];
  }
  return tool.allowedDomains.flatMap<ExternalToolAccessRule>((entry, index): ExternalToolAccessRule[] => {
    const value = entry.trim();
    if (value.startsWith("domain:")) {
      return [{ id: `legacy-domain-${index + 1}`, value: value.slice("domain:".length), match: "domain" as const }];
    }
    if (value.startsWith("exact:")) {
      return [{ id: `legacy-exact-${index + 1}`, value: value.slice("exact:".length), match: "exact" as const }];
    }
    if (value.endsWith("/*")) {
      return [{ id: `legacy-path-${index + 1}`, value, match: "path" as const }];
    }
    return [{ id: `legacy-exact-${index + 1}`, value, match: "exact" as const }];
  });
}

function toolAllowlistEntries(input: ExternalToolAccessRule[]): string[] {
  return input.flatMap((rule) => {
    if (rule.match === "exact") {
      return [`exact:${rule.value}`];
    }
    if (rule.match === "path") {
      return [rule.value];
    }
    if (rule.match === "domain") {
      return [`domain:${rule.value}`];
    }
    return [];
  });
}

function cloneExternalTool(tool: ExternalToolConfig): ExternalToolConfig {
  const allowedRules = normalizeExternalToolAccessRules(tool.allowedRules);
  return {
    ...tool,
    allowedRules,
    allowedDomains: toolAllowlistEntries(allowedRules)
  };
}

function findExternalToolPreset(id: string, preset?: string | null): ExternalToolConfig | undefined {
  const requested = preset || id;
  const canonicalId = requested === "desmos-calculator" ? "desmos-graphing" : requested;
  return EXTERNAL_TOOL_PRESETS.find((entry) => entry.id === canonicalId || entry.preset === canonicalId);
}

function normalizeToolUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !normalizeConcreteHostname(parsed.hostname) ||
      isBlockedToolHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeToolPathRule(value: string): string | null {
  const candidate = value.endsWith("/*") ? value.slice(0, -1) : value;
  const url = normalizeToolUrl(candidate);
  if (!url) {
    return null;
  }
  const parsed = new URL(url);
  if (parsed.pathname === "/" || parsed.search || parsed.hash) {
    return null;
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}/*`;
}

function normalizeToolDomainRule(value: string): string | null {
  const candidate = value.includes("://") ? normalizeToolUrl(value) : normalizeToolUrl(`https://${value}`);
  if (!candidate) {
    return null;
  }
  const parsed = new URL(candidate);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return null;
  }
  return isBlockedToolHostname(parsed.hostname) ? null : parsed.hostname;
}

function isBlockedToolHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    new Set([
      "accounts.google.com",
      "accounts.youtube.com",
      "sso.canvaslms.com",
      "www.google.com",
      "www.youtube.com",
      "www.googleapis.com",
      "login.microsoftonline.com",
      "login.live.com",
      "login.okta.com",
      "login.salesforce.com",
      "appleid.apple.com"
    ]).has(normalized) ||
    normalized === "auth0.com" ||
    normalized.endsWith(".auth0.com") ||
    normalized.endsWith(".okta.com") ||
    normalized.endsWith(".onelogin.com")
  );
}

function normalizeUrlRule(entry: SebUrlRule | string, index: number): SebUrlRule | null {
  if (typeof entry === "string") {
    const stripped = stripRulePrefix(entry);
    return stripped && !entry.trim().startsWith("regex:")
      ? normalizeUrlRule(
          {
            id: `rule-${index + 1}`,
            value: stripped,
            match: entry.startsWith("exact:") ? "exact" : "domain"
          },
          index
        )
      : null;
  }
  const value = entry.value?.trim();
  const match = normalizeUrlRuleMatch(entry.match) || "domain";
  if (!value || match === "regex" || value.includes("*")) {
    return null;
  }
  if (isUnsafeBroadUrlPattern(value)) {
    return null;
  }
  if (match === "exact" && !normalizeRuleUrl(value)) {
    return null;
  }
  if (match === "domain" && !normalizeDomainRule(value)) {
    return null;
  }
  return {
    id: sanitizeToolId(entry.id || `${match}-${index + 1}`),
    value: match === "exact" ? normalizeRuleUrl(value)! : match === "domain" ? normalizeDomainRule(value)! : value,
    match
  };
}

function normalizeUrlRuleMatch(value?: string | null): SebUrlRuleMatch | null {
  if (value === "exact" || value === "domain" || value === "regex") {
    return value;
  }
  return null;
}

function normalizeRuleUrl(value: string): string | null {
  const trimmed = stripRulePrefix(value);
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.toString().length > 2048 ||
      !normalizeConcreteHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeDomainRule(value: string): string | null {
  const stripped = stripRulePrefix(value).trim().toLowerCase();
  return normalizeConcreteHostname(stripped);
}

export function normalizeConcreteDomains(value?: string[] | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .slice(0, 32)
      .map((entry) => normalizeDomainRule(entry))
      .filter((entry): entry is string => !!entry)
  );
}

function normalizeConcreteHostname(value: string): string | null {
  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.includes("*") || !hostname.includes(".")) {
    return null;
  }
  if (
    !hostname
      .split(".")
      .every((label) => !!label && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))
  ) {
    return null;
  }
  try {
    return new URL(`https://${hostname}`).hostname === hostname ? hostname : null;
  } catch {
    return null;
  }
}

function stripRulePrefix(value: string): string {
  return value.trim().replace(/^(?:exact|domain|regex):/iu, "");
}

function normalizeOptionalText(value?: string | null): string | null {
  return value?.trim() ? value.trim() : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sanitizeToolId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "external-tool";
}

type RoleAwareLaunchData = Pick<LtiLaunchData, "roles" | "custom">;

const canvasInstructorEnrollments = new Set(["teacherenrollment", "taenrollment", "designerenrollment"]);
const canvasStudentEnrollments = new Set(["studentenrollment"]);
const instructorContextRoles = new Set(["administrator", "contentdeveloper", "instructor"]);
const studentContextRoles = new Set(["learner"]);
const studentInstitutionRoles = new Set(["student", "learner"]);
const instructorPermissions = new Set([
  "manage_assignments_add",
  "manage_assignments_edit",
  "manage_course_content_add",
  "manage_course_content_edit",
  "manage_course_content_delete"
]);

export function isInstructor(launchData?: RoleAwareLaunchData | null): boolean {
  if (!launchData) {
    return false;
  }
  return launchData.roles.some(isContextInstructorRole);
}

export function isStudent(launchData?: RoleAwareLaunchData | null): boolean {
  if (!launchData) {
    return false;
  }
  return launchData.roles.some(isContextStudentRole) || launchData.roles.some(isInstitutionStudentRole);
}

/**
 * Canvas custom substitutions are signed, but they are deployment-configurable and are not the
 * interoperable LTI authorization claim. Keep the standard LTI roles claim authoritative and fail
 * closed when a configured custom field contradicts it.
 */
export function assertLtiRoleClaimsConsistent(launchData: RoleAwareLaunchData): void {
  const standardInstructor = launchData.roles.some(isContextInstructorRole);
  const standardStudent =
    launchData.roles.some(isContextStudentRole) || launchData.roles.some(isInstitutionStudentRole);
  const canvasMembershipRoles = customValues(launchData.custom, ["canvas_membership_roles"]);
  const lisMembershipRoles = customValues(launchData.custom, [
    "canvas_lis_membership_roles",
    "com_instructure_membership_roles"
  ]);
  const permissions = customValues(launchData.custom, ["canvas_membership_permissions"]);
  const customInstructor =
    canvasMembershipRoles.some(isCanvasInstructorEnrollment) ||
    lisMembershipRoles.some(isContextInstructorRole) ||
    permissions.some((permission) => instructorPermissions.has(permission.toLowerCase()));
  const customStudent =
    canvasMembershipRoles.some(isCanvasStudentEnrollment) ||
    lisMembershipRoles.some(isContextStudentRole) ||
    lisMembershipRoles.some(isInstitutionStudentRole);

  if ((customInstructor && !standardInstructor) || (customStudent && !standardStudent)) {
    throw new Error("Conflicting LTI role claims");
  }
}

function isCanvasInstructorEnrollment(role: string): boolean {
  return canvasInstructorEnrollments.has(role.toLowerCase());
}

function isCanvasStudentEnrollment(role: string): boolean {
  return canvasStudentEnrollments.has(role.toLowerCase());
}

function isContextInstructorRole(role: string): boolean {
  const parsed = parseContextRole(role);
  return !!parsed && instructorContextRoles.has(parsed.principal);
}

function isContextStudentRole(role: string): boolean {
  const parsed = parseContextRole(role);
  return !!parsed && studentContextRoles.has(parsed.principal);
}

function isInstitutionStudentRole(role: string): boolean {
  const parsed = parseInstitutionRole(role);
  return !!parsed && studentInstitutionRoles.has(parsed);
}

function parseContextRole(role: string): { principal: string; subRole?: string } | null {
  const value = role.trim();
  const normalized = value.toLowerCase();
  if (!normalized || normalized.startsWith("$")) {
    return null;
  }
  const contextPrefix = "http://purl.imsglobal.org/vocab/lis/v2/membership";
  if (normalized.startsWith(`${contextPrefix}#`)) {
    return { principal: normalized.slice(`${contextPrefix}#`.length) };
  }
  if (normalized.startsWith(`${contextPrefix}/`)) {
    const [principal, subRole] = normalized.slice(`${contextPrefix}/`.length).split("#", 2);
    return principal ? { principal, subRole } : null;
  }
  const legacyContextMatch = normalized.match(/^urn:lti:(?:role:)?ims\/lis\/([^/#:]+)(?:[#/:](.+))?$/u);
  if (legacyContextMatch?.[1]) {
    return { principal: legacyContextMatch[1], subRole: legacyContextMatch[2] };
  }
  if (/^[a-z]+$/u.test(normalized)) {
    return { principal: normalized };
  }
  return null;
}

function parseInstitutionRole(role: string): string | null {
  const normalized = role.trim().toLowerCase();
  const institutionPrefix = "http://purl.imsglobal.org/vocab/lis/v2/institution/person#";
  if (normalized.startsWith(institutionPrefix)) {
    return normalized.slice(institutionPrefix.length);
  }
  return null;
}

function customValues(custom: Record<string, string> | undefined, keys: string[]): string[] {
  return keys.flatMap((key) => splitRoleList(custom?.[key]));
}

function splitRoleList(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("$")) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map(String)
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
