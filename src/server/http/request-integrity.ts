import type { Request } from "express";
import type { AppConfig } from "../config/app-config.js";
import type { VerifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import { apiError } from "./api-error.js";
import { expectedSessionBinding, verifyActionToken, verifySebConfigGrantActionToken } from "./action-token.js";

export function requireManagementRequestIntegrity(
  request: Request,
  config: AppConfig,
  principal: VerifiedLtiPrincipal
): void {
  const token = verifyActionToken(config, request.header("x-auth-token"));
  const sessionId = request.sessionID;
  if (
    !token ||
    !sessionId ||
    token.userId !== principal.canvasUserId ||
    token.courseId !== principal.courseId ||
    token.subject !== principal.subject ||
    token.deploymentId !== principal.deploymentId ||
    token.sessionBinding !== expectedSessionBinding(config, sessionId)
  ) {
    apiError(403, "Invalid or missing management request token", { error_code: "REQUEST_INTEGRITY_FAILED" });
  }

  requireSameOriginRequest(request, config, "management");
}

export function requireSebConfigGrantRequestIntegrity(
  request: Request,
  config: AppConfig,
  principal: VerifiedLtiPrincipal
): void {
  const token = verifySebConfigGrantActionToken(config, request.header("x-auth-token"));
  const sessionId = request.sessionID;
  if (
    !token ||
    !sessionId ||
    token.userId !== principal.canvasUserId ||
    token.courseId !== principal.courseId ||
    token.subject !== principal.subject ||
    token.deploymentId !== principal.deploymentId ||
    token.sessionBinding !== expectedSessionBinding(config, sessionId)
  ) {
    apiError(403, "Invalid or missing SEB launch request token", { error_code: "REQUEST_INTEGRITY_FAILED" });
  }
  requireSameOriginRequest(request, config, "SEB launch");
}

export function requireSameOriginRequest(request: Request, config: AppConfig, label: string): void {
  const toolOrigin = parseOrigin(config.getRequiredToolUrl());
  const originHeader = request.header("origin");
  const refererHeader = request.header("referer");
  const fetchSite = request.header("sec-fetch-site")?.toLowerCase();
  if (originHeader && parseOrigin(originHeader) !== toolOrigin) {
    apiError(403, `Cross-origin ${label} request rejected`, { error_code: "REQUEST_ORIGIN_REJECTED" });
  }
  if (!originHeader && refererHeader && parseOrigin(refererHeader) !== toolOrigin) {
    apiError(403, `Cross-origin ${label} request rejected`, { error_code: "REQUEST_ORIGIN_REJECTED" });
  }
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    apiError(403, `Cross-site ${label} request rejected`, { error_code: "REQUEST_ORIGIN_REJECTED" });
  }
}

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
