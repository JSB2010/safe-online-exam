import { createHash } from "node:crypto";
import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES,
  CANVAS_OAUTH_SCOPE_VERSION,
  CANVAS_REQUIRED_OAUTH_SCOPES
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { renderAppShell } from "../http/app-shell.js";
import { discardResponseBody, readBoundedUtf8Response } from "../http/bounded-response.js";
import { isUpstreamRequestTimeout, withUpstreamDeadline } from "../http/upstream-deadline.js";
import {
  isCanvasRestUserId,
  isVerifiedAccountAdmin,
  isVerifiedInstructor,
  isVerifiedStudent,
  verifiedLtiPrincipal
} from "../security/verified-lti-principal.js";
import { CanvasApiService } from "../services/canvas-api.service.js";
import { LtiStateService } from "../services/lti-state.service.js";
import { canonicalSebConfigContentId } from "../services/seb-config-grant.service.js";

const OAUTH_TOKEN_RESPONSE_MAX_BYTES = 64 * 1024;

@Controller("/api")
export class OAuthController {
  constructor(
    private readonly config: AppConfig,
    private readonly canvasApi: CanvasApiService,
    private readonly ltiState: LtiStateService
  ) {}

  @Get("/oauth2reauthorize")
  async reauthorize(
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: Record<string, string>
  ): Promise<void> {
    await this.authorize(request, response, query);
  }

