import { createHash } from "node:crypto";
import type { Response } from "express";
import type { ContentSebSetting, ExternalToolConfig, QuizSebSetting } from "../../shared/models.js";
import {
  classicQuizContentId,
  enabledExternalTools,
  extractClassicQuizId,
  isYouTubeVideoTool,
  parseNewQuizContentId,
  youtubeVideoId
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { setPrivateNoStoreResponseHeaders } from "../http/response-headers.js";
import { AssessmentService, CourseResetInProgressError } from "../services/assessment.service.js";
import {
  canonicalSebConfigContentId,
  sameSebConfigSettingsFingerprint,
  sebConfigSettingsFingerprint
} from "../services/seb-config-grant.service.js";
import { SebConfigKeyService } from "../services/seb-config-key.service.js";
import { SebConfigurationService } from "../services/seb-configuration.service.js";
import { CanvasApiService } from "../services/canvas-api.service.js";
import { SebSessionHandoffService } from "../services/seb-session-handoff.service.js";
import {
  allowedDomains,
  canonicalCanvasAssignmentUrl,
  canvasAssignmentUrl,
  isConfiguredCanvasUrl,
  resolveClassicCanvasUrl
} from "./seb-controller-helpers.js";

export interface SebLaunchContentView {
  id: string;
  courseId: string;
  canvasId: string;
  assignmentId?: string | null;
  contentType: "CLASSIC_QUIZ" | "NEW_QUIZ";
  title: string;
  htmlUrl?: string | null;
  canvasLaunchUrl?: string | null;
}

export interface SebConfigGrantTarget {
  canonicalContentId: string;
  setting: QuizSebSetting | ContentSebSetting;
  settingsFingerprint: string;
}

const SEB_REQUIREMENT_STATUS_CACHE_TTL_MS = 5_000;
const SEB_REQUIREMENT_STATUS_CACHE_MAX_ENTRIES = 5_000;

export class SebContentCoordinator {
  private readonly configDownloadCache = new Map<string, { expiresAt: number; value: Promise<Buffer> }>();
  private readonly requirementStatusCache = new Map<string, { expiresAt: number; value: Promise<boolean> }>();

  constructor(
    private readonly config: AppConfig,
    private readonly assessments: AssessmentService,
    private readonly sebConfig: SebConfigurationService,
    private readonly configKey: SebConfigKeyService,
    private readonly canvasApi?: CanvasApiService,
    private readonly sessionHandoff?: SebSessionHandoffService
  ) {}
  async generateConfig(
    courseId: string,
    contentId: string,
    canvasUrl?: string,
    startUrlOverride?: string
  ): Promise<Buffer> {
    if (startUrlOverride) {
      return this.generateConfigUncached(courseId, contentId, canvasUrl, startUrlOverride);
    }
    const record = await this.assessments.getAssessmentRecord(contentId);
    if (!record || record.courseId !== courseId) {
      throw new Error("Assessment not found");
    }
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          courseId,
          contentId,
          canvas: record.canvas,
          seb: record.seb,
          managedQuitPolicyDigest: this.managedQuitPolicyDigest()
        }),
        "utf8"
      )
      .digest("base64url");
    const now = Date.now();
    const cached = this.configDownloadCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = this.generateConfigUncached(courseId, contentId, canvasUrl);
    this.configDownloadCache.set(key, { expiresAt: now + 120_000, value });
    while (this.configDownloadCache.size > 64) {
      const oldest = this.configDownloadCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.configDownloadCache.delete(oldest);
    }
    try {
      return await value;
    } catch (error) {
      this.configDownloadCache.delete(key);
      throw error;
    }
  }

  async generateConfigForGrant(
    courseId: string,
    contentId: string,
    target: { setting: QuizSebSetting | ContentSebSetting; settingsFingerprint: string },
    canvasUserId: string,
    requiresSessionHandoff: boolean
  ): Promise<{ buffer: Buffer; handoffDocumentIds: string[] }> {
    if (!requiresSessionHandoff) {
      return { buffer: await this.generateConfig(courseId, contentId), handoffDocumentIds: [] };
    }
    if (!this.canvasApi || !this.sessionHandoff) {
      throw new Error("Canvas session handoff services are unavailable");
    }
    const returnTo = await this.resolveCanvasStartUrl(courseId, contentId);
    const sessionUrl = await this.canvasApi.getSessionToken(canvasUserId, returnTo);
    const plain = await this.generatePlainConfigUncached(courseId, contentId, undefined, sessionUrl);
    const dynamicConfigKey = this.configKey.computeConfigKey(plain);
    const handoffDocumentIds = await this.sessionHandoff.registerConfig(
      courseId,
      contentId,
      target.settingsFingerprint,
      dynamicConfigKey,
      returnTo
    );
    try {
      return {
        buffer: this.sebConfig.prepareSebConfigurationDownload(plain, {
          startPassword: target.setting.startPassword
        }),
        handoffDocumentIds
      };
    } catch (error) {
      await this.sessionHandoff.revokeConfigs(handoffDocumentIds);
      throw error;
    }
  }

  async resolveCurrentConfigGrantTarget(courseId: string, contentId: string): Promise<SebConfigGrantTarget | null> {
    if (await this.assessments.isCourseResetInProgress(courseId)) {
      throw new CourseResetInProgressError();
    }
    const target = await this.resolveConfigGrantTarget(courseId, contentId);
    if (await this.assessments.isCourseResetInProgress(courseId)) {
      throw new CourseResetInProgressError();
    }
    return target;
  }

  async finalizeCourseScopedGrant(
    courseId: string,
    target: SebConfigGrantTarget,
    revoke: () => Promise<void>
  ): Promise<SebConfigGrantTarget | null> {
    let resetInProgress: boolean;
    let current: SebConfigGrantTarget | null;
    try {
      resetInProgress = await this.assessments.isCourseResetInProgress(courseId);
      current = resetInProgress ? null : await this.resolveConfigGrantTarget(courseId, target.canonicalContentId);
      resetInProgress = resetInProgress || (await this.assessments.isCourseResetInProgress(courseId));
    } catch (error) {
      await revoke();
      throw error;
    }
    if (
      resetInProgress ||
      !current ||
      !sameSebConfigSettingsFingerprint(current.settingsFingerprint, target.settingsFingerprint)
    ) {
      await revoke();
      if (resetInProgress) {
        throw new CourseResetInProgressError();
      }
      return null;
    }
    return current;
  }

  async resolveConfigGrantTarget(courseId: string, contentId: string): Promise<SebConfigGrantTarget | null> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      return null;
    }
    const parsed = parseNewQuizContentId(canonicalContentId);
    if (parsed && parsed.courseId !== courseId) {
      return null;
    }
    const setting = await this.resolveSebSetting(courseId, canonicalContentId);
    if (
      !setting?.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      setting.courseId !== courseId ||
      !this.effectiveQuitPassword(setting) ||
      (setting.startPassword && !setting.configKeySalt) ||
      !(await this.matchesAssessmentObject(courseId, canonicalContentId))
    ) {
      return null;
    }
    return {
      canonicalContentId,
      setting,
      settingsFingerprint: createHash("sha256")
        .update(
          `${sebConfigSettingsFingerprint(courseId, canonicalContentId, setting)}\0${this.managedQuitPolicyDigest()}`,
          "utf8"
        )
        .digest("base64url")
    };
  }

  async isSebRequirementConfigured(courseId: string, contentId: string): Promise<boolean> {
    const setting = await this.resolveSebSetting(courseId, contentId);
    if (
      !setting ||
      setting.courseId !== courseId ||
      !setting.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      !this.effectiveQuitPassword(setting) ||
      (setting.startPassword && !setting.configKeySalt)
    ) {
      return false;
    }

    const parsed = parseNewQuizContentId(contentId);
    if (parsed) {
      return (
        parsed.courseId === courseId &&
        "contentId" in setting &&
        setting.contentId === contentId &&
        setting.assignmentId === parsed.assignmentId &&
        setting.contentType === "NEW_QUIZ"
      );
    }

    const classicId = extractClassicQuizId(contentId);
    return !!classicId && "quizId" in setting && setting.quizId === classicId;
  }

  cachedSebRequirementStatus(courseId: string, contentId: string): Promise<boolean> | null {
    const key = `${courseId}:${contentId}`;
    const cached = this.requirementStatusCache.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.requirementStatusCache.delete(key);
      return null;
    }
    return cached.value;
  }

  cacheSebRequirementStatus(courseId: string, contentId: string, load: () => Promise<boolean>): Promise<boolean> {
    const key = `${courseId}:${contentId}`;
    const now = Date.now();
    for (const [cachedKey, cached] of this.requirementStatusCache) {
      if (cached.expiresAt <= now) {
        this.requirementStatusCache.delete(cachedKey);
      }
    }
    while (this.requirementStatusCache.size >= SEB_REQUIREMENT_STATUS_CACHE_MAX_ENTRIES) {
      const oldestKey = this.requirementStatusCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.requirementStatusCache.delete(oldestKey);
    }

    const value = load().catch((error: unknown) => {
      const current = this.requirementStatusCache.get(key);
      if (current?.value === value) {
        this.requirementStatusCache.delete(key);
      }
      throw error;
    });
    this.requirementStatusCache.set(key, {
      expiresAt: now + SEB_REQUIREMENT_STATUS_CACHE_TTL_MS,
      value
    });
    return value;
  }

  canvasCourseHomeUrl(courseId: string): string {
    return new URL(`/courses/${encodeURIComponent(courseId)}`, this.config.getCanvasDomain()).toString();
  }

  applicationBaseUrl(): string {
    const baseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!baseUrl) {
      throw new Error("Application base URL is required for exam tools");
    }
    return baseUrl;
  }

  examToolPayloads(tools?: ExternalToolConfig[] | null): Array<{ id: string; label: string; url: string }> {
    return enabledExternalTools(tools).map((tool) => ({
      id: tool.id,
      label: tool.label,
      url: this.examToolLaunchUrl(tool)
    }));
  }

  examToolLaunchUrl(tool: ExternalToolConfig): string {
    const appBaseUrl = this.applicationBaseUrl();
    const videoId = isYouTubeVideoTool(tool) ? youtubeVideoId(tool) : null;
    if (videoId) {
      return new URL(`/seb/tool/youtube/${videoId}`, appBaseUrl).toString();
    }
    return tool.url;
  }

  async redirectStaleSebLaunchToCanvas(response: Response, contentId: string): Promise<boolean> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      return false;
    }
    try {
      const resolved = await this.resolveContentForLaunch(canonicalContentId);
      if (!resolved?.content.courseId) {
        return false;
      }
      setPrivateNoStoreResponseHeaders(response);
      response.redirect(303, this.canvasCourseHomeUrl(resolved.content.courseId));
      return true;
    } catch {
      return false;
    }
  }

  effectiveQuitPassword(setting: QuizSebSetting | ContentSebSetting): string | null {
    return setting.quitPassword?.trim() || this.config.value.seb.defaultQuitPassword?.trim() || null;
  }

  managedQuitPolicyDigest(): string {
    return createHash("sha256")
      .update(`managed-quit-policy-v1\0${this.config.value.seb.defaultQuitPassword || ""}`, "utf8")
      .digest("base64url");
  }

  async generateConfigUncached(
    courseId: string,
    contentId: string,
    canvasUrl?: string,
    startUrlOverride?: string
  ): Promise<Buffer> {
    const plain = await this.generatePlainConfigUncached(courseId, contentId, canvasUrl, startUrlOverride);
    const setting = await this.resolveSebSetting(courseId, contentId);
    return this.sebConfig.prepareSebConfigurationDownload(plain, {
      startPassword: setting?.startPassword
    });
  }

  async generatePlainConfigUncached(
    courseId: string,
    contentId: string,
    canvasUrl?: string,
    startUrlOverride?: string
  ): Promise<Buffer> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const setting = await this.assessments.getSebSettingForQuiz(classicId);
      if (!setting?.sebRequired || !setting.enabled || !setting.accessCode || setting.courseId !== courseId) {
        throw new Error("SEB not enabled or access code missing");
      }
      if (setting.startPassword && !setting.configKeySalt) {
        throw new Error("SEB start-password settings must be saved again before generating a configuration");
      }
      const accessCode = setting.accessCode;
      if (!accessCode) {
        throw new Error("SEB not enabled or access code missing");
      }
      const quiz = await this.assessments.getQuiz(classicId);
      if (!quiz || quiz.courseId !== courseId) {
        throw new Error("Assessment not found");
      }
      const startUrl =
        startUrlOverride || resolveClassicCanvasUrl(this.config, courseId, classicId, canvasUrl, quiz?.htmlUrl);
      return this.sebConfig.generateSebConfiguration({
        courseId,
        contentId: contentId.startsWith("classicquiz_") ? contentId : classicQuizContentId(classicId),
        startUrl,
        accessCode,
        allowedDomains: allowedDomains(setting),
        quitPassword: setting.quitPassword,
        startPassword: setting.startPassword,
        configKeySalt: setting.configKeySalt
      });
    }

    const setting = await this.assessments.getContentSebSetting(contentId);
    const parsedContentId = parseNewQuizContentId(contentId);
    if (
      !parsedContentId ||
      parsedContentId.courseId !== courseId ||
      !setting?.sebRequired ||
      !setting.enabled ||
      !setting.accessCode ||
      setting.courseId !== courseId ||
      setting.assignmentId !== parsedContentId.assignmentId
    ) {
      throw new Error("SEB not enabled or access code missing");
    }
    if (setting.startPassword && !setting.configKeySalt) {
      throw new Error("SEB start-password settings must be saved again before generating a configuration");
    }
    const accessCode = setting.accessCode;
    if (!accessCode) {
      throw new Error("SEB not enabled or access code missing");
    }
    const startUrl = startUrlOverride || (await this.resolveNewQuizStartUrl(courseId, contentId, setting));
    return this.sebConfig.generateSebConfiguration({
      courseId,
      contentId,
      startUrl,
      accessCode,
      allowedDomains: allowedDomains(setting),
      quitPassword: setting.quitPassword,
      startPassword: setting.startPassword,
      configKeySalt: setting.configKeySalt
    });
  }

  async resolveCanvasStartUrl(courseId: string, contentId: string): Promise<string> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.assessments.getQuiz(classicId);
      return resolveClassicCanvasUrl(this.config, courseId, classicId, undefined, quiz?.htmlUrl);
    }
    const setting = await this.assessments.getContentSebSetting(contentId);
    if (!setting) {
      throw new Error("Assessment not found");
    }
    return this.resolveNewQuizStartUrl(courseId, contentId, setting);
  }

  generateSetupCheckConfig(): Buffer {
    const plain = this.generatePlainSetupCheckConfig();
    return this.sebConfig.prepareSebConfigurationDownload(plain);
  }

  currentSetupCheckConfigKey(): string {
    return this.configKey.computeConfigKey(this.generatePlainSetupCheckConfig());
  }

  generatePlainSetupCheckConfig(): Buffer {
    const configuredBaseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!configuredBaseUrl) {
      throw new Error("Application base URL is required to generate SEB setup check configuration");
    }
    const baseUrl = configuredBaseUrl.replace(/\/+$/u, "");
    return this.sebConfig.generateSebSetupCheckConfiguration({
      startUrl: `${baseUrl}/seb/check`,
      quitUrl: `${baseUrl}/seb/check/quit`
    });
  }

  async currentConfigKey(
    courseId: string,
    contentId: string,
    setting: QuizSebSetting | ContentSebSetting
  ): Promise<string> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.assessments.getQuiz(classicId);
      const startUrl = resolveClassicCanvasUrl(this.config, courseId, classicId, undefined, quiz?.htmlUrl);
      const generated = this.sebConfig.generateSebConfiguration({
        courseId,
        contentId: contentId.startsWith("classicquiz_") ? contentId : classicQuizContentId(classicId),
        startUrl,
        accessCode: setting.accessCode || "",
        allowedDomains: allowedDomains(setting),
        quitPassword: setting.quitPassword,
        startPassword: setting.startPassword,
        configKeySalt: setting.configKeySalt
      });
      return this.configKey.computeConfigKey(generated);
    }

    const startUrl = await this.resolveNewQuizStartUrl(courseId, contentId, setting as ContentSebSetting);
    const generated = this.sebConfig.generateSebConfiguration({
      courseId,
      contentId,
      startUrl,
      accessCode: setting.accessCode || "",
      allowedDomains: allowedDomains(setting),
      quitPassword: setting.quitPassword,
      startPassword: setting.startPassword,
      configKeySalt: setting.configKeySalt
    });
    return this.configKey.computeConfigKey(generated);
  }

  async resolveContentForLaunch(contentId: string): Promise<{
    content: SebLaunchContentView;
    setting: QuizSebSetting | ContentSebSetting | null;
    launchTarget: string;
  } | null> {
    const classicId = extractClassicQuizId(contentId);
    if (classicId) {
      const quiz = await this.assessments.getQuiz(classicId);
      if (!quiz?.courseId) {
        return null;
      }
      return {
        content: {
          id: classicQuizContentId(classicId),
          courseId: quiz.courseId,
          canvasId: classicId,
          contentType: "CLASSIC_QUIZ",
          title: quiz.title,
          htmlUrl: quiz.htmlUrl
        },
        setting: await this.assessments.getSebSettingForQuiz(classicId),
        launchTarget: resolveClassicCanvasUrl(this.config, quiz.courseId, classicId)
      };
    }
    const parsedContentId = parseNewQuizContentId(contentId);
    if (!parsedContentId) {
      return null;
    }
    const content = await this.assessments.getContentItem(contentId);
    const setting = await this.assessments.getContentSebSetting(contentId);
    if (!content && !setting) {
      return null;
    }
    const resolvedCourseId = content?.courseId || setting?.courseId;
    const assignmentId =
      setting?.assignmentId || content?.assignmentId || content?.canvasId || parsedContentId?.assignmentId;
    if (!resolvedCourseId || !assignmentId) {
      return null;
    }
    const contentView: SebLaunchContentView | null = content
      ? {
          id: content.id,
          courseId: content.courseId,
          canvasId: content.canvasId,
          assignmentId: content.assignmentId,
          contentType: "NEW_QUIZ",
          title: content.title,
          htmlUrl: content.htmlUrl,
          canvasLaunchUrl: content.canvasLaunchUrl
        }
      : null;
    return {
      content: contentView || {
        id: contentId,
        courseId: resolvedCourseId,
        canvasId: setting?.canvasId || assignmentId,
        assignmentId,
        contentType: "NEW_QUIZ",
        title: "New Quiz",
        htmlUrl: setting?.htmlUrl,
        canvasLaunchUrl: setting?.canvasLaunchUrl
      },
      setting,
      launchTarget: canvasAssignmentUrl(this.config, resolvedCourseId, assignmentId)
    };
  }

  async resolveNewQuizStartUrl(courseId: string, contentId: string, setting: ContentSebSetting): Promise<string> {
    const content = await this.assessments.getContentItem(contentId);
    const assignmentId = setting.assignmentId || setting.canvasId || parseNewQuizContentId(contentId)?.assignmentId;
    if (!assignmentId) {
      throw new Error("Unable to determine Canvas start URL");
    }
    const candidates = [content?.htmlUrl, setting.htmlUrl, content?.canvasLaunchUrl, setting.canvasLaunchUrl];
    for (const candidate of candidates) {
      if (candidate && isConfiguredCanvasUrl(this.config, candidate)) {
        const canonical = canonicalCanvasAssignmentUrl(this.config, courseId, assignmentId, candidate);
        if (canonical) {
          return canonical;
        }
      }
    }
    return canvasAssignmentUrl(this.config, courseId, assignmentId);
  }

  async resolveSebSetting(courseId: string, quizId: string): Promise<(QuizSebSetting | ContentSebSetting) | null> {
    const parsed = parseNewQuizContentId(quizId);
    if (parsed) {
      if (parsed.courseId !== courseId) {
        return null;
      }
      const setting = await this.assessments.getContentSebSetting(quizId);
      return setting?.courseId === courseId && setting.assignmentId === parsed.assignmentId ? setting : null;
    }
    if (quizId.startsWith("newquiz:")) {
      return null;
    }
    const setting = await this.assessments.getSebSettingForQuiz(quizId);
    return setting?.courseId === courseId ? setting : null;
  }

  async matchesAssessmentObject(courseId: string, contentId: string): Promise<boolean> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId) {
      return false;
    }
    if (!(await this.assessments.isAssessmentAvailableForLearner(courseId, canonicalContentId))) {
      return false;
    }
    const parsed = parseNewQuizContentId(canonicalContentId);
    if (parsed) {
      if (parsed.courseId !== courseId) {
        return false;
      }
      const content = await this.assessments.getContentItem(canonicalContentId);
      return (
        content?.id === canonicalContentId &&
        content.courseId === courseId &&
        content.contentType === "NEW_QUIZ" &&
        content.assignmentId === parsed.assignmentId
      );
    }
    const quizId = extractClassicQuizId(canonicalContentId);
    if (!quizId) {
      return false;
    }
    const quiz = await this.assessments.getQuiz(quizId);
    return quiz?.id === quizId && quiz.courseId === courseId;
  }
}
