import { ContentItem, ContentType, Quiz } from "./canvas.js";
import { CourseSebDefaults, normalizeCourseSebDefaults } from "./course.js";
import {
  ExternalToolConfig,
  normalizeExternalToolIds,
  normalizeExternalTools,
  resolveExternalToolsForAssessment
} from "./external-tools.js";
import { normalizeOptionalText } from "./normalization.js";
import {
  SebUrlRule,
  legacyDomainsToUrlRules,
  normalizeConcreteDomains,
  normalizeUrlRules,
  urlRulesToAllowedEntries
} from "./url-rules.js";

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
  /** Quiz-owned definitions that are merged with the selected course catalog. */
  quizOnlyExternalTools: ExternalToolConfig[];
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
  quizOnlyExternalTools?: ExternalToolConfig[] | null;
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
  quizOnlyExternalTools?: ExternalToolConfig[] | null;
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

export interface SebQuitPasswordAvailability {
  hasEffectiveQuitPassword?: boolean;
}

export function canEnableSebAssessment(
  setting?: SebQuitPasswordAvailability | null,
  defaults?: SebQuitPasswordAvailability | null
): boolean {
  return setting?.hasEffectiveQuitPassword === true || defaults?.hasEffectiveQuitPassword === true;
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
  quizOnlyExternalTools?: ExternalToolConfig[] | null;
  externalToolIds?: string[] | null;
  externalToolUrl?: string | null;
  quitPassword?: string | null;
  startPassword?: string | null;
  usesCourseDefaults?: boolean | null;
  quitPasswordOverride?: boolean | null;
  startPasswordOverride?: boolean | null;
}

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
    quizOnlyExternalTools: [],
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
    quizOnlyExternalTools: seb.quizOnlyExternalTools,
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
    quizOnlyExternalTools: seb.quizOnlyExternalTools,
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
    quizOnlyExternalTools: [],
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
    quizOnlyExternalTools: [],
    externalToolIds: null
  };
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
      usesDefaults,
      setting.quizOnlyExternalTools
    ),
    quizOnlyExternalTools: normalizeExternalTools(setting.quizOnlyExternalTools),
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
      usesDefaults,
      setting.quizOnlyExternalTools
    ),
    quizOnlyExternalTools: normalizeExternalTools(setting.quizOnlyExternalTools),
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
    quizOnlyExternalTools: setting.quizOnlyExternalTools || [],
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
    quizOnlyExternalTools: setting.quizOnlyExternalTools || [],
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
    quizOnlyExternalTools: normalizeExternalTools(input?.quizOnlyExternalTools),
    externalToolIds: normalizeExternalToolIds(input?.externalToolIds)
  };
}
