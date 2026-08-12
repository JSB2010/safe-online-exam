import type { CourseSebDefaults, ExternalToolConfig, StructuredSebConfigRequest } from "../../shared/models.js";
import {
  legacyDomainsToUrlRules,
  normalizeConcreteDomains,
  normalizeExternalToolAccessRules,
  normalizeExternalToolIds,
  normalizeExternalTools,
  normalizeUrlRules
} from "../../shared/models.js";
import { apiError } from "../http/api-error.js";

export const COURSE_TOOL_COPY_TARGET_LIMIT = 100;
export const COURSE_TOOL_COPY_CONCURRENCY = 6;
import { type CanvasApiPermissionError, type CanvasInstructorCourse } from "../services/canvas-api.service.js";

export function secretUpdate(
  body: Record<string, unknown>,
  key: "quitPassword" | "startPassword",
  existing: string | null | undefined
): string | null {
  if (!Object.hasOwn(body, key)) {
    return existing || null;
  }
  const value = body[key];
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.trim() ? value : existing || null;
}

export function courseSecretUpdate(
  body: Record<string, unknown>,
  key: "quitPassword" | "startPassword"
): CourseSebDefaults["quitPassword"] | undefined {
  if (!Object.hasOwn(body, key)) {
    return undefined;
  }
  const value = body[key];
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function assertSafePolicyInput(body: Record<string, unknown>): void {
  const rules = Array.isArray(body.urlRules) ? body.urlRules : [];
  if (rules.some((rule) => normalizeUrlRules([rule as any]).length !== 1)) {
    apiError(
      400,
      "Allowed URLs must be exact HTTPS URLs or concrete domains; regex and wildcard rules are not allowed",
      {
        error_code: "INVALID_SEB_URL_POLICY"
      }
    );
  }
  for (const key of ["ssoDomains", "educationalToolDomains", "customDomains"] as const) {
    const values = Array.isArray(body[key]) ? (body[key] as unknown[]) : [];
    if (
      values.some(
        (value) =>
          typeof value !== "string" ||
          (key === "customDomains"
            ? legacyDomainsToUrlRules([value]).length !== 1
            : normalizeConcreteDomains([value]).length !== 1)
      )
    ) {
      apiError(400, "SEB domain rules must use concrete hostnames without wildcards", {
        error_code: "INVALID_SEB_DOMAIN_POLICY"
      });
    }
  }
  const tools = [
    ...(Array.isArray(body.externalTools) ? (body.externalTools as Array<Record<string, unknown>>) : []),
    ...(Array.isArray(body.quizOnlyExternalTools) ? (body.quizOnlyExternalTools as Array<Record<string, unknown>>) : [])
  ];
  if (
    tools.some(
      (tool) =>
        tool.matchType === "regex" ||
        typeof tool.allowedPattern === "string" ||
        typeof tool.url !== "string" ||
        !tool.url.trim().startsWith("https://") ||
        // Responses retain legacy `allowedDomains` as a derived compatibility
        // field. Current custom tools submit it beside authoritative rules.
        (Array.isArray(tool.allowedDomains) &&
          tool.allowedDomains.length > 0 &&
          !tool.preset &&
          !(Array.isArray(tool.allowedRules) && tool.allowedRules.length > 0)) ||
        (Array.isArray(tool.allowedRules) &&
          (tool.allowedRules as unknown[]).some(
            (rule) =>
              normalizeExternalToolAccessRules([rule as any]).length !== 1 ||
              ((rule as { match?: unknown; broadDomainConfirmed?: unknown }).match === "domain" &&
                (rule as { broadDomainConfirmed?: unknown }).broadDomainConfirmed !== true)
          )) ||
        normalizeExternalTools([tool as any]).length !== 1
    )
  ) {
    apiError(400, "External tools must use an exact HTTPS launch URL and explicit safe resource paths", {
      error_code: "INVALID_SEB_TOOL_POLICY"
    });
  }
}

export function requestedQuizOnlyTools(
  body: StructuredSebConfigRequest,
  existing?: ExternalToolConfig[] | null
): ExternalToolConfig[] {
  if (!Object.hasOwn(body, "quizOnlyExternalTools")) {
    return normalizeExternalTools(existing);
  }
  if (!Array.isArray(body.quizOnlyExternalTools)) {
    return apiError(400, "Quiz-only exam tools must be a list", {
      error_code: "INVALID_SEB_TOOL_POLICY"
    });
  }
  return normalizeExternalTools(body.quizOnlyExternalTools).map((tool) => ({
    ...tool,
    enabled: true,
    managedByAdmin: false,
    adminPresetId: null
  }));
}

export function requestedExternalToolIds(
  body: StructuredSebConfigRequest,
  existing?: string[] | null
): string[] | null | undefined {
  if (!Object.hasOwn(body, "externalToolIds")) {
    return existing;
  }
  if (body.externalToolIds !== null && !Array.isArray(body.externalToolIds)) {
    apiError(400, "Exam tool selections must be a list of course tool ids", {
      error_code: "INVALID_SEB_TOOL_SELECTION"
    });
  }
  return normalizeExternalToolIds(body.externalToolIds);
}

export function copyTargetCourseIds(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.courseIds)) {
    return apiError(400, "Choose at least one instructor course.", { error_code: "COURSE_TOOL_COPY_TARGETS_REQUIRED" });
  }
  const ids = Array.from(
    new Set(
      body.courseIds
        .filter((courseId): courseId is string => typeof courseId === "string")
        .map((courseId) => courseId.trim())
        .filter((courseId) => courseId.length > 0 && courseId.length <= 128)
    )
  );
  if (!ids.length || ids.length !== body.courseIds.length) {
    return apiError(400, "Choose one or more valid instructor courses.", {
      error_code: "COURSE_TOOL_COPY_TARGETS_REQUIRED"
    });
  }
  if (ids.length > COURSE_TOOL_COPY_TARGET_LIMIT) {
    return apiError(409, `Copy one exam tool to at most ${COURSE_TOOL_COPY_TARGET_LIMIT} courses at a time.`, {
      error_code: "COURSE_TOOL_COPY_LIMIT"
    });
  }
  return ids;
}

