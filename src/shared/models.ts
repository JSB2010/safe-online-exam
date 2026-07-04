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
  externalToolUrl?: string | null;
  quitPassword?: string | null;
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
    customDomains: []
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
    customDomains: []
  };
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
