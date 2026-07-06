import { randomUUID } from "node:crypto";
import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppConfig } from "../config/app-config.js";
import { renderAppShell } from "../http/app-shell.js";
import { CanvasApiService } from "../services/canvas-api.service.js";
import { LtiStateService } from "../services/lti-state.service.js";

@Controller("/api")
export class OAuthController {
  constructor(
    private readonly config: AppConfig,
    private readonly canvasApi: CanvasApiService,
    private readonly ltiState: LtiStateService
  ) {}

  @Get("/oauth2reauthorize")
  reauthorize(@Req() request: Request, @Res() response: Response, @Query() query: Record<string, string>): void {
    if (query.user_id) {
      void this.canvasApi.clearAccessToken(query.user_id);
    }
    this.authorize(request, response, query);
  }

  @Get("/oauth2authorize")
  authorize(@Req() _request: Request, @Res() response: Response, @Query() query: Record<string, string>): void {
    const userId = query.user_id;
    const courseId = query.course_id;
    if (!userId || !courseId) {
      response.status(400).send("Missing user_id or course_id");
      return;
    }
    const clientId = this.config.value.canvas.oauthClientId;
    if (!clientId) {
      response.status(500).send("Canvas API OAuth client id is not configured");
      return;
    }
    const redirectUri = this.oauthRedirectUri();
    const state = this.ltiState.createState({
      nonce: randomUUID(),
      userId,
      courseId,
      redirectUrl:
        query.redirect_url ||
        `/lti/launch?course_id=${encodeURIComponent(courseId)}&user_id=${encodeURIComponent(userId)}`
    });
    const authUrl = new URL(`${this.config.getCanvasDomain()}/login/oauth2/auth`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", canvasScopes().join(" "));
    response.redirect(authUrl.toString());
  }

  @Get("/oauth2callback")
  async callback(@Res() response: Response, @Query() query: Record<string, string>): Promise<void> {
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
      const state = this.ltiState.consumeState(query.state);
      const token = await this.exchangeCode(query.code, this.oauthRedirectUri());
      await this.canvasApi.storeAccessToken(state.userId, token.access_token, {
        refreshToken: token.refresh_token || null,
        scope: token.scope || null,
        expiresIn: token.expires_in
      });
      response.redirect(addOAuthReturnParams(state.redirectUrl, state.courseId, state.userId));
    } catch (error) {
      response.status(400).send(
        renderAppShell({
          title: "Canvas Authorization Error",
          view: "oauth-error",
          initialData: { error: error instanceof Error ? error.message : String(error) }
        })
      );
    }
  }

  @Get("/oauth2status")
  async status(@Query("user_id") userId?: string): Promise<Record<string, unknown>> {
    return {
      authorized: userId ? await this.canvasApi.hasAccessToken(userId) : false,
      userId
    };
  }

  private oauthRedirectUri(): string {
    return this.config.value.canvas.redirectUri || `${this.config.getRequiredToolUrl()}/api/oauth2callback`;
  }

  private async exchangeCode(
    code: string | undefined,
    redirectUri: string
  ): Promise<{ access_token: string; refresh_token?: string; scope?: string; expires_in?: number }> {
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
    const response = await fetch(`${this.config.getCanvasDomain()}/login/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      throw new Error(`Canvas OAuth token exchange failed: ${response.status}`);
    }
    return response.json() as Promise<{
      access_token: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
    }>;
  }
}

function addOAuthReturnParams(redirectUrl: string | undefined, courseId: string, userId: string): string {
  const target = redirectUrl || "/lti/launch";
  const url = new URL(target, "https://placeholder.invalid");
  if (!url.searchParams.has("course_id")) {
    url.searchParams.set("course_id", courseId);
  }
  if (!url.searchParams.has("user_id")) {
    url.searchParams.set("user_id", userId);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function canvasScopes(): string[] {
  return [
    "url:GET|/api/v1/courses/:id",
    "url:GET|/api/v1/courses/:course_id/quizzes",
    "url:GET|/api/v1/courses/:course_id/quizzes/:id",
    "url:GET|/api/v1/courses/:course_id/assignments",
    "url:GET|/api/v1/courses/:course_id/assignments/:id",
    "url:GET|/api/quiz/v1/courses/:course_id/quizzes",
    "url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
    "url:PUT|/api/v1/courses/:course_id/quizzes/:id",
    "url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
    "url:GET|/api/v1/courses/:course_id/modules",
    "url:GET|/api/v1/courses/:course_id/modules/:module_id/items",
    "url:PUT|/api/v1/courses/:course_id/modules/:module_id/items/:id",
    "url:PUT|/api/v1/courses/:course_id/assignments/:id",
    "url:POST|/api/v1/courses/:course_id/assignments"
  ];
}