export function courseToolCopyCourseView(course: CanvasInstructorCourse): {
  courseId: string;
  name: string;
  courseCode: string | null;
} {
  return { courseId: course.id, name: course.name, courseCode: course.courseCode };
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export function courseToolCopyFailureCode(error: unknown): string {
  const response =
    error && typeof error === "object" && "getResponse" in error && typeof error.getResponse === "function"
      ? error.getResponse()
      : null;
  if (response && typeof response === "object" && "error_code" in response) {
    const errorCode = (response as { error_code?: unknown }).error_code;
    if (
      typeof errorCode === "string" &&
      [
        "COURSE_TOOL_LIMIT",
        "COURSE_RESET_IN_PROGRESS",
        "COURSE_UPDATE_IN_PROGRESS",
        "COURSE_SETTINGS_NO_LONGER_AVAILABLE"
      ].includes(errorCode)
    ) {
      return errorCode;
    }
  }
  return "COURSE_TOOL_COPY_FAILED";
}

export function canvasAuthorizationRequired(courseId: string, userId: string): Record<string, unknown> {
  return {
    success: false,
    requiresAuth: true,
    message: "Canvas rejected the saved authorization. Reauthorize Canvas access to continue.",
    authUrl: `/api/oauth2reauthorize?course_id=${encodeURIComponent(courseId)}&user_id=${encodeURIComponent(userId)}&redirect_url=${encodeURIComponent(`/lti/launch?course_id=${courseId}&user_id=${userId}`)}`
  };
}

export function canvasPermissionDenied(error: CanvasApiPermissionError): Record<string, unknown> {
  return {
    success: false,
    error_code: "CANVAS_PERMISSION_DENIED",
    message:
      "Canvas denied this request. The saved Canvas authorization is valid, but the Developer Key is missing a required scope or Canvas denied the user's course permission. Confirm the Canvas API scope set, then reauthorize Canvas.",
    canvasStatus: error.status,
    canvasPath: safeCanvasPath(error.url)
  };
}

function safeCanvasPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

type PasswordSource = "assessment" | "course" | "managed" | "none";

export function passwordRevealResponse(
  startPassword: string | null,
  startSource: PasswordSource,
  quitPassword: string | null,
  quitSource: PasswordSource
): Record<string, unknown> {
  return {
    success: true,
    expiresInSeconds: 30,
    passwords: {
      start: { value: startPassword, source: startSource },
      // A managed server default is intentionally never returned to the browser.
      exit: { value: quitSource === "managed" ? null : quitPassword, source: quitSource }
    }
  };
}
