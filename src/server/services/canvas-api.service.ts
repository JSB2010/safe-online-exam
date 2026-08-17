import { Injectable } from "@nestjs/common";
import type { CanvasOAuthGrantType, ContentItem, OAuthToken, Quiz } from "../../shared/models.js";
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
import {
  canvasAccountSummary,
  canvasAdminCourse,
  expiresAtFromSeconds,
  hasCurrentRequiredScopes,
  hasRequiredAdminScopes,
  isCanvasOAuthTokenResponse,
  isJsonObject,
  isNewQuizAssignment,
  isSafeReadMethod,
  normalizedCanvasCourseCode,
  normalizedCanvasCourseName,
  normalizedIdentityValue,
  normalizeStoreAccessTokenOptions,
  oauthTokenId,
  shouldRefreshToken,
  withCanvasPage
} from "./canvas-api-helpers.js";
import {
  CanvasApiAuthorizationError,
  CanvasApiPermissionError,
  CanvasApiRequestError,
  type CanvasAccountResponse,
  type CanvasAccountSummary,
  type CanvasAdminCourse,
  type CanvasAdminCourseResponse,
  type CanvasAssignmentResponse,
  type CanvasEnrollmentTerm,
  type CanvasEnrollmentTermResponse,
  type CanvasInstructorCourse,
  type CanvasInstructorCourseResponse,
  type CanvasNewQuizResponse,
  type CanvasOAuthTokenResponse,
  type CanvasQuizResponse,
  type StoreAccessTokenOptions
} from "./canvas-api-types.js";

const CANVAS_DISCOVERY_PAGE_SIZE = 100;
const CANVAS_DISCOVERY_MAX_PAGES = 100;
export const CANVAS_API_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const CANVAS_OAUTH_RESPONSE_MAX_BYTES = 64 * 1024;
export const CANVAS_API_USER_AGENT = "SafeOnlineExam/1.0";
export const CANVAS_SESSION_TOKEN_SCOPE = "url:GET|/api/v1/login/session_token";

