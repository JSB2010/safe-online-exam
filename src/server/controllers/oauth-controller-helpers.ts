import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES, CANVAS_REQUIRED_OAUTH_SCOPES } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { isVerifiedAccountAdmin, verifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import { canonicalSebConfigContentId } from "../services/seb-config-grant.service.js";

export function directSebContentId(targetLinkUri: string | null | undefined, toolUrl: string): string | null {
  if (!targetLinkUri) {
    return null;
  }
  try {
    const target = new URL(targetLinkUri);
    const tool = new URL(toolUrl);
    if (target.origin !== tool.origin) {
      return null;
    }
    const match = /^\/seb\/launch\/([^/]+)$/u.exec(target.pathname);
    if (!match) {
      return null;
    }
    const contentId = decodeURIComponent(match[1]);
    return canonicalSebConfigContentId(contentId) ? contentId : null;
  } catch {
    return null;
  }
}

export class OAuthExchangeResponseError extends Error {
  constructor(readonly status: number) {
    super("Canvas OAuth token endpoint rejected the request");
  }
}

export function parseOAuthTokenResponse(text: string): {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  user?: { id?: string | number };
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid Canvas OAuth token response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Canvas OAuth token response");
  }
  const record = value as Record<string, unknown>;
  const accessToken = boundedString(record.access_token, 16_384);
  const refreshToken = optionalBoundedString(record.refresh_token, 16_384);
  const scope = optionalBoundedString(record.scope, 16_384);
  const expiresIn = record.expires_in;
  const user = record.user;
  if (
    !accessToken ||
    refreshToken === null ||
    scope === null ||
    (expiresIn !== undefined && (!Number.isSafeInteger(expiresIn) || Number(expiresIn) < 0)) ||
    (user !== undefined && (!user || typeof user !== "object" || Array.isArray(user)))
  ) {
    throw new Error("Invalid Canvas OAuth token response");
  }
  const userRecord = user === undefined ? undefined : (user as Record<string, unknown>);
  const userId = userRecord?.id;
  const userName = userRecord === undefined ? undefined : optionalBoundedString(userRecord.name, 512);
  if ((userId !== undefined && typeof userId !== "string" && typeof userId !== "number") || userName === null) {
    throw new Error("Invalid Canvas OAuth token response");
  }
  return {
    access_token: accessToken,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(scope === undefined ? {} : { scope }),
    ...(expiresIn === undefined ? {} : { expires_in: Number(expiresIn) }),
    ...(user === undefined
      ? {}
      : {
          user: {
            id: userId as string | number | undefined,
            ...(userName === undefined ? {} : { name: userName })
          }
        })
  };
}

export function identityForVerifiedLaunch(
  request: Request,
  principal: NonNullable<ReturnType<typeof verifiedLtiPrincipal>>,
  oauthDisplayName?: string
): { displayName?: string; email?: string } {
  const launchData = request.session?.launchData;
  if (
    !launchData ||
    launchData.canvasUserId !== principal.canvasUserId ||
    launchData.ltiSubject !== principal.subject ||
    launchData.courseId !== principal.courseId ||
    launchData.issuer !== principal.issuer ||
    launchData.deploymentId !== principal.deploymentId
  ) {
    return oauthDisplayName ? { displayName: oauthDisplayName } : {};
  }
  return {
    ...(oauthDisplayName || launchData.fullName ? { displayName: oauthDisplayName || launchData.fullName! } : {}),
    ...(launchData.email ? { email: launchData.email } : {})
  };
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function optionalBoundedString(value: unknown, maxLength: number): string | null | undefined {
  return value === undefined ? undefined : boundedString(value, maxLength);
}

export function safeLocalRedirect(value?: string): string {
  try {
    const url = new URL(value || "/lti/launch", "https://placeholder.invalid");
    if (url.origin !== "https://placeholder.invalid" || !url.pathname.startsWith("/")) {
      return "/lti/launch";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/lti/launch";
  }
}

export function rejectNonSameOriginAuthorizationStart(request: Request, response: Response): boolean {
  const fetchSite = request.header?.("sec-fetch-site")?.trim().toLowerCase();
  if (!fetchSite || fetchSite === "same-origin") {
    return false;
  }
  response.status(403).send("Open Canvas authorization from the Safe Online Exam tool.");
  return true;
}

export function canvasReturnUrl(
  config: AppConfig,
  principal: NonNullable<ReturnType<typeof verifiedLtiPrincipal>>
): string {
  const url = new URL(config.getCanvasDomain());
  url.pathname = isVerifiedAccountAdmin(principal)
    ? `/accounts/${encodeURIComponent(principal.accountId)}`
    : `/courses/${encodeURIComponent(principal.courseId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function oauthSessionBinding(sessionId: string): string {
  return createHash("sha256").update(`canvas-oauth-session:${sessionId}`, "utf8").digest("base64url");
}

export function canvasScopes(): string[] {
  return [...CANVAS_REQUIRED_OAUTH_SCOPES];
}

export function studentSessionScopes(): string[] {
  return canvasScopes();
}

export function adminScopes(): string[] {
  return [...CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES, ...canvasScopes()];
}

export function scopesForPurpose(purpose: string): string[] {
  return purpose === "canvas-admin-oauth-v1" ? adminScopes() : canvasScopes();
}

export function hasAdminScopeProfile(scopes: readonly string[]): boolean {
  return CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES.every((scope) => scopes.includes(scope));
}
