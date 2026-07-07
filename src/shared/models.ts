export type ContentType = "CLASSIC_QUIZ" | "NEW_QUIZ" | "ASSIGNMENT" | "DISCUSSION" | "EXTERNAL_TOOL" | "PAGE";

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
  metadata?: Record<string, unknown>;
}

export interface QuizSebSetting {
  id?: string | null;
  quizId: string;
  courseId?: string | null;
  sebRequired: boolean;
  enabled: boolean;
  accessCode?: string | null;
  browserExamKey?: string | null;
  configKey?: string | null;
  allowedSites?: string | null;
  externalToolUrl?: string | null;
  ssoDomains: string[];
  educationalToolDomains: string[];
  customDomains: string[];
  urlRules?: SebUrlRule[] | null;
  externalTools: ExternalToolConfig[];
  canvasDomain?: string | null;
  canvasAssignmentId?: string | null;
  deepLinkUrl?: string | null;
  quitPassword?: string | null;
  usesCourseDefaults?: boolean | null;
  quitPasswordOverride?: boolean | null;
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
  browserExamKey?: string | null;
  configKey?: string | null;
  externalToolUrl?: string | null;
  deepLinkUrl?: string | null;
  ssoDomains: string[];
  educationalToolDomains: string[];
  customDomains: string[];
  urlRules?: SebUrlRule[] | null;
  externalTools: ExternalToolConfig[];
  quitPassword?: string | null;
  usesCourseDefaults?: boolean | null;
  quitPasswordOverride?: boolean | null;
  metadata?: Record<string, unknown>;
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
  urlRules: SebUrlRule[];
  externalTools: ExternalToolConfig[];
  setupCompleted: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface OAuthToken {
  id?: string | null;
  userId: string;
  accessToken: string;
  refreshToken?: string | null;
  scope?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ModuleItemUpdate {
  id?: string | null;
  courseId: string;
  quizId: string;
  moduleId: string;
  moduleName?: string | null;
  moduleItemId: string;
  title?: string | null;
  originalUrl?: string | null;
  sebUrl?: string | null;
  usingSebUrl: boolean;
  metadata?: Record<string, unknown>;
}

export interface LtiLaunchData {
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
  deepLinkingSettings?: Record<string, unknown>;
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
  externalToolUrl?: string | null;
  quitPassword?: string | null;
  usesCourseDefaults?: boolean | null;
  quitPasswordOverride?: boolean | null;
}

export interface ExternalToolConfig {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  preset?: string | null;
  allowedDomains?: string[] | null;
  matchType?: SebUrlRuleMatch | null;
  allowedPattern?: string | null;
}

export const EXTERNAL_TOOL_PRESETS: ExternalToolConfig[] = [
  {
    id: "desmos-calculator",
    label: "Desmos",
    url: "https://www.desmos.com/calculator",
    enabled: false,
    preset: "desmos-calculator",
    allowedDomains: [
      "https://www.desmos.com/assets/build/*",
      "https://www.desmos.com/assets/img/apps/graphing/*",
      "https://www.desmos.com/assets/pwa/*"
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
  const parts = contentId.split(":", 3);
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
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
    quizTypeDisplay: quiz.quizTypeDisplay || "Classic Quiz"
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
    externalTools: []
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
    externalTools: []
  };
}

export function defaultCourseSebDefaults(courseId: string): CourseSebDefaults {
  return {
    id: courseId,
    courseId,
    quitPassword: null,
    urlRules: [],
    externalTools: [],
    setupCompleted: false
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
    urlRules: normalizeUrlRules(input?.urlRules),
    externalTools: normalizeExternalTools(input?.externalTools),
    setupCompleted: !!input?.setupCompleted
  };
}

export function normalizeExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.flatMap((tool, index) => {
    const label = tool.label?.trim();
    const url = normalizeToolUrl(tool.url);
    if (!label || !url) {
      return [];
    }
    const id = sanitizeToolId(tool.id || tool.preset || label || `tool-${index + 1}`);
    const uniqueId = seen.has(id) ? `${id}-${index + 1}` : id;
    const preset = EXTERNAL_TOOL_PRESETS.find((entry) => entry.id === id || entry.preset === tool.preset);
    const matchType = normalizeUrlRuleMatch(tool.matchType);
    const allowedDomains = normalizeToolDomains(preset ? preset.allowedDomains : tool.allowedDomains);
    if (matchType === "domain") {
      const domain = domainFromUrl(url);
      if (domain) {
        allowedDomains.push(`domain:${domain}`);
      }
    }
    if (matchType === "regex" && tool.allowedPattern?.trim()) {
      allowedDomains.push(`regex:${tool.allowedPattern.trim()}`);
    }
    seen.add(uniqueId);
    return [
      {
        id: uniqueId,
        label,
        url,
        enabled: !!tool.enabled,
        preset: tool.preset?.trim() || null,
        allowedDomains: uniqueStrings(allowedDomains),
        ...(matchType ? { matchType } : {}),
        ...(tool.allowedPattern?.trim() ? { allowedPattern: tool.allowedPattern.trim() } : {})
      }
    ];
  });
}

export function enabledExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  return normalizeExternalTools(input).filter((tool) => tool.enabled);
}

export function allowlistEntriesForExternalTools(input?: ExternalToolConfig[] | null): string[] {
  const entries = new Set<string>();
  for (const tool of enabledExternalTools(input)) {
    entries.add(tool.url);
    for (const domain of tool.allowedDomains || []) {
      entries.add(domain);
    }
  }
  return Array.from(entries);
}

export function normalizeUrlRules(input?: SebUrlRule[] | string[] | null): SebUrlRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.flatMap((entry, index) => {
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
  const rules: SebUrlRule[] = input.map((entry, index) => ({
    id: `domain-${index + 1}`,
    value: stripRulePrefix(entry),
    match: entry.trim().startsWith("regex:") ? "regex" : entry.trim().startsWith("exact:") ? "exact" : "domain"
  }));
  return normalizeUrlRules(rules);
}

export function urlRulesToAllowedEntries(input?: SebUrlRule[] | null): string[] {
  return normalizeUrlRules(input).map((rule) => {
    switch (rule.match) {
      case "exact":
        return `exact:${normalizeRuleUrl(rule.value) || rule.value}`;
      case "regex":
        return `regex:${rule.value}`;
      case "domain":
      default:
        return `domain:${normalizeDomainRule(rule.value) || rule.value}`;
    }
  });
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
  const urlRules = usesDefaults ? normalizedDefaults?.urlRules || [] : normalizeUrlRules(setting.urlRules);
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
    externalTools: usesDefaults
      ? normalizeExternalTools(normalizedDefaults?.externalTools)
      : normalizeExternalTools(setting.externalTools),
    quitPassword: quitPasswordOverride
      ? normalizeOptionalText(setting.quitPassword)
      : normalizedDefaults?.quitPassword || null,
    usesCourseDefaults: usesDefaults,
    quitPasswordOverride
  };
}

export function applyCourseDefaultsToContentSetting(
  setting: ContentSebSetting,
  defaults?: CourseSebDefaults | null
): ContentSebSetting {
  const normalizedDefaults = defaults ? normalizeCourseSebDefaults(defaults) : null;
  const usesDefaults = settingUsesCourseDefaults(setting);
  const quitPasswordOverride = setting.quitPasswordOverride === true;
  const urlRules = usesDefaults ? normalizedDefaults?.urlRules || [] : normalizeUrlRules(setting.urlRules);
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
    externalTools: usesDefaults
      ? normalizeExternalTools(normalizedDefaults?.externalTools)
      : normalizeExternalTools(setting.externalTools),
    quitPassword: quitPasswordOverride
      ? normalizeOptionalText(setting.quitPassword)
      : normalizedDefaults?.quitPassword || null,
    usesCourseDefaults: usesDefaults,
    quitPasswordOverride
  };
}

function normalizeToolUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeToolDomains(value?: string[] | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((entry) => entry.trim()).filter(Boolean));
}

function normalizeUrlRule(entry: SebUrlRule | string, index: number): SebUrlRule | null {
  if (typeof entry === "string") {
    const stripped = stripRulePrefix(entry);
    return stripped
      ? {
          id: `rule-${index + 1}`,
          value: stripped,
          match: entry.startsWith("regex:") ? "regex" : entry.startsWith("exact:") ? "exact" : "domain"
        }
      : null;
  }
  const value = entry.value?.trim();
  const match = normalizeUrlRuleMatch(entry.match) || "domain";
  if (!value) {
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
    if (parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeDomainRule(value: string): string | null {
  const stripped = stripRulePrefix(value).replace(/^https?:\/\//iu, "");
  const domain = stripped.split("/")[0]?.trim().toLowerCase();
  if (!domain || domain.includes(" ") || domain === "*" || domain.startsWith(".")) {
    return null;
  }
  return domain;
}

function stripRulePrefix(value: string): string {
  return value.trim().replace(/^(?:exact|domain|regex):/iu, "");
}

function domainFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
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
  const canvasMembershipRoles = customValues(launchData.custom, ["canvas_membership_roles"]);
  if (canvasMembershipRoles.some(isCanvasInstructorEnrollment)) {
    return true;
  }
  if (canvasMembershipRoles.some(isCanvasStudentEnrollment)) {
    return false;
  }
  const lisMembershipRoles = customValues(launchData.custom, [
    "canvas_lis_membership_roles",
    "com_instructure_membership_roles"
  ]);
  if (lisMembershipRoles.some(isContextInstructorRole)) {
    return true;
  }
  const permissions = customValues(launchData.custom, ["canvas_membership_permissions"]);
  if (permissions.some((permission) => instructorPermissions.has(permission.toLowerCase()))) {
    return true;
  }
  return launchData.roles.some(isContextInstructorRole);
}

export function isStudent(launchData?: RoleAwareLaunchData | null): boolean {
  if (!launchData) {
    return false;
  }
  const canvasMembershipRoles = customValues(launchData.custom, ["canvas_membership_roles"]);
  if (canvasMembershipRoles.some(isCanvasStudentEnrollment)) {
    return true;
  }
  const lisMembershipRoles = customValues(launchData.custom, [
    "canvas_lis_membership_roles",
    "com_instructure_membership_roles"
  ]);
  return (
    lisMembershipRoles.some(isContextStudentRole) ||
    lisMembershipRoles.some(isInstitutionStudentRole) ||
    launchData.roles.some(isContextStudentRole) ||
    launchData.roles.some(isInstitutionStudentRole)
  );
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