export {
  CanvasApiAuthorizationError,
  CanvasApiPermissionError,
  CanvasApiRequestError,
  isCanvasApiAuthorizationError,
  isCanvasApiPermissionError,
  isCanvasApiRequestError
} from "./canvas-api-types.js";
export type {
  CanvasAccountSummary,
  CanvasAdminCourse,
  CanvasEnrollmentTerm,
  CanvasInstructorCourse
} from "./canvas-api-types.js";

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

  async getQuizzesForCourse(
    courseId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<Quiz[]> {
    const url =
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes` +
      `?per_page=${CANVAS_DISCOVERY_PAGE_SIZE}`;
    const json = await this.requestCompleteCanvasCollection<CanvasQuizResponse>(userId, url, grantType);
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

  /**
   * Lists the current OAuth user's active teacher courses. This is deliberately
   * derived from Canvas for every copy operation; a client-supplied course ID
   * is never treated as authorization to change that course's local policy.
   */
  async getInstructorCourses(userId: string): Promise<CanvasInstructorCourse[]> {
    const url = `${this.getCanvasApiBaseUrl()}/courses?enrollment_type=teacher&per_page=${CANVAS_DISCOVERY_PAGE_SIZE}`;
    const courses = await this.requestCompleteCanvasCollection<CanvasInstructorCourseResponse>(userId, url);
    const seen = new Set<string>();
    return courses.flatMap((course) => {
      const id = String(course.id || "").trim();
      if (!id || seen.has(id)) {
        return [];
      }
      seen.add(id);
      return [
        {
          id,
          name: normalizedCanvasCourseName(course.name, id),
          courseCode: normalizedCanvasCourseCode(course.course_code)
        }
      ];
    });
  }

  async getNewQuizAssignments(
    courseId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<ContentItem[]> {
    const url =
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/assignments` +
      `?per_page=${CANVAS_DISCOVERY_PAGE_SIZE}&new_quizzes=true`;
    const assignments = await this.requestCompleteCanvasCollection<CanvasAssignmentResponse>(userId, url, grantType);
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
      hydrated.push(await this.hydrateNewQuiz(courseId, assignmentId, userId, fallback, grantType));
    }
    return hydrated;
  }

  async getQuizAccessCode(
    courseId: string,
    quizId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<string | null> {
    const url = this.classicQuizUrl(courseId, quizId);
    const response = await this.request<unknown>(userId, url, {}, grantType);
    if (!isJsonObject(response)) {
      throw new CanvasApiRequestError("Canvas did not return a valid Classic Quiz response.", userId, url, 502);
    }
    const quiz = response as unknown as CanvasQuizResponse;
    if (!Object.hasOwn(quiz, "access_code")) {
      throw new CanvasApiRequestError("Canvas did not return the current Classic Quiz access code.", userId, url, 502);
    }
    if (quiz.access_code === null || quiz.access_code === "") {
      return null;
    }
    if (typeof quiz.access_code !== "string") {
      throw new CanvasApiRequestError("Canvas returned an invalid Classic Quiz access code.", userId, url, 502);
    }
    return quiz.access_code;
  }

  async getNewQuizAccessCode(
    courseId: string,
    assignmentId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<string | null> {
    const url = this.newQuizUrl(courseId, assignmentId);
    const response = await this.request<unknown>(userId, url, {}, grantType);
    if (!isJsonObject(response)) {
      throw new CanvasApiRequestError("Canvas did not return a valid New Quiz response.", userId, url, 502);
    }
    const quiz = response as CanvasNewQuizResponse;
    const settings = quiz.quiz_settings;
    if (!settings || typeof settings.require_student_access_code !== "boolean") {
      throw new CanvasApiRequestError(
        "Canvas did not return the current New Quiz access-code state.",
        userId,
        url,
        502
      );
    }
    if (!settings.require_student_access_code) {
      return null;
    }
    if (typeof settings.student_access_code !== "string" || !settings.student_access_code) {
      throw new CanvasApiRequestError("Canvas did not return the required New Quiz access code.", userId, url, 502);
    }
    return settings.student_access_code;
  }

  async setQuizAccessCode(
    courseId: string,
    quizId: string,
    accessCode: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<boolean> {
    return this.updateClassicQuizAccessCode(courseId, quizId, accessCode, userId, grantType);
  }

  async removeQuizAccessCode(
    courseId: string,
    quizId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<boolean> {
    return this.updateClassicQuizAccessCode(courseId, quizId, "", userId, grantType);
  }

  async setNewQuizAccessCode(
    courseId: string,
    assignmentId: string,
    accessCode: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<boolean> {
    return this.updateNewQuizAccessCode(courseId, assignmentId, accessCode, userId, grantType);
  }

  async removeNewQuizAccessCode(
    courseId: string,
    assignmentId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<boolean> {
    return this.updateNewQuizAccessCode(courseId, assignmentId, null, userId, grantType);
  }

  private async updateClassicQuizAccessCode(
    courseId: string,
    quizId: string,
    accessCode: string,
    userId: string,
    grantType: CanvasOAuthGrantType
  ): Promise<boolean> {
    await this.request(
      userId,
      this.classicQuizUrl(courseId, quizId),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quiz: { access_code: accessCode } })
      },
      grantType
    );
    return true;
  }

  private async updateNewQuizAccessCode(
    courseId: string,
    assignmentId: string,
    accessCode: string | null,
    userId: string,
    grantType: CanvasOAuthGrantType
  ): Promise<boolean> {
    const body = new URLSearchParams({
      "quiz[quiz_settings][require_student_access_code]": String(accessCode !== null),
      "quiz[quiz_settings][student_access_code]": accessCode || ""
    });
    await this.request(
      userId,
      this.newQuizUrl(courseId, assignmentId),
      {
        method: "PATCH",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      },
      grantType
    );
    return true;
  }

  async getAdminAccount(accountId: string, userId: string): Promise<CanvasAccountSummary> {
    const response = await this.request<CanvasAccountResponse>(
      userId,
      `${this.getCanvasApiBaseUrl()}/accounts/${encodeURIComponent(accountId)}`,
      {},
      "account_admin"
    );
    return canvasAccountSummary(response);
  }

  async getAdminCourse(courseId: string, userId: string): Promise<CanvasAdminCourse> {
    const response = await this.request<CanvasAdminCourseResponse>(
      userId,
      `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}?include[]=term&include[]=account&include[]=concluded`,
      {},
      "account_admin"
    );
    return canvasAdminCourse(response);
  }

  async getAdminCoursesPage(
    rootAccountId: string,
    userId: string,
    options: {
      page?: number;
      perPage?: number;
      search?: string;
      termId?: string;
      includeUnpublished?: boolean;
      withEnrollments?: boolean;
    } = {}
  ): Promise<{ courses: CanvasAdminCourse[]; nextPage: number | null }> {
    const page = Number.isSafeInteger(options.page) && Number(options.page) > 0 ? Number(options.page) : 1;
    const perPage = Math.min(Math.max(Number(options.perPage) || 25, 1), 50);
    const url = new URL(`${this.getCanvasApiBaseUrl()}/accounts/${encodeURIComponent(rootAccountId)}/courses`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("completed", "false");
    url.searchParams.set("with_enrollments", options.withEnrollments === false ? "false" : "true");
    url.searchParams.set("sort", "course_name");
    url.searchParams.set("order", "asc");
    url.searchParams.append("include[]", "term");
    url.searchParams.append("include[]", "teachers");
    if (!options.includeUnpublished) {
      url.searchParams.set("published", "true");
    }
    if (options.termId && /^\d+$/u.test(options.termId)) {
      url.searchParams.set("enrollment_term_id", options.termId);
    }
    const search = options.search?.trim();
    if (search && (search.length >= 3 || /^\d+$/u.test(search))) {
      url.searchParams.set("search_term", search);
    }
    const response = await this.request<CanvasAdminCourseResponse[]>(userId, url.toString(), {}, "account_admin");
    if (!Array.isArray(response)) {
      throw new CanvasApiRequestError("Canvas API returned an invalid course collection.", userId, url.toString(), 502);
    }
    return {
      courses: response.map(canvasAdminCourse),
      nextPage: response.length === perPage ? page + 1 : null
    };
  }

  async getAdminEnrollmentTerms(rootAccountId: string, userId: string): Promise<CanvasEnrollmentTerm[]> {
    const url = new URL(`${this.getCanvasApiBaseUrl()}/accounts/${encodeURIComponent(rootAccountId)}/terms`);
    url.searchParams.set("per_page", "100");
    url.searchParams.append("workflow_state[]", "active");
    const response = await this.request<{ enrollment_terms?: CanvasEnrollmentTermResponse[] }>(
      userId,
      url.toString(),
      {},
      "account_admin"
    );
    return (response.enrollment_terms || [])
      .map((term) => ({
        id: String(term.id || ""),
        name: term.name || "Unnamed term",
        startAt: term.start_at || null,
        endAt: term.end_at || null,
        workflowState: term.workflow_state || null
      }))
      .filter((term) => /^\d+$/u.test(term.id));
  }

  async getAdminPermissions(
    rootAccountId: string,
    userId: string,
    permissions = ["manage_course_content_edit"]
  ): Promise<Record<string, boolean>> {
    const url = new URL(`${this.getCanvasApiBaseUrl()}/accounts/${encodeURIComponent(rootAccountId)}/permissions`);
    for (const permission of permissions) {
      url.searchParams.append("permissions[]", permission);
    }
    const response = await this.request<Record<string, unknown>>(userId, url.toString(), {}, "account_admin");
    return Object.fromEntries(
      permissions.map((permission) => [
        permission,
        response?.[permission] === true || response?.[permission] === "true"
      ])
    );
  }

  async hasAccessToken(userId: string, grantType: CanvasOAuthGrantType = "instructor"): Promise<boolean> {
    const token = await this.getStoredToken(userId, grantType);
    if (!hasCurrentRequiredScopes(token, grantType)) {
      return false;
    }
    return !!(await this.getAccessToken(userId, grantType));
  }

  async hasSessionTokenAccess(userId: string): Promise<boolean> {
    const token = await this.getStoredToken(userId, "student_session");
    if (!hasCurrentRequiredScopes(token, "student_session")) {
      return false;
    }
    const accessToken = await this.getAccessToken(userId, "student_session");
    if (!accessToken) {
      return false;
    }
    // Some Canvas installations omit scope from an OAuth response. In that
    // case the readiness request verifies the endpoint rather than rejecting
    // a potentially valid credential based on incomplete metadata alone.
    return !token?.scope || token.scope.split(/\s+/u).includes(CANVAS_SESSION_TOKEN_SCOPE);
  }

  async getAccessToken(
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor",
    signal?: AbortSignal
  ): Promise<string | null> {
    const token = await this.getStoredToken(userId, grantType);
    if (!token?.accessToken) {
      return null;
    }
    if (shouldRefreshToken(token)) {
      const refreshed = await this.refreshStoredToken(userId, grantType, token, signal);
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
    // Every Canvas user has one durable OAuth grant. Administrator
    // authorization upgrades that grant to the complete scope set, which is
    // also sufficient for the user's instructor and student contexts.
    const adminGrant = options.grantType === "account_admin" || hasRequiredAdminScopes(options.requestedScopes);
    const tokenId = oauthTokenId(userId, options.grantType || "instructor");
    const existing = await this.repositories.value.oauthTokens.get(tokenId);
    const now = new Date().toISOString();
    const storesIdentity = options.displayName !== undefined || options.email !== undefined;
    const token: OAuthToken = {
      id: tokenId,
      userId,
      ...(adminGrant ? { grantType: "account_admin" as const } : {}),
      accessToken,
      refreshToken: options.refreshToken || null,
      scope: options.scope || null,
      requestedScopes: options.requestedScopes ?? existing?.requestedScopes ?? null,
      oauthScopeVersion: options.oauthScopeVersion ?? existing?.oauthScopeVersion ?? null,
      expiresAt: options.expiresAt || expiresAtFromSeconds(options.expiresIn),
      displayName: options.displayName ?? existing?.displayName ?? null,
      email: options.email ?? existing?.email ?? null,
      identityUpdatedAt: storesIdentity ? now : existing?.identityUpdatedAt || null,
      studentReadinessPromptDismissedAt: existing?.studentReadinessPromptDismissedAt || null,
      updatedAt: now
    };
    const saved = await this.repositories.value.oauthTokens.save(tokenId, token);
    await this.deleteLegacyPurposeTokens(userId);
    return saved;
  }

  async hasAdminScopeGrant(userId: string): Promise<boolean> {
    const shared = await this.repositories.value.oauthTokens.get(userId);
    if (hasCurrentRequiredScopes(shared, "account_admin")) {
      return true;
    }
    const legacy = await this.repositories.value.oauthTokens.get(`account_admin:${userId}`);
    return hasCurrentRequiredScopes(legacy, "account_admin");
  }

  /**
   * Retains the current signed LTI identity beside an existing OAuth token.
   * A launch before OAuth authorization intentionally creates no user record.
   */
  async updateStoredIdentity(
    userId: string,
    identity: { displayName?: string | null; email?: string | null },
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<void> {
    const displayName = normalizedIdentityValue(identity.displayName, 512);
    const email = normalizedIdentityValue(identity.email, 320);
    if (displayName === undefined && email === undefined) {
      return;
    }
    const tokenId = oauthTokenId(userId, grantType);
    await this.repositories.value.oauthTokens.update(tokenId, (current) => {
      if (!current?.accessToken) {
        return current;
      }
      const nextDisplayName = displayName ?? current.displayName ?? null;
      const nextEmail = email ?? current.email ?? null;
      if (nextDisplayName === (current.displayName ?? null) && nextEmail === (current.email ?? null)) {
        return current;
      }
      const now = new Date().toISOString();
      return {
        ...current,
        displayName: nextDisplayName,
        email: nextEmail,
        identityUpdatedAt: now,
        updatedAt: now
      };
    });
  }

  async hasDismissedStudentReadinessPrompt(userId: string): Promise<boolean> {
    return !!(await this.getStoredToken(userId, "student_session"))?.studentReadinessPromptDismissedAt;
  }

  async dismissStudentReadinessPrompt(userId: string): Promise<void> {
    const dismissedAt = new Date().toISOString();
    const token = await this.getStoredToken(userId, "student_session");
    if (!token) {
      return;
    }
    await this.repositories.value.oauthTokens.update(token.id || oauthTokenId(userId, "student_session"), (current) => {
      if (!current?.accessToken) {
        return current;
      }
      return {
        ...current,
        studentReadinessPromptDismissedAt: dismissedAt,
        updatedAt: dismissedAt
      };
    });
  }

  async clearAccessToken(userId: string, grantType: CanvasOAuthGrantType = "instructor"): Promise<void> {
    const token = await this.getStoredToken(userId, grantType);
    await this.repositories.value.oauthTokens.delete(token?.id || oauthTokenId(userId, grantType));
  }

  async getSessionToken(userId: string, returnTo: string): Promise<string> {
    const validatedReturnTo = this.validateCanvasUrl(returnTo, "Canvas session return URL");
    const endpoint = new URL(`${this.getCanvasApiBaseUrl()}/login/session_token`);
    endpoint.searchParams.set("return_to", validatedReturnTo);
    let response: unknown;
    try {
      response = await this.request<unknown>(userId, endpoint.toString(), {}, "student_session");
    } catch (error) {
      // A student token that Canvas rejects or cannot use for this scoped
      // endpoint must not leave the student appearing connected on the next
      // launch. The mandatory onboarding screen will request a replacement.
      if (error instanceof CanvasApiAuthorizationError || error instanceof CanvasApiPermissionError) {
        await this.clearAccessToken(userId, "student_session");
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

  async request<T = unknown>(
    userId: string,
    url: string,
    init: RequestInit = {},
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<T> {
    try {
      return await withUpstreamDeadline((signal) =>
        this.requestWithinDeadline<T>(userId, url, init, grantType, signal)
      );
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

  private async requestCompleteCanvasCollection<T>(
    userId: string,
    firstPageUrl: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<T[]> {
    const values: T[] = [];
    for (let page = 1; page <= CANVAS_DISCOVERY_MAX_PAGES; page += 1) {
      const url = page === 1 ? firstPageUrl : withCanvasPage(firstPageUrl, page);
      const batch = await this.request<T[]>(userId, url, {}, grantType);
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
    grantType: CanvasOAuthGrantType,
    signal: AbortSignal
  ): Promise<T> {
    const accessToken = await this.getAccessToken(userId, grantType, signal);
    if (!accessToken) {
      throw new CanvasApiAuthorizationError("Canvas API authorization is required.", userId);
    }
    let response = await this.fetchWithAccessToken(url, init, accessToken, signal);
    if (response.status === 401 && isSafeReadMethod(init.method)) {
      await discardResponseBody(response);
      const refreshed = await this.refreshStoredToken(
        userId,
        grantType,
        await this.getStoredToken(userId, grantType),
        signal
      );
      if (refreshed?.accessToken) {
        response = await this.fetchWithAccessToken(url, init, refreshed.accessToken, signal);
      }
    }
    if (response.status === 401) {
      await discardResponseBody(response);
      await this.clearAccessToken(userId, grantType);
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

  private async getStoredToken(userId: string, grantType: CanvasOAuthGrantType): Promise<OAuthToken | null> {
    const tokenId = oauthTokenId(userId, grantType);
    let token = await this.repositories.value.oauthTokens.get(tokenId);
    // Compatibility for a rolling deployment before migration 004 has
    // consolidated the formerly isolated administrator record.
    if (grantType === "account_admin" && !hasCurrentRequiredScopes(token, "account_admin")) {
      const legacyAdminToken = await this.repositories.value.oauthTokens.get(`account_admin:${userId}`);
      if (legacyAdminToken?.accessToken) {
        token = legacyAdminToken;
      }
    }
    // A short-lived pre-merge implementation stored student grants under a
    // prefixed key. Read it as a compatibility fallback and migrate it back to
    // the shared key on the next authorization or refresh.
    if (!token && grantType !== "account_admin") {
      token = await this.repositories.value.oauthTokens.get(`student_session:${userId}`);
    }
    if (!token?.accessToken) {
      return null;
    }
    return token;
  }

  private async refreshStoredToken(
    userId: string,
    grantType: CanvasOAuthGrantType,
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
    return this.saveRefreshedToken(userId, grantType, token, refreshed);
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
    grantType: CanvasOAuthGrantType,
    current: OAuthToken,
    refreshed: CanvasOAuthTokenResponse
  ): Promise<OAuthToken> {
    const tokenId = oauthTokenId(userId, grantType);
    const token: OAuthToken = {
      ...current,
      id: tokenId,
      userId,
      ...(grantType === "account_admin" ? { grantType } : { grantType: null }),
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || current.refreshToken || null,
      scope: refreshed.scope || current.scope || null,
      expiresAt: expiresAtFromSeconds(refreshed.expires_in),
      updatedAt: new Date().toISOString()
    };
    const saved = await this.repositories.value.oauthTokens.save(tokenId, token);
    await this.deleteLegacyPurposeTokens(userId);
    return saved;
  }

  private async deleteLegacyPurposeTokens(userId: string): Promise<void> {
    await this.repositories.value.oauthTokens.delete(`account_admin:${userId}`);
    await this.repositories.value.oauthTokens.delete(`student_session:${userId}`);
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

  private classicQuizUrl(courseId: string, quizId: string): string {
    return `${this.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}`;
  }

  private newQuizUrl(courseId: string, assignmentId: string): string {
    return `${this.getNewQuizApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(assignmentId)}`;
  }

  private async hydrateNewQuiz(
    courseId: string,
    assignmentId: string,
    userId: string,
    fallback: ContentItem,
    grantType: CanvasOAuthGrantType
  ): Promise<ContentItem> {
    try {
      const detail = await this.request<CanvasNewQuizResponse>(
        userId,
        this.newQuizUrl(courseId, assignmentId),
        {},
        grantType
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
