import type { ExternalToolConfig } from "../shared/models.js";

export interface BootstrapPayload {
  view: string;
  data: Record<string, any>;
}

export interface QuizView {
  id: string;
  title: string;
  description?: string | null;
  htmlUrl?: string | null;
  contentType?: string | null;
  quizTypeDisplay?: string | null;
  updatedAt?: string | null;
}

export interface StudentQuizView extends QuizView {
  sebLaunchUrl: string;
  configUrl?: string;
  configGrantUrl?: string;
}

export interface OnboardingContext {
  connection?: "required" | "connected";
  resumeAssessment?: boolean;
  readinessRecommended?: boolean;
  showReadinessPrompt?: boolean;
  canvasConnection?: "connected";
  courseSecurityReady?: boolean;
  courseSetupComplete?: boolean;
  enabledAssessmentCount?: number;
}

export type InstructorSetupStep = "welcome" | "security" | "tools" | "enable";

export type Toast = {
  id: string;
  tone: "success" | "error";
  message: string;
};

export type CourseToolCopyCourse = {
  courseId: string;
  name: string;
  courseCode: string | null;
};

export type CourseToolCopyResult = {
  copied: CourseToolCopyCourse[];
  alreadyPresent: CourseToolCopyCourse[];
  failed: Array<CourseToolCopyCourse & { errorCode?: string }>;
};

export type ClientRequestError = Error & {
  code?: string;
  status?: number;
  detail?: string;
  userFacing?: true;
};

export type OnboardingRecovery = {
  message: string;
  actionLabel?: string;
  actionUrl?: string;
};

export type SebLaunchHandoffPurpose = "assessment" | "setup-check" | "student-list";

export type AdminAssessmentView = {
  id: string;
  title: string;
  contentType: string;
  published: boolean;
  sebRequired: boolean;
  enabled: boolean;
  hasAccessCode: boolean;
  hasStartPassword: boolean;
  hasQuitPassword: boolean;
  updatedAt?: string | null;
};

export type AdminCourseView = {
  id: string;
  name: string;
  courseCode?: string | null;
  workflowState?: string | null;
  concluded?: boolean;
  termId?: string | null;
  termName?: string | null;
  teacherNames?: string[];
  setupCompleted?: boolean;
  hasCourseDefaults?: boolean;
  assessmentCount: number;
  enabledAssessmentCount: number;
  issueCount?: number;
  lastRefreshedAt?: string | null;
  adminToolPresetIds?: string[];
  assessments?: AdminAssessmentView[];
};

export type AdminTermView = {
  id: string;
  name: string;
  startAt?: string | null;
  endAt?: string | null;
};

export type AdminToolPresetView = {
  id: string;
  name: string;
  description?: string | null;
  tool: ExternalToolConfig;
  assignedCourseIds: string[];
  assignedCourseCount: number;
  pendingAssignmentCount?: number;
  failedAssignmentCount?: number;
  updatedAt?: string | null;
};

export type AdminOverview = {
  account?: { id?: string; name?: string };
  operationalTerm?: AdminTermView | null;
  terms?: AdminTermView[];
  summary?: {
    courseCount?: number;
    configuredCourseCount?: number;
    assessmentCount?: number;
    enabledAssessmentCount?: number;
    issueCount?: number;
    toolPresetCount?: number;
    pendingPresetAssignmentCount?: number;
    failedPresetAssignmentCount?: number;
  };
  courses?: AdminCourseView[];
  toolPresets?: AdminToolPresetView[];
  nextCourseCursor?: string | null;
};

export type RevealedSecrets = {
  expiresAt: number;
  values: Array<{ label: string; value: string; source?: string }>;
};

export type AdminSection = "courses" | "institution";

export type RevealedPasswordValue = {
  value: string | null;
  source: "assessment" | "course" | "managed" | "none";
};

export type SetupCheckStatus = "pending" | "pass" | "fail";

export interface SetupCheckItem {
  id: string;
  label: string;
  detail: string;
  status: SetupCheckStatus;
}
