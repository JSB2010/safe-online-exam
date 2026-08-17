import { ClientRequestError, OnboardingRecovery } from "../types.js";

export function redirectForAuth(body: Record<string, any>): boolean {
  if (body.requiresAuth && body.authUrl) {
    window.location.href = body.authUrl;
    return true;
  }
  return false;
}

export function actionHeaders(authToken?: string): HeadersInit {
  return authToken ? { "x-auth-token": authToken } : {};
}

export function safeSameOriginNavigationTarget(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && !url.pathname.startsWith("//")
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export async function persistStudentReadinessPromptDismissal(authToken?: string): Promise<void> {
  const body = await requestJson("/api/seb/session-readiness/dismiss", {
    method: "POST",
    headers: actionHeaders(authToken)
  });
  if (!body.success) {
    throw clientRequestError(
      typeof body.error_code === "string" ? body.error_code : undefined,
      undefined,
      apiErrorDetail(body.message)
    );
  }
}

export async function requestJson(url: string, init?: RequestInit): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw clientRequestError("NETWORK_ERROR", 0);
  }
  const contentType = response.headers.get("content-type") || "";
  let body: Record<string, any> = {};
  if (contentType.includes("application/json")) {
    try {
      body = (await response.json()) as Record<string, any>;
    } catch {
      body = {};
    }
  }
  if (!response.ok) {
    throw clientRequestError(
      typeof body.error_code === "string" ? body.error_code : undefined,
      response.status,
      response.status < 500 ? apiErrorDetail(body.message) : undefined
    );
  }
  return body;
}

export function errorMessage(error: unknown, fallback: string): string {
  const candidate = error as ClientRequestError | undefined;
  return safeErrorMessage(candidate?.code, candidate?.status, fallback, candidate?.detail);
}

export function apiMessage(body: Record<string, any>, fallback: string): string {
  return safeErrorMessage(
    typeof body.error_code === "string" ? body.error_code : undefined,
    undefined,
    fallback,
    apiErrorDetail(body.message)
  );
}

export function clientRequestError(code?: string, status?: number, detail?: string): ClientRequestError {
  const error = new Error("Safe Online Exam request failed") as ClientRequestError;
  error.code = code;
  error.status = status;
  error.detail = detail;
  error.userFacing = true;
  return error;
}

export function apiErrorDetail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim().slice(0, 500);
  return normalized && !/^internal server error$/iu.test(normalized) ? normalized : undefined;
}

