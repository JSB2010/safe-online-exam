import { Injectable } from "@nestjs/common";
import type { ContentItem, OAuthToken, Quiz } from "../../shared/models.js";
import { newQuizContentId } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";
import {
  discardResponseBody,
  readBoundedUtf8Response,
  UpstreamResponseReadError,
  UpstreamResponseTooLargeError
} from "../http/bounded-response.js";
import { isUpstreamRequestTimeout, withUpstreamDeadline } from "../http/upstream-deadline.js";

interface CanvasQuizResponse {
  id: number | string;
  title?: string;
  description?: string;
  html_url?: string;
  quiz_type?: string;
  published?: boolean;
  unlock_at?: string | null;
  lock_at?: string | null;
}

interface CanvasAssignmentResponse {
  id: number | string;
  name?: string;
  description?: string;
  html_url?: string;
  url?: string;
  external_tool_tag_attributes?: {
    url?: string;
    content_id?: string | number;
  };
  is_quiz_assignment?: boolean;
  quiz_lti?: boolean;
  published?: boolean;
  unlock_at?: string | null;
  lock_at?: string | null;
}

interface CanvasOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface StoreAccessTokenOptions {
  refreshToken?: string | null;
  scope?: string | null;
  expiresIn?: number | null;
  expiresAt?: string | null;
}

const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CANVAS_DISCOVERY_PAGE_SIZE = 100;
const CANVAS_DISCOVERY_MAX_PAGES = 100;
export const CANVAS_API_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const CANVAS_OAUTH_RESPONSE_MAX_BYTES = 64 * 1024;
export const CANVAS_API_USER_AGENT = "SEB-CanvasLTI/1.0";
export const CANVAS_SESSION_TOKEN_SCOPE = "url:GET|/api/v1/login/session_token";

@Injectable()
export class CanvasApiService {
  constructor(
    private readonly config: AppConfig,
    private readonly repositories: RepositoryProvider
  ) {}

  getCanvasApiBaseUrl(): string {
    return this.config.getCanvasApiBaseUrl();
  }

  getCanvasDomain(): string {
    return this.config.getCanvasDomain();
  }

  getNewQuizApiBaseUrl(): string {
    return this.getCanvasApiBaseUrl().replace(/\/api\/v1$/u, "/api/quiz/v1");
  }

  async getQuizzesForCourse(courseId: string, userId: string): Promise<Quiz[]> {
    const url =
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes` +
      `?per_page=${CANVAS_DISCOVERY_PAGE_SIZE}`;
    const json = await this.requestCompleteCanvasCollection<CanvasQuizResponse>(userId, url);
    return json.map((quiz) => ({
      id: String(quiz.id),
      canvasQuizId: String(quiz.id),
      courseId,
      title: quiz.title || "Untitled Quiz",
      description: quiz.description || null,
      htmlUrl: quiz.html_url || `${this.getCanvasDomain()}/courses/${courseId}/quizzes/${quiz.id}`,
      quizEngine: "classic",
      quizTypeDisplay: "Classic Quiz",
      contentType: "CLASSIC_QUIZ",
      published: quiz.published === true,
      unlockAt: quiz.unlock_at || null,
      lockAt: quiz.lock_at || null
    }));
  }

  async getNewQuizAssignments(courseId: string, userId: string): Promise<ContentItem[]> {
    const url =
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/assignments` +
      `?per_page=${CANVAS_DISCOVERY_PAGE_SIZE}&new_quizzes=true`;
    const assignments = await this.requestCompleteCanvasCollection<CanvasAssignmentResponse>(userId, url);
    const candidates = assignments.filter((assignment) => isNewQuizAssignment(assignment));
    const hydrated: ContentItem[] = [];
    for (const assignment of candidates) {
      const assignmentId = String(assignment.id);
      const fallback: ContentItem = {
        id: newQuizContentId(courseId, assignmentId),
        courseId,
        canvasId: assignmentId,
        assignmentId,
        contentType: "NEW_QUIZ",
        title: assignment.name || "New Quiz",
        description: assignment.description || null,
        htmlUrl: assignment.html_url || `${this.getCanvasDomain()}/courses/${courseId}/assignments/${assignmentId}`,
        apiUrl: assignment.url || null,
        canvasLaunchUrl: assignment.external_tool_tag_attributes?.url || null,
        quizEngine: "new_quiz",
        quizTypeDisplay: "New Quiz",
        published: assignment.published === true,
        unlockAt: assignment.unlock_at || null,
        lockAt: assignment.lock_at || null
      };
      hydrated.push(await this.hydrateNewQuiz(courseId, assignmentId, userId, fallback));
    }
    return hydrated;
  }

