import { Injectable } from "@nestjs/common";
import type { ContentItem, OAuthToken, Quiz } from "../../shared/models.js";
import { newQuizContentId } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";

interface CanvasQuizResponse {
  id: number | string;
  title?: string;
  description?: string;
  html_url?: string;
  quiz_type?: string;
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
}

@Injectable()
export class CanvasApiService {
  private readonly tokenCache = new Map<string, OAuthToken>();

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
    const json = await this.request<CanvasQuizResponse[]>(
      userId,
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes?per_page=100`
    );
    return json.map((quiz) => ({
      id: String(quiz.id),
      canvasQuizId: String(quiz.id),
      courseId,
      title: quiz.title || "Untitled Quiz",
      description: quiz.description || null,
      htmlUrl: quiz.html_url || `${this.getCanvasDomain()}/courses/${courseId}/quizzes/${quiz.id}`,
      quizEngine: "classic",
      quizTypeDisplay: "Classic Quiz",
      contentType: "CLASSIC_QUIZ"
    }));
  }

  async getNewQuizAssignments(courseId: string, userId: string): Promise<ContentItem[]> {
    const assignments = await this.request<CanvasAssignmentResponse[]>(
      userId,
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/assignments?per_page=100&new_quizzes=true`
    );
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
        quizTypeDisplay: "New Quiz"
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

  async getSessionToken(userId: string, targetUrl: string): Promise<string | null> {
    const data = await this.request<{ session_url?: string }>(
      userId,
      `${this.getCanvasApiBaseUrl()}/login/session_token?return_to=${encodeURIComponent(targetUrl)}`
    );
    return data.session_url || null;
  }

  async hasAccessToken(userId: string): Promise<boolean> {
    return !!(await this.getAccessToken(userId));
  }

  async getAccessToken(userId: string): Promise<string | null> {
    const cached = this.tokenCache.get(userId);
    if (cached?.accessToken) {
      return cached.accessToken;
    }
    const matches = await this.repositories.value.oauthTokens.find([{ field: "userId", op: "==", value: userId }]);
    const token = matches.filter((match) => !!match.accessToken).sort(compareTokenFreshness)[0];
    if (!token?.accessToken) {
      return null;
    }
    this.tokenCache.set(userId, token);
    return token.accessToken;
  }

  async storeAccessToken(userId: string, accessToken: string, scope?: string): Promise<OAuthToken> {
    await this.clearAccessToken(userId);
    const token: OAuthToken = {
      userId,
      accessToken,
      scope: scope || null,
      updatedAt: new Date().toISOString()
    };
    const saved = await this.repositories.value.oauthTokens.save(userId, token);
    this.tokenCache.set(userId, saved);
    return saved;
  }

  async clearAccessToken(userId: string): Promise<void> {
    this.tokenCache.delete(userId);
    const matches = await this.repositories.value.oauthTokens.find([{ field: "userId", op: "==", value: userId }]);
    const ids = new Set([userId, ...matches.map((token) => token.id).filter((id): id is string => !!id)]);
    await Promise.all(Array.from(ids).map((id) => this.repositories.value.oauthTokens.delete(id)));
  }

  async request<T = unknown>(userId: string, url: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await this.getAccessToken(userId);
    if (!accessToken) {
      throw new CanvasApiAuthorizationError("Canvas API authorization is required.", userId);
    }
    const response = await fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        authorization: `Bearer ${accessToken}`
      }
    });
    const text = await response.text();
    if (response.status === 401) {
      await this.clearAccessToken(userId);
      throw new CanvasApiAuthorizationError(
        `Canvas API authorization was rejected by Canvas (${response.status}).`,
        userId,
        response.status,
        text
      );
    }
    if (response.status === 403) {
      throw new CanvasApiPermissionError(
        `Canvas API request was forbidden by Canvas (${response.status}).`,
        userId,
        url,
        response.status,
        text
      );
    }
    if (!response.ok) {
      throw new CanvasApiRequestError(
        `Canvas API request failed ${response.status}: ${text}`,
        userId,
        url,
        response.status,
        text
      );
    }
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
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
        lookupUuid: detail.lookup_uuid || fallback.lookupUuid,
        metadata: detail
      };
    } catch {
      return fallback;
    }
  }
}

export class CanvasApiAuthorizationError extends Error {
  constructor(
    message: string,
    readonly userId: string,
    readonly status?: number,
    readonly responseBody?: string
  ) {
    super(message);
    this.name = "CanvasApiAuthorizationError";
  }
}

export function isCanvasApiAuthorizationError(error: unknown): error is CanvasApiAuthorizationError {
  return error instanceof CanvasApiAuthorizationError;
}

export class CanvasApiPermissionError extends Error {
  constructor(
    message: string,
    readonly userId: string,
    readonly url: string,
    readonly status: number,
    readonly responseBody: string
  ) {
    super(message);
    this.name = "CanvasApiPermissionError";
  }
}

export function isCanvasApiPermissionError(error: unknown): error is CanvasApiPermissionError {
  return error instanceof CanvasApiPermissionError;
}

export class CanvasApiRequestError extends Error {
  constructor(
    message: string,
    readonly userId: string,
    readonly url: string,
    readonly status: number,
    readonly responseBody: string
  ) {
    super(message);
    this.name = "CanvasApiRequestError";
  }
}

export function isCanvasApiRequestError(error: unknown): error is CanvasApiRequestError {
  return error instanceof CanvasApiRequestError;
}

function compareTokenFreshness(left: OAuthToken, right: OAuthToken): number {
  return tokenTimestamp(right) - tokenTimestamp(left);
}

function tokenTimestamp(token: OAuthToken): number {
  const value = token.updatedAt || token.createdAt || "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isNewQuizAssignment(assignment: CanvasAssignmentResponse): boolean {
  if (assignment.quiz_lti || assignment.is_quiz_assignment) {
    return true;
  }
  const url = assignment.external_tool_tag_attributes?.url || "";
  return url.includes("new_quizzes") || url.includes("quiz-lti") || url.includes("external_tools");
}