function safeErrorMessage(
  code: string | undefined,
  status: number | undefined,
  fallback: string,
  detail?: string
): string {
  switch (code) {
    case "CANVAS_AUTHORIZATION_REQUIRED":
      return "Canvas needs to be reconnected before this can continue. Reconnect Canvas, then try again.";
    case "CANVAS_PERMISSION_DENIED":
      return "Canvas blocked this action because the integration does not have the required permission. Ask a Canvas administrator to check the Developer Key scopes.";
    case "CANVAS_SESSION_AUTHORIZATION_REQUIRED":
      return "Your Canvas connection has expired. Reconnect Canvas, then try again.";
    case "CANVAS_SESSION_READINESS_FAILED":
      return "Canvas could not confirm this connection right now. Check your connection and try again in a moment.";
    case "INVALID_SEB_CONFIG_PROOF":
    case "SEB_CONFIGURATION_UNAVAILABLE":
      return "This Safe Online Exam configuration is no longer current. Return to Canvas and reopen the quiz from the course tool.";
    case "ASSESSMENT_NOT_FOUND":
    case "ASSESSMENT_SETTING_NOT_FOUND":
      return "That assessment is no longer available. Refresh the course content, then try again.";
    case "SEB_NOT_ENABLED":
      return "Safe Online Exam is not enabled for that assessment. Enable it in the course settings, then try again.";
    case "INVALID_SEB_URL_POLICY":
    case "INVALID_SEB_DOMAIN_POLICY":
    case "INVALID_SEB_TOOL_SELECTION":
      return detail || "One or more website permissions cannot be saved. Check each highlighted URL and try again.";
    case "INVALID_SEB_TOOL_POLICY":
      return (
        detail ||
        "We could not save a tool because its start page or an extra link is not allowed. Check each highlighted URL and try again."
      );
    case "SEB_PASSWORD_POLICY_VIOLATION":
      return (
        detail ||
        "The new password does not meet every listed requirement. Review the password checklist and try again."
      );
    case "SEB_PASSWORD_REUSE":
      return (
        detail ||
        "Start and exit passwords must be different. Use the exit password only when a student needs permission to leave Safe Exam Browser."
      );
    case "SEB_QUIT_PASSWORD_REQUIRED":
      return "Set a valid course or quiz exit password before enabling Safe Online Exam.";
    case "SEB_QUIT_PASSWORD_WEAK":
      return detail || "The saved exit password no longer meets the password policy. Replace it in Course Settings.";
    case "COURSE_TOOL_LIMIT":
      return detail || "This course already has 16 exam tools. Remove one before adding another.";
    case "COURSE_TOOL_COPY_LIMIT":
      return "Choose no more than 100 courses at a time, then copy this tool in another batch.";
    case "COURSE_TOOL_COPY_TARGETS_REQUIRED":
      return "Choose at least one instructor course before duplicating this tool.";
    case "COURSE_TOOL_COPY_SOURCE_SELECTED":
      return "The current course already has this tool. Choose one or more different courses.";
    case "COURSE_TOOL_COPY_TARGET_DENIED":
      return "Canvas could no longer confirm your instructor access to one or more selected courses. Refresh the list and try again.";
    case "COURSE_TOOL_COPY_NOT_ALLOWED":
      return "School-managed exam tools cannot be duplicated from course settings.";
    case "COURSE_TOOL_NOT_FOUND":
      return "This exam tool is no longer saved in the course. Refresh the settings and try again.";
    case "COURSE_RESET_IN_PROGRESS":
      return "A Canvas administrator is resetting this course. Wait for the reset to finish, then reopen Safe Online Exam from Canvas.";
    case "COURSE_UPDATE_IN_PROGRESS":
    case "ASSESSMENT_UPDATE_IN_PROGRESS":
      return detail || "Another course update is still in progress. Wait a moment, refresh the course, and try again.";
    case "COURSE_UPDATE_VERIFY_REQUIRED":
      return detail || "The course update could not be confirmed. Refresh the course and verify its current settings.";
    case "ADMIN_COURSE_RESET_CONFIRMATION_REQUIRED":
      return "Enter the Canvas course ID exactly as shown before starting the reset.";
    case "ADMIN_COURSE_RESET_CANVAS_FAILED":
      return (
        detail ||
        "Canvas could not disable every assessment. Course records were not deleted; refresh the course and retry."
      );
    case "ADMIN_COURSE_RESET_ASSESSMENT_BUSY":
      return (
        detail ||
        "An assessment update is still in progress. Wait for it to finish, refresh the course, and retry the reset."
      );
    case "ADMIN_COURSE_RESET_VERIFY_REQUIRED":
      return (
        detail ||
        "The reset could not be confirmed. It may have completed; refresh the course and verify Canvas assessment access codes before retrying."
      );
    case "NETWORK_ERROR":
      return "We could not reach the Safe Online Exam service. Check your connection and try again.";
    default:
      break;
  }
  if (detail && status === undefined) {
    return detail;
  }
  if (status === 401 || status === 403) {
    return "Your Canvas session cannot complete this action. Reopen the tool from Canvas and try again.";
  }
  if (status === 404) {
    return "The requested item is no longer available. Refresh the page and try again.";
  }
  if (detail && status && status >= 400 && status < 500) {
    return detail;
  }
  if (status === 409 || status === 422) {
    return "This change could not be applied because the current settings need attention. Refresh the page, review the settings, and try again.";
  }
  if (status === 429) {
    return "Too many requests were made in a short time. Wait a moment, then try again.";
  }
  if (status && status >= 500) {
    return "The Safe Online Exam service could not complete that request. Try again in a moment; contact your administrator if it continues.";
  }
  return `${fallback.replace(/\.$/u, "")}. Check your connection and try again.`;
}

export function onboardingRecovery(value: unknown, audience: "instructor" | "student"): OnboardingRecovery | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const code =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.error_code === "string"
        ? candidate.error_code
        : "";
  const authUrl = typeof candidate.authUrl === "string" ? candidate.authUrl : "";
  if (candidate.requiresAuth === true || code === "CANVAS_AUTHORIZATION_REQUIRED") {
    return {
      message: "Canvas needs to be reconnected before this course can be updated.",
      actionLabel: "Reconnect Canvas",
      actionUrl: authUrl || "/api/oauth2reauthorize"
    };
  }
  if (code === "CANVAS_PERMISSION_DENIED") {
    return {
      message:
        "Canvas accepted your connection but blocked this update. A Canvas administrator needs to confirm the Developer Key scopes.",
      actionLabel: "Open setup guide",
      actionUrl: "/setup/guide"
    };
  }
  if (code === "CANVAS_SESSION_AUTHORIZATION_REQUIRED") {
    return audience === "student"
      ? {
          message: "Your Canvas connection needs to be renewed before Safe Online Exam can open this quiz.",
          actionLabel: "Reconnect Canvas",
          actionUrl: "/api/student-session-authorize"
        }
      : null;
  }
  if (code === "CANVAS_SESSION_READINESS_FAILED") {
    return {
      message: "Canvas could not verify the connection right now. Try again, or return to Canvas and reconnect later."
    };
  }
  if (code === "INVALID_SEB_CONFIG_PROOF" || code === "SEB_CONFIGURATION_UNAVAILABLE") {
    return {
      message:
        "This Safe Online Exam configuration is no longer current. Return to Canvas and reopen the quiz from the course tool."
    };
  }
  return null;
}