  async setQuizAccessCode(courseId: string, quizId: string, accessCode: string, userId: string): Promise<boolean> {
    await this.request(
      userId,
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quiz: { access_code: accessCode } })
      }
    );
    return true;
  }

  async removeQuizAccessCode(courseId: string, quizId: string, userId: string): Promise<boolean> {
    await this.request(
      userId,
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quiz: { access_code: "" } })
      }
    );
    return true;
  }

  async setNewQuizAccessCode(
    courseId: string,
    assignmentId: string,
    accessCode: string,
    userId: string
  ): Promise<boolean> {
    const body = new URLSearchParams({
      "quiz[quiz_settings][require_student_access_code]": "true",
      "quiz[quiz_settings][student_access_code]": accessCode
    });
    await this.request(
      userId,
      `${this.getNewQuizApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(assignmentId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      }
    );
    return true;
  }

  async removeNewQuizAccessCode(courseId: string, assignmentId: string, userId: string): Promise<boolean> {
    const body = new URLSearchParams({
      "quiz[quiz_settings][require_student_access_code]": "false",
      "quiz[quiz_settings][student_access_code]": ""
    });
    await this.request(
      userId,
      `${this.getNewQuizApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(assignmentId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      }
    );
    return true;
  }

  async hasAccessToken(userId: string): Promise<boolean> {
    return !!(await this.getAccessToken(userId));
  }

  async hasSessionTokenAccess(userId: string): Promise<boolean> {
    const accessToken = await this.getAccessToken(userId);
    if (!accessToken) {
      return false;
    }
    const token = await this.getStoredToken(userId);
    // Some Canvas installations omit scope from an OAuth response. In that
    // case the readiness request verifies the endpoint rather than rejecting
    // a potentially valid credential based on incomplete metadata alone.
    return !token?.scope || token.scope.split(/\s+/u).includes(CANVAS_SESSION_TOKEN_SCOPE);
  }

  async getAccessToken(userId: string, signal?: AbortSignal): Promise<string | null> {
    const token = await this.getStoredToken(userId);
    if (!token?.accessToken) {
      return null;
    }
    if (shouldRefreshToken(token)) {
      const refreshed = await this.refreshStoredToken(userId, token, signal);
      return refreshed?.accessToken || token.accessToken;
    }
    return token.accessToken;
  }

  async storeAccessToken(
    userId: string,
    accessToken: string,
    scopeOrOptions?: string | StoreAccessTokenOptions | null
  ): Promise<OAuthToken> {
    const options = normalizeStoreAccessTokenOptions(scopeOrOptions);
    const token: OAuthToken = {
      id: userId,
      userId,
      accessToken,
      refreshToken: options.refreshToken || null,
      scope: options.scope || null,
      expiresAt: options.expiresAt || expiresAtFromSeconds(options.expiresIn),
      updatedAt: new Date().toISOString()
    };
    return this.repositories.value.oauthTokens.save(userId, token);
  }

  async clearAccessToken(userId: string): Promise<void> {
    await this.repositories.value.oauthTokens.delete(userId);
  }

  async getSessionToken(userId: string, returnTo: string): Promise<string> {
    const validatedReturnTo = this.validateCanvasUrl(returnTo, "Canvas session return URL");
    const endpoint = new URL(`${this.getCanvasApiBaseUrl()}/login/session_token`);
    endpoint.searchParams.set("return_to", validatedReturnTo);
    let response: unknown;
    try {
      response = await this.request<unknown>(userId, endpoint.toString());
    } catch (error) {
      // A student token that Canvas rejects or cannot use for this scoped
      // endpoint must not leave the student appearing connected on the next
      // launch. The mandatory onboarding screen will request a replacement.
      if (error instanceof CanvasApiAuthorizationError || error instanceof CanvasApiPermissionError) {
        await this.clearAccessToken(userId);
      }
      throw error;
    }
    const sessionUrl =
      response && typeof response === "object" ? (response as Record<string, unknown>).session_url : null;
    if (typeof sessionUrl !== "string" || !sessionUrl) {
      throw new CanvasApiRequestError("Canvas did not return a session URL.", userId, endpoint.toString(), 502);
    }
    return this.validateCanvasUrl(sessionUrl, "Canvas session URL");
  }

  async request<T = unknown>(userId: string, url: string, init: RequestInit = {}): Promise<T> {
    try {
      return await withUpstreamDeadline((signal) => this.requestWithinDeadline<T>(userId, url, init, signal));
    } catch (error) {
      if (isUpstreamRequestTimeout(error)) {
        throw new CanvasApiRequestError("Canvas API request timed out.", userId, url, 504);
      }
      if (error instanceof CanvasApiAuthorizationError || error instanceof CanvasApiPermissionError) {
        throw error;
      }
      if (error instanceof CanvasApiRequestError) {
        throw error;
      }
      if (error instanceof UpstreamResponseTooLargeError) {
        throw new CanvasApiRequestError("Canvas API response exceeded the allowed size.", userId, url, 502);
      }
      if (error instanceof UpstreamResponseReadError) {
        throw new CanvasApiRequestError("Canvas API response could not be read safely.", userId, url, 502);
      }
      throw new CanvasApiRequestError("Canvas API request could not be completed.", userId, url, 502);
    }
  }

  private async requestCompleteCanvasCollection<T>(userId: string, firstPageUrl: string): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= CANVAS_DISCOVERY_MAX_PAGES; page += 1) {
      const url = page === 1 ? firstPageUrl : withCanvasPage(firstPageUrl, page);
      const batch = await this.request<T[]>(userId, url);
      if (!Array.isArray(batch)) {
        throw new CanvasApiRequestError("Canvas API returned an invalid collection response.", userId, url, 502);
      }
      values.push(...batch);
      if (batch.length < CANVAS_DISCOVERY_PAGE_SIZE) {
        return values;
      }
    }
    throw new CanvasApiRequestError(
      "Canvas API collection exceeded the bounded discovery limit.",
      userId,
      firstPageUrl,
      502
    );
  }

  private async requestWithinDeadline<T>(
    userId: string,
    url: string,
    init: RequestInit,
    signal: AbortSignal
  ): Promise<T> {
    const accessToken = await this.getAccessToken(userId, signal);
    if (!accessToken) {
      throw new CanvasApiAuthorizationError("Canvas API authorization is required.", userId);
    }
    let response = await this.fetchWithAccessToken(url, init, accessToken, signal);
    if (response.status === 401 && isSafeReadMethod(init.method)) {
      await discardResponseBody(response);
      const refreshed = await this.refreshStoredToken(userId, await this.getStoredToken(userId), signal);
      if (refreshed?.accessToken) {
        response = await this.fetchWithAccessToken(url, init, refreshed.accessToken, signal);
      }
    }
    if (response.status === 401) {
      await discardResponseBody(response);
      await this.clearAccessToken(userId);
      throw new CanvasApiAuthorizationError(
        `Canvas API authorization was rejected by Canvas (${response.status}).`,
        userId,
        response.status
      );
    }
    if (response.status === 403) {
      await discardResponseBody(response);
      throw new CanvasApiPermissionError(
        `Canvas API request was forbidden by Canvas (${response.status}).`,
        userId,
        url,
        response.status
      );
    }
    if (!response.ok) {
      await discardResponseBody(response);
      throw new CanvasApiRequestError(
        `Canvas API request failed with status ${response.status}.`,
        userId,
        url,
        response.status
      );
    }
    const text = await readBoundedUtf8Response(response, CANVAS_API_RESPONSE_MAX_BYTES);
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CanvasApiRequestError("Canvas API returned an invalid JSON response.", userId, url, 502);
    }
  }

  private async getStoredToken(userId: string): Promise<OAuthToken | null> {
    const token = await this.repositories.value.oauthTokens.get(userId);
    if (!token?.accessToken) {
      return null;
    }
    return token;
  }

  private async refreshStoredToken(
    userId: string,
    token: OAuthToken | null | undefined,
    signal?: AbortSignal
  ): Promise<OAuthToken | null> {
    if (!token?.refreshToken) {
      return null;
    }
    const refreshed = await this.exchangeRefreshToken(token.refreshToken, signal);
    if (!refreshed?.access_token) {
      return null;
    }
    return this.saveRefreshedToken(userId, token, refreshed);
  }

  private async exchangeRefreshToken(
    refreshToken: string,
    existingSignal?: AbortSignal
  ): Promise<CanvasOAuthTokenResponse | null> {
    const clientId = this.config.value.canvas.oauthClientId;
    const clientSecret = this.config.value.canvas.oauthClientSecret;
    if (!clientId || !clientSecret) {
      return null;
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });
    try {
      const exchange = async (signal: AbortSignal): Promise<CanvasOAuthTokenResponse | null> => {
        const response = await fetch(`${this.getCanvasDomain()}/login/oauth2/token`, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": CANVAS_API_USER_AGENT
          },
          body,
          signal
        });
        if (!response.ok) {
          await discardResponseBody(response);
          return null;
        }
        const text = await readBoundedUtf8Response(response, CANVAS_OAUTH_RESPONSE_MAX_BYTES);
        if (!text) {
          return null;
        }
        const parsed = JSON.parse(text) as unknown;
        return isCanvasOAuthTokenResponse(parsed) ? parsed : null;
      };
      return existingSignal ? await exchange(existingSignal) : await withUpstreamDeadline((signal) => exchange(signal));
    } catch (error) {
      if (isUpstreamRequestTimeout(error)) {
        throw error;
      }
      return null;
    }
  }

  private async saveRefreshedToken(
    userId: string,
    current: OAuthToken,
    refreshed: CanvasOAuthTokenResponse
  ): Promise<OAuthToken> {
    const token: OAuthToken = {
      ...current,
      id: userId,
      userId,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || current.refreshToken || null,
      scope: refreshed.scope || current.scope || null,
      expiresAt: expiresAtFromSeconds(refreshed.expires_in),
      updatedAt: new Date().toISOString()
    };
    return this.repositories.value.oauthTokens.save(userId, token);
  }

  private fetchWithAccessToken(
    url: string,
    init: RequestInit,
    accessToken: string,
    signal: AbortSignal
  ): Promise<Response> {
    return fetch(url, {
      ...init,
      signal,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        authorization: `Bearer ${accessToken}`,
        "user-agent": CANVAS_API_USER_AGENT
      }
    });
  }

  private validateCanvasUrl(value: string, label: string): string {
    let url: URL;
    let canvas: URL;
    try {
      url = new URL(value);
      canvas = new URL(this.getCanvasDomain());
    } catch {
      throw new CanvasApiRequestError(`${label} is invalid.`, "", value, 502);
    }
    if (url.protocol !== "https:" || url.origin !== canvas.origin || url.username || url.password || url.hash) {
      throw new CanvasApiRequestError(`${label} must stay on the configured Canvas origin.`, "", value, 502);
    }
    return url.toString();
  }

  private async hydrateNewQuiz(
    courseId: string,
    assignmentId: string,
    userId: string,
    fallback: ContentItem
  ): Promise<ContentItem> {
    try {
      const detail = await this.request<Record<string, any>>(
        userId,
        `${this.getNewQuizApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(assignmentId)}`
      );
      return {
        ...fallback,
        title: detail.title || fallback.title,
        description: detail.instructions || detail.description || fallback.description,
        canvasLaunchUrl: detail.canvas_launch_url || detail.launch_url || fallback.canvasLaunchUrl,
        resourceLinkUuid: detail.resource_link_uuid || fallback.resourceLinkUuid,
        lookupUuid: detail.lookup_uuid || fallback.lookupUuid
      };
    } catch {
      return fallback;
    }
  }
}

