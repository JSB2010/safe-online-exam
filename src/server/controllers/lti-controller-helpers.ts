import type { Request } from "express";
import type { ContentItem, LtiLaunchData, Quiz } from "../../shared/models.js";
import { escapeHtml, renderFallbackHtml } from "../http/app-shell.js";
import { canonicalSebConfigContentId } from "../services/seb-config-grant.service.js";

export function describeLtiLaunchFailure(error: unknown): { logMessage: string; title: string; html: string } {
  const message = error instanceof Error ? error.message : "";
  if (/RS256 requires key modulusLength to be 2048 bits or larger/i.test(message)) {
    return {
      logMessage: "platform signing key modulus is below 2048 bits",
      title: "Canvas Signing-Key Error",
      html: "<h1>Canvas Signing-Key Error</h1><p>Canvas signed this launch with an RSA key smaller than 2048 bits, so the tool rejected it.</p><p>A Canvas administrator must rotate the platform LTI signing keys, restart Canvas's web service, and reopen the tool to issue a fresh launch. Do not lower the tool's signature-verification requirements.</p>"
    };
  }
  if (/LTI launch browser binding does not match the initiating login/i.test(message)) {
    return {
      logMessage: "browser transaction cookie was absent or did not match",
      title: "Canvas Launch Cookie Blocked",
      html: "<h1>Canvas Launch Cookie Blocked</h1><p>The browser did not return the short-lived security cookie created when Canvas opened this tool.</p><p>Allow third-party cookies for Canvas and this tool, then reopen it from Canvas. If the browser offers an option to open the tool in a new window, that also avoids third-party cookie blocking.</p>"
    };
  }
  if (/Validated root-account launch is missing signed numeric account identifiers/i.test(message)) {
    return {
      logMessage: "root-account launch is missing signed numeric account identifiers",
      title: "Canvas Administrator Launch Configuration Error",
      html: "<h1>Canvas Administrator Launch Configuration Error</h1><p>Canvas did not provide the signed account identifiers required by the administrator dashboard.</p><p>Refresh the LTI Developer Key from this service's current <code>/lti/config</code>, confirm the app is installed at the root account, and reopen the tool.</p>"
    };
  }
  if (/Validated root-account launch does not identify a Canvas root-account administrator/i.test(message)) {
    return {
      logMessage: "root-account administrator flag is absent or false",
      title: "Canvas Root Administrator Required",
      html: "<h1>Canvas Root Administrator Required</h1><p>This launch was not signed by Canvas as a root-account administrator.</p><p>Sign in directly as an administrator assigned at the root account. Do not launch while masquerading as another user or from a subaccount administrator account.</p>"
    };
  }
  if (/Validated root-account launch is missing a signed Canvas administrator role/i.test(message)) {
    return {
      logMessage: "root-account launch is missing a signed administrator role",
      title: "Canvas Administrator Role Required",
      html: "<h1>Canvas Administrator Role Required</h1><p>Canvas marked this user as a root-account administrator but did not include a standard signed administrator role in the LTI launch.</p><p>Confirm the user is assigned an administrator role in the root account and reopen the tool.</p>"
    };
  }
  if (/Validated course launch is missing required course context/i.test(message)) {
    return {
      logMessage: "launch placement is missing course or administrator context",
      title: "Canvas LTI Placement Configuration Error",
      html: "<h1>Canvas LTI Placement Configuration Error</h1><p>The launch did not include the context fields required for its Canvas placement.</p><p>Refresh the LTI Developer Key from this service's current <code>/lti/config</code>, then reinstall or refresh the root-account app registration.</p>"
    };
  }
  return {
    logMessage: "token verification failed",
    title: "Invalid LTI Launch",
    html: "<h1>Invalid LTI Launch</h1><p>The signed Canvas launch could not be verified. Reopen the tool from Canvas.</p><p>If this continues, ask a Canvas administrator to check the tool registration, deployment ID, issuer, and platform signing keys.</p>"
  };
}

export function storeLaunchData(request: Request, launchData: LtiLaunchData): void {
  request.session!.launchData = launchData;
  request.session!.ltiLaunchData = launchData;
  const canvasUserId = launchData.canvasUserId || launchData.custom?.canvas_user_id || launchData.userId;
  request.session!.canvas_user_id = canvasUserId;
  request.session!.userId = canvasUserId;
  request.session!.user_id = canvasUserId;
  if (launchData.courseId) {
    request.session!.canvas_course_id = launchData.courseId;
    request.session!.courseId = launchData.courseId;
  }
}

