import type { AdminCourseConnectionRecord, AssessmentRecord, ExternalToolConfig } from "../../shared/models.js";
import {
  normalizeExternalToolAccessRules,
  normalizeExternalTools,
  parseNewQuizContentId,
  YOUTUBE_VIDEO_TOOL_PRESET
} from "../../shared/models.js";
import { apiError } from "../http/api-error.js";

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_BULK_LIMIT = 50;
export const ADMIN_RECONCILE_BATCH_SIZE = 12;
export const ADMIN_COURSE_STATUS_TTL_MS = 6 * 60 * 60 * 1000;
import { type CanvasEnrollmentTerm } from "../services/canvas-api.service.js";

export function groupAssessments(assessments: AssessmentRecord[]): Map<string, AssessmentRecord[]> {
  const grouped = new Map<string, AssessmentRecord[]>();
  for (const assessment of assessments) {
    const values = grouped.get(assessment.courseId) || [];
    values.push(assessment);
    grouped.set(assessment.courseId, values);
  }
  return grouped;
}

export function assessmentCounts(assessments: AssessmentRecord[]): {
  assessmentCount: number;
  enabledAssessmentCount: number;
  issueCount: number;
} {
  return {
    assessmentCount: assessments.length,
    enabledAssessmentCount: assessments.filter((assessment) => assessment.seb.required === true).length,
    issueCount: assessments.filter(
      (assessment) =>
        assessment.canvasVerification?.status === "missing" || assessment.canvasVerification?.status === "stale"
    ).length
  };
}

export function adminCourseListView(course: AdminCourseConnectionRecord) {
  return {
    id: course.courseId,
    name: course.name,
    courseCode: course.courseCode || null,
    accountId: course.accountId,
    workflowState: course.workflowState || null,
    concluded: course.concluded === true,
    termId: course.termId || null,
    termName: course.termName || null,
    teacherNames: course.teacherNames,
    assessmentCount: course.assessmentCount,
    enabledAssessmentCount: course.enabledAssessmentCount,
    issueCount: course.issueCount,
    lastRefreshedAt: course.lastRefreshedAt || null
  };
}

export function currentEnrollmentTerm(terms: CanvasEnrollmentTerm[], now = Date.now()): CanvasEnrollmentTerm | null {
  const dated = terms.map((term) => ({
    term,
    start: term.startAt ? Date.parse(term.startAt) : Number.NEGATIVE_INFINITY,
    end: term.endAt ? Date.parse(term.endAt) : Number.POSITIVE_INFINITY,
    hasBoundary: !!term.startAt || !!term.endAt
  }));
  return (
    dated.find(({ start, end, hasBoundary }) => hasBoundary && start <= now && end >= now)?.term ||
    dated.filter(({ start }) => start <= now).sort((left, right) => right.start - left.start)[0]?.term ||
    dated.filter(({ start }) => start > now).sort((left, right) => left.start - right.start)[0]?.term ||
    terms[0] ||
    null
  );
}

export function normalizedPageSize(value: unknown): number {
  if (typeof value !== "string" || !/^[0-9]{1,3}$/u.test(value)) {
    return ADMIN_PAGE_SIZE;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : ADMIN_PAGE_SIZE;
}

export function normalizedSearch(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/gu, " ").slice(0, 120);
  return normalized || undefined;
}

export function scalarQueryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function encodeCourseCursor(course: Pick<AdminCourseConnectionRecord, "name" | "courseId">): string {
  return Buffer.from(JSON.stringify({ name: course.name, courseId: course.courseId }), "utf8").toString("base64url");
}

export function decodeCourseCursor(value: unknown): { name: string; courseId: string } | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,1000}$/u.test(value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof parsed.name === "string" && typeof parsed.courseId === "string"
      ? { name: parsed.name.slice(0, 200), courseId: parsed.courseId.slice(0, 40) }
      : null;
  } catch {
    return null;
  }
}

export function encodeCanvasPageCursor(page: number): string {
  return Buffer.from(String(page), "utf8").toString("base64url");
}

export function decodeCanvasPageCursor(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/u.test(value)) {
    return 1;
  }
  try {
    const page = Number(Buffer.from(value, "base64url").toString("utf8"));
    return Number.isSafeInteger(page) && page > 0 && page <= 10_000 ? page : 1;
  } catch {
    return 1;
  }
}

export function normalizedCourseIds(body: unknown): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "Provide one or more Canvas course IDs or course URLs");
  }
  const input = body as { courseIds?: unknown; input?: unknown };
  const rawValues = Array.isArray(input.courseIds)
    ? input.courseIds
    : typeof input.input === "string"
      ? input.input.split(/[\s,]+/u)
      : [];
  const courseIds = Array.from(
    new Set(
      rawValues
        .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
        .map((value) => {
          const normalized = String(value).trim();
          return /^\d+$/u.test(normalized) ? normalized : normalized.match(/\/courses\/(\d+)(?:[/?#]|$)/u)?.[1] || "";
        })
        .filter(isNumericCanvasId)
    )
  );
  if (!courseIds.length || courseIds.length > ADMIN_BULK_LIMIT) {
    return apiError(400, `Provide between 1 and ${ADMIN_BULK_LIMIT} valid Canvas course IDs or URLs`, {
      error_code: "INVALID_ADMIN_COURSE_IDS"
    });
  }
  return courseIds;
}

export function normalizedOperationalTermId(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "Select an active Canvas enrollment term");
  }
  const termId = (body as { termId?: unknown }).termId;
  if (typeof termId !== "string" || !/^\d+$/u.test(termId)) {
    return apiError(400, "Select an active Canvas enrollment term");
  }
  return termId;
}