  @Get("/oauth2authorize")
  async authorize(
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: Record<string, string>
  ): Promise<void> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal) {
      response.status(401).send("A validated Canvas launch is required");
      return;
    }
    if (!isVerifiedInstructor(principal)) {
      response.status(403).send("Instructor access is required");
      return;
    }
    if (!request.sessionID) {
      response.status(401).send("A validated Canvas session is required");
      return;
    }
    const userId = principal.canvasUserId;
    const courseId = principal.courseId;
    if (
      !isCanvasRestUserId(userId) ||
      (query.user_id && query.user_id !== userId) ||
      (query.course_id && query.course_id !== courseId)
    ) {
      response.status(403).send("OAuth identity does not match the validated Canvas launch");
      return;
    }
    await this.beginAuthorization(
      request,
      response,
      principal,
      "canvas-oauth-v2",
      await this.scopesForUser(principal.canvasUserId, canvasScopes()),
      query.redirect_url
    );
  }

  @Get("/student-session-authorize")
  async studentSessionAuthorize(@Req() request: Request, @Res() response: Response): Promise<void> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal) {
      response.status(401).send("A validated Canvas launch is required");
      return;
    }
    const studentPrincipal = principal;
    if (!isVerifiedStudent(principal) || isVerifiedInstructor(principal)) {
      response.status(403).send("Student access is required");
      return;
    }
    if (!request.sessionID) {
      response.status(401).send("A validated Canvas session is required");
      return;
    }
    await this.beginAuthorization(
      request,
      response,
      studentPrincipal,
      "canvas-student-session-oauth-v1",
      await this.scopesForUser(studentPrincipal.canvasUserId, studentSessionScopes()),
      this.studentReturnUrl(request, studentPrincipal)
    );
  }

  @Get("/admin/oauth2authorize")
  async adminAuthorize(@Req() request: Request, @Res() response: Response): Promise<void> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal) {
      response.status(401).send("A validated Canvas launch is required");
      return;
    }
    if (!isVerifiedAccountAdmin(principal)) {
      response.status(403).send("Root-account administrator access is required");
      return;
    }
    if (!request.sessionID) {
      response.status(401).send("A validated Canvas session is required");
      return;
    }
    await this.beginAuthorization(
      request,
      response,
      principal,
      "canvas-admin-oauth-v1",
      adminScopes(),
      "/lti/launch?connected=1"
    );
  }

  @Get("/oauth2callback")
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: Record<string, string>
  ): Promise<void> {
    if (query.error) {
      response.send(
        renderAppShell({
          title: "Canvas Authorization Error",
          view: "oauth-error",
          initialData: { error: query.error, description: query.error_description }
        })
      );
      return;
    }
    try {
      const state = this.ltiState.peekState(query.state);
      const principal = verifiedLtiPrincipal(request);
      if (!principal) {
        throw new Error("OAuth callback does not match the initiating Canvas session");
      }
      const expectedRole =
        state.purpose === "canvas-oauth-v2"
          ? isVerifiedInstructor(principal)
          : state.purpose === "canvas-student-session-oauth-v1"
            ? isVerifiedStudent(principal) && !isVerifiedInstructor(principal)
            : state.purpose === "canvas-admin-oauth-v1"
              ? isVerifiedAccountAdmin(principal)
              : false;
      if (
        !expectedRole ||
        !request.sessionID ||
        state.sessionBinding !== oauthSessionBinding(request.sessionID) ||
        state.canvasUserId !== principal.canvasUserId ||
        state.ltiSubject !== principal.subject ||
        state.courseId !== principal.courseId ||
        (state.purpose === "canvas-admin-oauth-v1" && state.accountId !== principal.accountId) ||
        state.issuer !== principal.issuer ||
        state.deploymentId !== principal.deploymentId
      ) {
        throw new Error("OAuth callback does not match the initiating Canvas session");
      }
      await this.ltiState.claimState(query.state);
      const token = await this.exchangeCode(query.code, this.oauthRedirectUri());
      const tokenOwner = token.user?.id === undefined ? "" : String(token.user.id);
      if (!tokenOwner || tokenOwner !== principal.canvasUserId) {
        throw new Error("Canvas OAuth token owner does not match the validated LTI user");
      }
      const requestedScopes = state.oauthScopeProfile === "admin" ? adminScopes() : scopesForPurpose(state.purpose);
      const grantType = hasAdminScopeProfile(requestedScopes) ? "account_admin" : "instructor";
      await this.canvasApi.storeAccessToken(tokenOwner, token.access_token, {
        ...(grantType === "account_admin" ? { grantType } : {}),
        refreshToken: token.refresh_token || null,
        scope: token.scope || null,
        requestedScopes,
        oauthScopeVersion: CANVAS_OAUTH_SCOPE_VERSION,
        expiresIn: token.expires_in,
        ...identityForVerifiedLaunch(request, principal, token.user?.name)
      });
      if (state.purpose === "canvas-student-session-oauth-v1") {
        response.send(
          renderAppShell({
            title: "Canvas Connected",
            view: "student-session-connected",
            initialData: { returnUrl: safeLocalRedirect(state.redirectUrl) }
          })
        );
        return;
      }
      const redirectUrl = safeLocalRedirect(state.redirectUrl);
      if (isLtiLaunchRedirect(redirectUrl)) {
        request.session!.oauthCallbackResume = {
          canvasUserId: principal.canvasUserId,
          ltiSubject: principal.subject,
          courseId: principal.courseId,
          issuer: principal.issuer,
          deploymentId: principal.deploymentId,
          path: "/lti/launch",
          issuedAt: Date.now()
        };
        await saveSession(request);
      }
      response.redirect(redirectUrl);
    } catch {
      response.status(400).send(
        renderAppShell({
          title: "Canvas Authorization Error",
          view: "oauth-error",
          initialData: { error: "Canvas authorization could not be verified. Return to Canvas and try again." }
        })
      );
    }
  }

  @Get("/oauth2status")
  async status(@Req() request: Request, @Query("user_id") userId?: string): Promise<Record<string, unknown>> {
    const principal = verifiedLtiPrincipal(request);
    if (!principal || !isVerifiedInstructor(principal)) {
      return { authorized: false };
    }
    if (userId && userId !== principal.canvasUserId) {
      return { authorized: false };
    }
    return {
      authorized: await this.canvasApi.hasAccessToken(principal.canvasUserId)
    };
  }

  private oauthRedirectUri(): string {
    return this.config.value.canvas.redirectUri || `${this.config.getRequiredToolUrl()}/api/oauth2callback`;
  }

  /**
   * The return location is derived only from the signed LTI launch saved in
   * this browser session. It deliberately ignores query-string return URLs so
   * a student OAuth flow cannot be turned into an open redirect or used to
   * switch courses after consent.
   */
  private studentReturnUrl(request: Request, principal: NonNullable<ReturnType<typeof verifiedLtiPrincipal>>): string {
    const launchData = request.session?.launchData;
    if (launchData?.courseId !== principal.courseId || launchData.deploymentId !== principal.deploymentId) {
      return "/lti/launch?connected=1";
    }
    const targetLinkUri = launchData.targetLinkUri;
    const contentId = directSebContentId(targetLinkUri, this.config.getRequiredToolUrl());
    if (contentId) {
      return `/seb/launch/${encodeURIComponent(contentId)}?connected=1`;
    }
    return `/lti/launch?connected=1`;
  }

  private async beginAuthorization(
    request: Request,
    response: Response,
    principal: NonNullable<ReturnType<typeof verifiedLtiPrincipal>>,
    purpose: "canvas-oauth-v2" | "canvas-student-session-oauth-v1" | "canvas-admin-oauth-v1",
    scopes: string[],
    redirectUrl?: string
  ): Promise<void> {
    const clientId = this.config.value.canvas.oauthClientId;
    if (!clientId || !request.sessionID) {
      response.status(500).send("Canvas API OAuth client id is not configured");
      return;
    }
    const redirectUri = this.oauthRedirectUri();
    const state = await this.ltiState.createState({
      purpose,
      canvasUserId: principal.canvasUserId,
      ltiSubject: principal.subject,
      courseId: principal.courseId,
      ...(principal.contextType === "account" ? { accountId: principal.accountId } : {}),
      issuer: principal.issuer,
      deploymentId: principal.deploymentId,
      sessionBinding: oauthSessionBinding(request.sessionID),
      oauthScopeProfile: hasAdminScopeProfile(scopes) ? "admin" : "application",
      redirectUrl: safeLocalRedirect(redirectUrl)
    });
    const authUrl = new URL(`${this.config.getCanvasDomain()}/login/oauth2/auth`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", scopes.join(" "));
    response.redirect(authUrl.toString());
  }

  private async scopesForUser(userId: string, defaultScopes: string[]): Promise<string[]> {
    return (await this.canvasApi.hasAdminScopeGrant(userId)) ? adminScopes() : defaultScopes;
  }

  private async exchangeCode(
    code: string | undefined,
    redirectUri: string
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
    user?: { id?: string | number; name?: string };
  }> {
    if (!code) {
      throw new Error("Missing OAuth code");
    }
    const clientId = this.config.value.canvas.oauthClientId;
    const clientSecret = this.config.value.canvas.oauthClientSecret;
    if (!clientId || !clientSecret) {
      throw new Error("Canvas API OAuth client credentials are not configured");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code
    });
    try {
      return await withUpstreamDeadline(async (signal) => {
        const response = await fetch(`${this.config.getCanvasDomain()}/login/oauth2/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal
        });
        if (!response.ok) {
          await discardResponseBody(response);
          throw new OAuthExchangeResponseError(response.status);
        }
        const text = await readBoundedUtf8Response(response, OAUTH_TOKEN_RESPONSE_MAX_BYTES);
        return parseOAuthTokenResponse(text);
      });
    } catch (error) {
      if (isUpstreamRequestTimeout(error)) {
        throw new Error("Canvas OAuth token exchange timed out", { cause: error });
      }
      if (error instanceof OAuthExchangeResponseError) {
        throw new Error(`Canvas OAuth token exchange failed: ${error.status}`, {
          cause: error
        });
      }
      throw new Error("Canvas OAuth token exchange failed", { cause: error });
    }
  }
}

function directSebContentId(targetLinkUri: string | null | undefined, toolUrl: string): string | null {
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

class OAuthExchangeResponseError extends Error {
  constructor(readonly status: number) {
    super("Canvas OAuth token endpoint rejected the request");
  }
}

function parseOAuthTokenResponse(text: string): {
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

function identityForVerifiedLaunch(
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

function safeLocalRedirect(value?: string): string {
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

function isLtiLaunchRedirect(value: string): boolean {
  try {
    return new URL(value, "https://placeholder.invalid").pathname === "/lti/launch";
  } catch {
    return false;
  }
}

async function saveSession(request: Request): Promise<void> {
  if (!request.session?.save) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    request.session!.save((error) => (error ? reject(error) : resolve()));
  });
}

function oauthSessionBinding(sessionId: string): string {
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

function scopesForPurpose(purpose: string): string[] {
  return purpose === "canvas-admin-oauth-v1" ? adminScopes() : canvasScopes();
}

function hasAdminScopeProfile(scopes: readonly string[]): boolean {
  return CANVAS_ADMIN_REQUIRED_OAUTH_SCOPES.every((scope) => scopes.includes(scope));
}
