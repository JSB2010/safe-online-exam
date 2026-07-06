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
  externalTools: ExternalToolConfig[];
  canvasDomain?: string | null;
  canvasAssignmentId?: string | null;
  deepLinkUrl?: string | null;
  quitPassword?: string | null;
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
  externalTools: ExternalToolConfig[];
  quitPassword?: string | null;
  metadata?: Record<string, unknown>;
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
  ssoDomains?: string[] | null;
  educationalToolDomains?: string[] | null;
  customDomains?: string[] | null;
  externalTools?: ExternalToolConfig[] | null;
  externalToolUrl?: string | null;
  quitPassword?: string | null;
}

export interface ExternalToolConfig {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  preset?: string | null;
  allowedDomains?: string[] | null;
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
    externalTools: []
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
    seen.add(uniqueId);
    return [
      {
        id: uniqueId,
        label,
        url,
        enabled: !!tool.enabled,
        preset: tool.preset?.trim() || null,
        allowedDomains: normalizeToolDomains(preset ? preset.allowedDomains : tool.allowedDomains)
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
  return Array.from(new Set(value.map((entry) => entry.trim()).filter(Boolean)));
}

function sanitizeToolId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "external-tool";
}

export function isInstructor(launchData?: Pick<LtiLaunchData, "roles"> | null): boolean {
  if (!launchData) {
    return false;
  }
  return launchData.roles.some(
    (role) =>
      role.includes("Instructor") ||
      role.includes("TeachingAssistant") ||
      role.includes("ContentDeveloper") ||
      role.includes("Administrator")
  );
}

export function isStudent(launchData?: Pick<LtiLaunchData, "roles"> | null): boolean {
  return !!launchData?.roles.some((role) => role.includes("Learner") || role.includes("Student"));
}