export class CanvasApiAuthorizationError extends Error {
  readonly responseBody = "";

  constructor(
    message: string,
    readonly userId: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "CanvasApiAuthorizationError";
  }
}

export function isCanvasApiAuthorizationError(error: unknown): error is CanvasApiAuthorizationError {
  return error instanceof CanvasApiAuthorizationError;
}

export class CanvasApiPermissionError extends Error {
  readonly responseBody = "";

  constructor(
    message: string,
    readonly userId: string,
    readonly url: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CanvasApiPermissionError";
  }
}

export function isCanvasApiPermissionError(error: unknown): error is CanvasApiPermissionError {
  return error instanceof CanvasApiPermissionError;
}

export class CanvasApiRequestError extends Error {
  readonly responseBody = "";

  constructor(
    message: string,
    readonly userId: string,
    readonly url: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CanvasApiRequestError";
  }
}

export function isCanvasApiRequestError(error: unknown): error is CanvasApiRequestError {
  return error instanceof CanvasApiRequestError;
}

function normalizeStoreAccessTokenOptions(
  scopeOrOptions?: string | StoreAccessTokenOptions | null
): StoreAccessTokenOptions {
  if (!scopeOrOptions) {
    return {};
  }
  if (typeof scopeOrOptions === "string") {
    return { scope: scopeOrOptions };
  }
  return scopeOrOptions;
}

