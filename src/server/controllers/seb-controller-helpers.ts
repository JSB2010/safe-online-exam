import { createHash } from "node:crypto";
import type { Request } from "express";
import type { ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import {
  allowlistEntriesForExternalTools,
  extractClassicQuizId,
  parseNewQuizContentId,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { escapeHtml } from "../http/app-shell.js";
import { isVerifiedInstructor, isVerifiedStudent } from "../security/verified-lti-principal.js";
import type { VerifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import { canonicalSebConfigContentId } from "../services/seb-config-grant.service.js";

export function resolveClassicCanvasUrl(
  config: AppConfig,
  courseId: string,
  quizId: string,
  _canvasUrl?: string,
  _storedUrl?: string | null
): string {
  return `${config.getCanvasDomain()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}/take`;
}

export function canonicalCanvasAssignmentUrl(
  config: AppConfig,
  courseId: string,
  assignmentId: string,
  value: string
): string | null {
  const url = new URL(value);
  const assignmentMatch = url.pathname.match(/^\/courses\/([^/]+)\/assignments\/([^/?#]+)(?:\/.*)?$/u);
  if (
    !assignmentMatch ||
    decodeUrlSegment(assignmentMatch[1]) !== courseId ||
    decodeUrlSegment(assignmentMatch[2]) !== assignmentId
  ) {
    return null;
  }
  return canvasAssignmentUrl(config, courseId, assignmentId);
}

export function canvasAssignmentUrl(config: AppConfig, courseId: string, assignmentId: string): string {
  return `${config.getCanvasDomain()}/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}`;
}

function decodeUrlSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function isConfiguredCanvasUrl(config: AppConfig, value: string): boolean {
  try {
    const candidate = new URL(value);
    const canvas = new URL(config.getCanvasDomain());
    return (
      candidate.protocol === "https:" &&
      !candidate.username &&
      !candidate.password &&
      candidate.origin.toLowerCase() === canvas.origin.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function allowedDomains(setting: QuizSebSetting | ContentSebSetting): string[] {
  const customEntries = urlRulesToAllowedEntries(setting.urlRules);
  return Array.from(
    new Set([
      // Legacy SSO entries are intentionally excluded. Student Canvas session
      // handoff starts the assessment without granting the identity provider
      // access inside the locked SEB session.
      ...(setting.educationalToolDomains || []),
      ...customEntries,
      ...allowlistEntriesForExternalTools(setting.externalTools)
    ])
  );
}

export function renderYouTubeToolPage(playerUrl: string): string {
  const src = escapeHtml(playerUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <title>YouTube video</title>
    <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#000}iframe{display:block}</style>
  </head>
  <body>
    <iframe title="YouTube video" src="${src}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
  </body>
</html>`;
}

export function proofGenerationDigest(
  courseId: string,
  contentId: string,
  configKey: string,
  accessCode: string
): string {
  return createHash("sha256")
    .update(`seb-proof-v2\0${courseId}\0${contentId}\0${configKey}\0${accessCode}`, "utf8")
    .digest("base64url");
}

export function firstHeader(request: Request, names: string[]): string | undefined {
  for (const name of names) {
    const value = request.header(name);
    if (value) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

export function isExpectedQuizUrl(config: AppConfig, value: string, courseId: string, quizId: string): boolean {
  try {
    if (!isConfiguredCanvasUrl(config, value)) {
      return false;
    }
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/u, "");
    if (quizId.startsWith("newquiz:")) {
      const parsed = parseNewQuizContentId(quizId);
      return !!parsed && matchesPathFamily(path, `/courses/${courseId}/assignments/${parsed.assignmentId}`);
    }
    return matchesPathFamily(path, `/courses/${courseId}/quizzes/${quizId}`);
  } catch {
    return false;
  }
}

function matchesPathFamily(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function isExpectedSetupCheckUrl(config: AppConfig, value: string): boolean {
  try {
    const configuredBaseUrl = config.getApplicationBaseUrl() || config.toolUrl;
    if (!configuredBaseUrl) {
      return false;
    }
    const url = new URL(value);
    const expectedBaseUrl = new URL(configuredBaseUrl);
    return (
      url.protocol === expectedBaseUrl.protocol &&
      url.host.toLowerCase() === expectedBaseUrl.host.toLowerCase() &&
      url.pathname.replace(/\/+$/u, "") === "/seb/check"
    );
  } catch {
    return false;
  }
}

export function sanitizeFileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

export function sebConfigPath(courseId: string, contentId: string, grant: string): string {
  const params = new URLSearchParams();
  params.set("grant", grant);
  return `/seb/config/${encodeURIComponent(courseId)}/${encodeURIComponent(contentId)}.seb?${params.toString()}`;
}

export function configGrantEndpoint(courseId: string, contentId: string): string {
  return `/api/seb/config-grant/${encodeURIComponent(courseId)}/${encodeURIComponent(contentId)}`;
}

export function browserLaunchHandoffPath(token: string): string {
  return `/seb/launch-handoff?key=${encodeURIComponent(token)}`;
}

export function normalizedPublicSebContentId(contentId: string | undefined | null): string | null {
  const canonicalContentId = canonicalSebConfigContentId(contentId);
  if (!canonicalContentId) {
    return null;
  }
  if (parseNewQuizContentId(canonicalContentId)) {
    return canonicalContentId;
  }
  return extractClassicQuizId(canonicalContentId);
}

export function requiresStudentSessionHandoff(principal: VerifiedLtiPrincipal): boolean {
  return isVerifiedStudent(principal) && !isVerifiedInstructor(principal);
}

export function isSafeConfigNavigation(request: Request): boolean {
  const fetchSite = request.header("sec-fetch-site")?.toLowerCase();
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export function consumePendingSebLaunch(
  request: Request,
  principal: VerifiedLtiPrincipal,
  courseId: string,
  contentId: string
): boolean {
  const pending = request.session?.pendingSebLaunch;
  if (request.session) {
    delete request.session.pendingSebLaunch;
  }
  return (
    !!pending &&
    Date.now() - pending.issuedAt >= 0 &&
    Date.now() - pending.issuedAt <= 120_000 &&
    pending.courseId === courseId &&
    pending.contentId === contentId &&
    pending.subject === principal.subject &&
    pending.deploymentId === principal.deploymentId
  );
}

export function isDirectLtiLaunchReplay(
  request: Request,
  config: AppConfig,
  courseId: string,
  contentId: string
): boolean {
  const completed = request.session?.completedSebLaunch;
  if (
    !completed ||
    completed.courseId !== courseId ||
    completed.contentId !== contentId ||
    Date.now() - completed.issuedAt < 0 ||
    Date.now() - completed.issuedAt > 86_400_000
  ) {
    return false;
  }
  const targetLinkUri = request.session?.launchData?.targetLinkUri;
  try {
    const target = new URL(targetLinkUri || "");
    const tool = new URL(config.getRequiredToolUrl());
    if (target.origin !== tool.origin || target.search || target.hash) {
      return false;
    }
    const match = target.pathname.match(/^\/seb\/launch\/([^/]{1,300})$/u);
    return !!match && canonicalSebConfigContentId(decodeURIComponent(match[1])) === contentId;
  } catch {
    return false;
  }
}