export function normalizedBulkAssignmentInput(body: unknown): {
  assigned: boolean;
  all: boolean;
  courseIds: string[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "A bulk assignment selection is required");
  }
  const input = body as { assigned?: unknown; all?: unknown; courseIds?: unknown };
  if (typeof input.assigned !== "boolean" || typeof input.all !== "boolean") {
    return apiError(400, "assigned and all must be booleans");
  }
  const courseIds = Array.isArray(input.courseIds)
    ? Array.from(
        new Set(
          input.courseIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(isNumericCanvasId)
        )
      )
    : [];
  if (!input.all && !courseIds.length) {
    return apiError(400, "Select at least one connected course");
  }
  return { assigned: input.assigned, all: input.all, courseIds };
}

export function adminAssessmentView(assessment: AssessmentRecord) {
  return {
    id: assessment.id,
    courseId: assessment.courseId,
    contentType: assessment.contentType,
    title: assessment.canvas.title || "Untitled assessment",
    htmlUrl: assessment.canvas.htmlUrl || null,
    published: assessment.canvas.published === true,
    sebRequired: assessment.seb.required === true,
    enabled: assessment.seb.enabled === true,
    hasAccessCode: !!assessment.seb.accessCode,
    hasStartPassword: !!assessment.seb.startPassword,
    hasQuitPassword: !!assessment.seb.quitPassword,
    usesCourseDefaults: assessment.seb.usesCourseDefaults === true,
    verificationStatus: assessment.canvasVerification?.status || "unverified",
    updatedAt: assessment.updatedAt || null
  };
}

export function normalizedToolPresetInput(body: unknown): {
  name: string;
  description: string | null;
  tool: ExternalToolConfig;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return apiError(400, "A school tool preset is required");
  }
  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/gu, " ") : "";
  const description = typeof input.description === "string" ? input.description.trim().replace(/\s+/gu, " ") : "";
  if (!name || name.length > 80 || description.length > 240) {
    return apiError(400, "Preset names must be 1–80 characters and descriptions must be at most 240 characters", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  if (!input.tool || typeof input.tool !== "object" || Array.isArray(input.tool)) {
    return apiError(400, "A valid external tool definition is required", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  const rawTool = input.tool as Record<string, unknown>;
  const rawRules = Array.isArray(rawTool.allowedRules) ? rawTool.allowedRules : [];
  if (
    Object.hasOwn(rawTool, "allowedDomains") ||
    Object.hasOwn(rawTool, "matchType") ||
    Object.hasOwn(rawTool, "allowedPattern") ||
    rawRules.length > 12 ||
    rawRules.some(
      (rule) =>
        !rule ||
        typeof rule !== "object" ||
        Array.isArray(rule) ||
        normalizeExternalToolAccessRules([rule as any]).length !== 1 ||
        ((rule as { match?: unknown }).match === "domain" &&
          (rule as { broadDomainConfirmed?: unknown }).broadDomainConfirmed !== true)
    )
  ) {
    return apiError(400, "Preset resources must use explicit HTTPS URLs or confirmed domains", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  const [tool] = normalizeExternalTools([
    {
      ...(rawTool as unknown as ExternalToolConfig),
      id: "school-preset-template",
      label: name,
      enabled: false,
      preset: rawTool.preset === YOUTUBE_VIDEO_TOOL_PRESET ? YOUTUBE_VIDEO_TOOL_PRESET : null,
      adminPresetId: null,
      managedByAdmin: false
    }
  ]);
  if (!tool || typeof rawTool.url !== "string" || !rawTool.url.trim().startsWith("https://")) {
    return apiError(400, "Preset tools require an exact HTTPS launch URL and safe resource rules", {
      error_code: "INVALID_ADMIN_TOOL_PRESET"
    });
  }
  return { name, description: description || null, tool };
}

export function requiredQuizId(assessment: AssessmentRecord): string {
  const value = assessment.canvas.quizId || assessment.canvas.id;
  if (!value) {
    return apiError(409, "Classic Quiz identifier is unavailable", { error_code: "ASSESSMENT_ID_UNAVAILABLE" });
  }
  return value;
}

export function requiredAssignmentId(assessment: AssessmentRecord): string {
  const parsed = parseNewQuizContentId(assessment.id);
  const value = assessment.canvas.assignmentId || parsed?.assignmentId;
  if (!value) {
    return apiError(409, "New Quiz assignment identifier is unavailable", {
      error_code: "ASSESSMENT_ID_UNAVAILABLE"
    });
  }
  return value;
}

export function isNumericCanvasId(value: string): boolean {
  return /^\d+$/u.test(value);
}

export function safeErrorDetail(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    return `HTTP ${String((error as { status?: unknown }).status || "error")}`;
  }
  return error instanceof Error ? error.name : "Unknown error";
}