function expiresAtFromSeconds(expiresIn?: number | null): string | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function shouldRefreshToken(token: OAuthToken): boolean {
  if (!token.refreshToken || !token.expiresAt) {
    return false;
  }
  const expiresAt = Date.parse(token.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - TOKEN_REFRESH_SKEW_MS <= Date.now();
}

function isSafeReadMethod(method?: string): boolean {
  const normalized = (method || "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

function withCanvasPage(firstPageUrl: string, page: number): string {
  const url = new URL(firstPageUrl);
  url.searchParams.set("page", String(page));
  return url.toString();
}

function isCanvasOAuthTokenResponse(value: unknown): value is CanvasOAuthTokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const token = value as Record<string, unknown>;
  return (
    typeof token.access_token === "string" &&
    token.access_token.length > 0 &&
    (token.refresh_token === undefined || typeof token.refresh_token === "string") &&
    (token.scope === undefined || typeof token.scope === "string") &&
    (token.expires_in === undefined || (typeof token.expires_in === "number" && Number.isFinite(token.expires_in)))
  );
}

function isNewQuizAssignment(assignment: CanvasAssignmentResponse): boolean {
  if (assignment.quiz_lti || assignment.is_quiz_assignment) {
    return true;
  }
  const url = assignment.external_tool_tag_attributes?.url || "";
  return url.includes("new_quizzes") || url.includes("quiz-lti") || url.includes("external_tools");
}
