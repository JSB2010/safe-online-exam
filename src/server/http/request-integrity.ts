import { diagnostics } from "../diagnostics/runtime.js";
import type { Request } from "express";
import type { AppConfig } from "../config/app-config.js";
import type { VerifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import type { VerifiedAccountAdminPrincipal } from "../security/verified-lti-principal.js";
import { apiError } from "./api-error.js";
import {
  diagnoseActionToken,
  expectedSessionBinding,
  verifyActionToken,
  verifyAdminActionToken,
  verifySebConfigGrantActionToken
} from "./action-token.js";

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
    diagnostics.record("request.integrity", {
      outcome: "failed",
      reasonCode: !sessionId
        ? "SESSION_MISSING"
        : !token
          ? diagnoseActionToken(config, request.header("x-auth-token"))
          : token.sessionBinding !== expectedSessionBinding(config, sessionId)
            ? "SESSION_BINDING_MISMATCH"
            : "TOKEN_IDENTITY_MISMATCH",
      details: { sessionPresent: !!sessionId, tokenPresent: !!request.header("x-auth-token") }
    });
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
    diagnostics.record("request.integrity", {
      outcome: "failed",
      reasonCode: !sessionId
        ? "SESSION_MISSING"
        : !token
          ? diagnoseActionToken(config, request.header("x-auth-token"))
          : token.sessionBinding !== expectedSessionBinding(config, sessionId)
            ? "SESSION_BINDING_MISMATCH"
            : "TOKEN_IDENTITY_MISMATCH",
      details: { sessionPresent: !!sessionId, tokenPresent: !!request.header("x-auth-token") }
    });
    apiError(403, "Invalid or missing SEB launch request token", { error_code: "REQUEST_INTEGRITY_FAILED" });
  }
  requireSameOriginRequest(request, config, "SEB launch");
}

export function requireAdminManagementRequestIntegrity(
  request: Request,
  config: AppConfig,
  principal: VerifiedAccountAdminPrincipal
): void {
  const token = verifyAdminActionToken(config, request.header("x-auth-token"));
  const sessionId = request.sessionID;
  if (
    !token ||
    !sessionId ||
    token.userId !== principal.canvasUserId ||
    token.rootAccountId !== principal.rootAccountId ||
    token.subject !== principal.subject ||
    token.deploymentId !== principal.deploymentId ||
    token.sessionBinding !== expectedSessionBinding(config, sessionId)
  ) {
    diagnostics.record("request.integrity", {
      outcome: "failed",
      reasonCode: !sessionId
        ? "SESSION_MISSING"
        : !token
          ? diagnoseActionToken(config, request.header("x-auth-token"))
          : token.sessionBinding !== expectedSessionBinding(config, sessionId)
            ? "SESSION_BINDING_MISMATCH"
            : "TOKEN_IDENTITY_MISMATCH",
      details: { sessionPresent: !!sessionId, tokenPresent: !!request.header("x-auth-token") }
    });
    apiError(403, "Invalid or missing administrator request token", { error_code: "REQUEST_INTEGRITY_FAILED" });
  }
  requireSameOriginRequest(request, config, "administrator management");
}

export function requireSameOriginRequest(request: Request, config: AppConfig, label: string): void {
  const toolOrigin = parseOrigin(config.getRequiredToolUrl());
  const originHeader = request.header("origin");
  const refererHeader = request.header("referer");
  const fetchSite = request.header("sec-fetch-site")?.toLowerCase();
  if (originHeader && parseOrigin(originHeader) !== toolOrigin) {
    diagnostics.record("request.origin", { outcome: "failed", reasonCode: "ORIGIN_MISMATCH" });
    apiError(403, `Cross-origin ${label} request rejected`, { error_code: "REQUEST_ORIGIN_REJECTED" });
  }
  if (!originHeader && refererHeader && parseOrigin(refererHeader) !== toolOrigin) {
    diagnostics.record("request.origin", { outcome: "failed", reasonCode: "ORIGIN_MISMATCH" });
    apiError(403, `Cross-origin ${label} request rejected`, { error_code: "REQUEST_ORIGIN_REJECTED" });
  }
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    diagnostics.record("request.origin", { outcome: "failed", reasonCode: "FETCH_SITE_REJECTED" });
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