export function sebLaunchContentIdFromTargetLinkUri(
  targetLinkUri: string | null | undefined,
  toolUrl: string
): string | null {
  try {
    const target = new URL(targetLinkUri || "");
    const tool = new URL(toolUrl);
    if (target.origin !== tool.origin || target.search || target.hash) {
      return null;
    }
    const match = target.pathname.match(/^\/seb\/launch\/([^/]{1,300})$/u);
    if (!match) {
      return null;
    }
    return canonicalSebConfigContentId(decodeURIComponent(match[1])) || null;
  } catch {
    return null;
  }
}

export function isAllowedTargetLinkUri(targetLinkUri: string, toolUrl: string): boolean {
  try {
    const target = new URL(targetLinkUri);
    const tool = new URL(toolUrl);
    return (
      target.origin === tool.origin &&
      (target.pathname === "/lti/launch" || /^\/seb\/launch\/[a-z0-9:_-]{1,300}$/iu.test(target.pathname))
    );
  } catch {
    return false;
  }
}

export function renderDeploymentConfigurationError(): string {
  return renderFallbackHtml(
    "LTI Deployment Configuration Required",
    [
      "<h1>LTI Deployment Configuration Required</h1>",
      "<p>Canvas launched this tool with a deployment ID that this service does not yet allow.</p>",
      "<p>This usually means the tool was installed in another Canvas course or account after the service was configured.</p>",
      "<h2>For the Canvas and service administrator</h2>",
      "<ol>",
      "<li>Find the installed external app's Canvas <code>deployment_id</code>. The Canvas External Tools API returns it for the course or account app.</li>",
      "<li>Add that ID to the service's <code>LTI_DEPLOYMENT_ID</code> allowlist without removing existing IDs.</li>",
      "<li>Deploy a new service revision, then reopen this tool from Canvas.</li>",
      "</ol>",
      "<p>For a deliberate self-service rollout, an administrator may instead set <code>LTI_DEPLOYMENT_ID_CHECKING_ENABLED=false</code>. That accepts any signed deployment from this configured Canvas issuer and client ID.</p>"
    ].join("")
  );
}

export function hasBoundedLtiLoginEnvelope(params: Record<string, string>): boolean {
  return (
    hasBoundedString(params.iss, 2_048) &&
    hasBoundedString(params.login_hint, 4_096) &&
    hasBoundedString(params.target_link_uri, 2_048) &&
    (!params.client_id || hasBoundedString(params.client_id, 512)) &&
    (!params.lti_deployment_id || hasBoundedString(params.lti_deployment_id, 512)) &&
    (!params.lti_message_hint || hasBoundedString(params.lti_message_hint, 8_192))
  );
}

function hasBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

export function isCrossSiteIframeNavigation(request: Request): boolean {
  const destination = request.header?.("sec-fetch-dest")?.trim().toLowerCase();
  const site = request.header?.("sec-fetch-site")?.trim().toLowerCase();
  return destination === "iframe" && site === "cross-site";
}

export function sessionValue<T>(request: Request, key: string): T | undefined {
  return (request.session as unknown as Record<string, unknown> | undefined)?.[key] as T | undefined;
}

export function quizView(quiz: Quiz): Record<string, unknown> {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    canvasQuizId: quiz.canvasQuizId,
    title: quiz.title,
    description: quiz.description,
    htmlUrl: quiz.htmlUrl,
    updatedAt: quiz.updatedAt,
    contentType: "CLASSIC_QUIZ",
    quizTypeDisplay: quiz.quizTypeDisplay || "Classic Quiz"
  };
}

export function contentView(item: ContentItem): Record<string, unknown> {
  return {
    id: item.id,
    courseId: item.courseId,
    canvasQuizId: item.canvasId,
    assignmentId: item.assignmentId,
    title: item.title,
    description: item.description,
    htmlUrl: item.htmlUrl,
    contentType: item.contentType,
    quizTypeDisplay: item.quizTypeDisplay || (item.contentType === "NEW_QUIZ" ? "New Quiz" : item.contentType)
  };
}

export function renderCanvasContentError(courseId: string, error: { status: number }): string {
  return renderFallbackHtml(
    "Canvas Content Unavailable",
    `<h1>Canvas Content Unavailable</h1><p>Canvas could not load course content for course <strong>${escapeHtml(courseId)}</strong>.</p><p>Canvas returned status ${error.status}. Verify the Developer Key scopes and try again.</p>`
  );
}
