import { createHash, randomInt, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  AssessmentRecord,
  ContentItem,
  ContentSebSetting,
  CourseSebDefaults,
  Quiz,
  QuizSebSetting,
  StructuredSebConfigRequest
} from "../../shared/models.js";
import {
  applyCourseDefaultsToQuizSetting,
  assessmentIdForClassicQuiz,
  assessmentToContentItem,
  assessmentToContentSebSetting,
  assessmentToQuiz,
  assessmentToQuizSebSetting,
  assessmentWithContentSebSetting,
  assessmentWithQuizSebSetting,
  canonicalAssessmentId,
  contentItemToAssessmentRecord,
  defaultContentSebSetting,
  defaultQuizSebSetting,
  normalizeExternalTools,
  normalizeUrlRules,
  quizToAssessmentRecord,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { RepositoryProvider } from "../data/repositories.js";
import { CanvasApiService } from "./canvas-api.service.js";
import { invalidateConfigKeyIfSebConfigChanged } from "./seb-setting-fingerprint.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";

export interface CourseAssessmentContent {
  classicQuizzes: Quiz[];
  contentItems: ContentItem[];
  assessments: AssessmentRecord[];
}

@Injectable()
export class AssessmentService {
  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly canvasApi: CanvasApiService
  ) {}

  async refreshCourseContent(courseId: string, userId: string): Promise<CourseAssessmentContent> {
    const classicQuizzes = await this.canvasApi.getQuizzesForCourse(courseId, userId);
    const syncedAt = new Date().toISOString();
    const existingRecords = await this.getAssessmentRecordsForCourse(courseId);
    const existing = new Map(existingRecords.map((record) => [record.id, record]));
    const classicRecords = [
      ...classicQuizzes.map((quiz) =>
        quizToAssessmentRecord(quiz, existing.get(assessmentIdForClassicQuiz(quiz.canvasQuizId || quiz.id)), syncedAt)
      )
    ];
    let contentRecords: AssessmentRecord[];
    try {
      const newQuizzes = await this.canvasApi.getNewQuizAssignments(courseId, userId);
      contentRecords = newQuizzes.map((item) => contentItemToAssessmentRecord(item, existing.get(item.id), syncedAt));
    } catch {
      contentRecords = existingRecords.filter((record) => record.contentType !== "CLASSIC_QUIZ");
    }
    const records = [...classicRecords, ...contentRecords];
    const saved = await this.repositories.value.assessments.saveMany(
      records.map((value) => ({
        id: value.id,
        value
      }))
    );
    return this.toCourseAssessmentContent(saved);
  }

  async getAssessmentRecordsForCourse(courseId: string): Promise<AssessmentRecord[]> {
    return (await this.repositories.value.assessments.find([{ field: "courseId", op: "==", value: courseId }])).sort(
      compareAssessmentRecords
    );
  }

  async getAssessmentRecord(id: string): Promise<AssessmentRecord | null> {
    return this.repositories.value.assessments.get(canonicalAssessmentId(id));
  }

  async getQuizzesForCourse(courseId: string, userId?: string, forceRefresh = false): Promise<Quiz[]> {
    if (userId && forceRefresh) {
      return (await this.refreshCourseContent(courseId, userId)).classicQuizzes;
    }
    const cached = (await this.getAssessmentRecordsForCourse(courseId))
      .map(assessmentToQuiz)
      .filter((quiz): quiz is Quiz => !!quiz);
    if (cached.length || !userId) {
      return cached;
    }
    return (await this.refreshCourseContent(courseId, userId)).classicQuizzes;
  }

  async getAllContentForCourse(courseId: string, userId: string): Promise<ContentItem[]> {
    try {
      return (await this.refreshCourseContent(courseId, userId)).contentItems;
    } catch {
      return this.getCachedContentForCourse(courseId);
    }
  }

  async getCachedContentForCourse(courseId: string): Promise<ContentItem[]> {
    return (await this.getAssessmentRecordsForCourse(courseId)).map(assessmentToContentItem);
  }

  async getQuiz(quizId: string): Promise<Quiz | null> {
    const record = await this.getAssessmentRecord(assessmentIdForClassicQuiz(quizId));
    return record ? assessmentToQuiz(record) : null;
  }

  async getContentItem(contentId: string): Promise<ContentItem | null> {
    const record = await this.getAssessmentRecord(contentId);
    return record ? assessmentToContentItem(record) : null;
  }

  async saveContentItem(content: ContentItem): Promise<ContentItem> {
    const existing = await this.getAssessmentRecord(content.id);
    const saved = await this.repositories.value.assessments.save(
      content.id,
      contentItemToAssessmentRecord(content, existing)
    );
    return assessmentToContentItem(saved);
  }

  async getSebSettingForQuiz(quizId: string): Promise<QuizSebSetting | null> {
    const record = await this.getAssessmentRecord(assessmentIdForClassicQuiz(quizId));
    return record ? assessmentToQuizSebSetting(record) : null;
  }

  async getContentSebSetting(contentId: string): Promise<ContentSebSetting | null> {
    const record = await this.getAssessmentRecord(contentId);
    return record ? assessmentToContentSebSetting(record) : null;
  }

  async saveQuizSebSetting(setting: QuizSebSetting): Promise<QuizSebSetting> {
    const quizId = setting.quizId;
    const existingRecord = await this.getAssessmentRecord(assessmentIdForClassicQuiz(quizId));
    const existingSetting = existingRecord ? assessmentToQuizSebSetting(existingRecord) : null;
    const normalized: QuizSebSetting = {
      ...setting,
      id: quizId,
      quizId,
      ssoDomains: setting.ssoDomains || [],
      educationalToolDomains: setting.educationalToolDomains || [],
      customDomains: setting.customDomains || [],
      urlRules: normalizeUrlRules(setting.urlRules),
      externalTools: normalizeExternalTools(setting.externalTools)
    };
    const withStartPassword = normalizeSebStartPasswordState(existingSetting, normalized);
    const nextSetting = invalidateConfigKeyIfSebConfigChanged(existingSetting, withStartPassword);
    const saved = await this.repositories.value.assessments.save(
      assessmentIdForClassicQuiz(quizId),
      assessmentWithQuizSebSetting(existingRecord, nextSetting)
    );
    const result = assessmentToQuizSebSetting(saved);
    if (!result) {
      throw new Error("Saved assessment is not a Classic Quiz");
    }
    return result;
  }

  async saveContentSebSetting(setting: ContentSebSetting): Promise<ContentSebSetting> {
    const existingRecord = await this.getAssessmentRecord(setting.contentId);
    const existingSetting = existingRecord ? assessmentToContentSebSetting(existingRecord) : null;
    const normalized: ContentSebSetting = {
      ...setting,
      id: setting.contentId,
      contentId: setting.contentId,
      ssoDomains: setting.ssoDomains || [],
      educationalToolDomains: setting.educationalToolDomains || [],
      customDomains: setting.customDomains || [],
      urlRules: normalizeUrlRules(setting.urlRules),
      externalTools: normalizeExternalTools(setting.externalTools)
    };
    const withStartPassword = normalizeSebStartPasswordState(existingSetting, normalized);
    const nextSetting = invalidateConfigKeyIfSebConfigChanged(existingSetting, withStartPassword);
    const saved = await this.repositories.value.assessments.save(
      setting.contentId,
      assessmentWithContentSebSetting(existingRecord, nextSetting)
    );
    return assessmentToContentSebSetting(saved);
  }

  async getOrCreateContentSebSetting(
    contentId: string,
    courseId: string,
    assignmentId: string
  ): Promise<ContentSebSetting> {
    const existing = await this.getContentSebSetting(contentId);
    if (existing) {
      return {
        ...existing,
        id: existing.id || contentId,
        contentId,
        courseId: existing.courseId || courseId,
        canvasId: existing.canvasId || assignmentId,
        assignmentId: existing.assignmentId || assignmentId,
        contentType: existing.contentType || "NEW_QUIZ",
        ssoDomains: existing.ssoDomains || [],
        educationalToolDomains: existing.educationalToolDomains || [],
        customDomains: existing.customDomains || [],
        urlRules: normalizeUrlRules(existing.urlRules),
        externalTools: normalizeExternalTools(existing.externalTools)
      };
    }
    return {
      ...defaultContentSebSetting(contentId, courseId),
      htmlUrl: `${this.canvasApi.getCanvasDomain()}/courses/${courseId}/assignments/${assignmentId}`
    };
  }

  async updateSebConfigurationStructured(
    request: StructuredSebConfigRequest,
    required = true
  ): Promise<QuizSebSetting> {
    if (!request.quizId) {
      throw new Error("quizId is required");
    }
    const existing = await this.getSebSettingForQuiz(request.quizId);
    return this.saveQuizSebSetting({
      ...defaultQuizSebSetting(request.quizId),
      ...existing,
      id: request.quizId,
      quizId: request.quizId,
      sebRequired: required,
      enabled: required,
      ssoDomains: request.ssoDomains || [],
      educationalToolDomains: request.educationalToolDomains || [],
      customDomains: request.customDomains || urlRulesToAllowedEntries(request.urlRules),
      urlRules: normalizeUrlRules(request.urlRules),
      externalTools: normalizeExternalTools(request.externalTools),
      externalToolUrl: request.externalToolUrl || existing?.externalToolUrl || null,
      quitPassword: normalizeBlank(request.quitPassword),
      startPassword: normalizeBlank(request.startPassword),
      usesCourseDefaults: request.usesCourseDefaults === true,
      quitPasswordOverride: request.quitPasswordOverride === true,
      startPasswordOverride: request.startPasswordOverride === true,
      browserExamKey: existing?.browserExamKey || generateBrowserExamKey()
    });
  }

  async enableSebWithAccessCode(
    courseId: string,
    quizId: string,
    userId: string,
    defaults?: CourseSebDefaults | null
  ): Promise<QuizSebSetting> {
    const accessCode = generateAccessCode();
    await this.canvasApi.setQuizAccessCode(courseId, quizId, accessCode, userId);
    const existing = await this.getSebSettingForQuiz(quizId);
    return this.saveQuizSebSetting(
      applyCourseDefaultsToQuizSetting(
        {
          ...defaultQuizSebSetting(quizId, courseId),
          ...existing,
          id: quizId,
          quizId,
          courseId,
          sebRequired: true,
          enabled: true,
          accessCode,
          configKey: null,
          browserExamKey: existing?.browserExamKey || generateBrowserExamKey(),
          ssoDomains: existing?.ssoDomains || [],
          educationalToolDomains: existing?.educationalToolDomains || [],
          customDomains: existing?.customDomains || [],
          urlRules: normalizeUrlRules(existing?.urlRules),
          externalTools: normalizeExternalTools(existing?.externalTools)
        },
        defaults
      )
    );
  }

  async disableSebWithAccessCode(courseId: string, quizId: string, userId: string): Promise<QuizSebSetting> {
    const existing = await this.getSebSettingForQuiz(quizId);
    if (existing?.accessCode) {
      await this.canvasApi.removeQuizAccessCode(courseId, quizId, userId);
    }
    return this.saveQuizSebSetting({
      ...defaultQuizSebSetting(quizId, courseId),
      ...existing,
      id: quizId,
      quizId,
      courseId,
      sebRequired: false,
      enabled: false,
      accessCode: null,
      configKey: null
    });
  }

  async validateSebConfiguration(quizId: string): Promise<boolean> {
    const setting = await this.getSebSettingForQuiz(quizId);
    return !!(setting?.sebRequired && setting.accessCode);
  }

  private toCourseAssessmentContent(records: AssessmentRecord[]): CourseAssessmentContent {
    const sorted = records.sort(compareAssessmentRecords);
    return {
      assessments: sorted,
      classicQuizzes: sorted.map(assessmentToQuiz).filter((quiz): quiz is Quiz => !!quiz),
      contentItems: sorted.map(assessmentToContentItem)
    };
  }
}

export function generateAccessCode(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += chars[randomInt(chars.length)];
  }
  return value;
}

export function generateBrowserExamKey(): string {
  return createHash("sha256").update(`SEB${randomUUID()}${Date.now()}`, "utf8").digest("hex");
}

function compareAssessmentRecords(left: AssessmentRecord, right: AssessmentRecord): number {
  return (
    String(left.canvas.title || "").localeCompare(String(right.canvas.title || "")) || left.id.localeCompare(right.id)
  );
}

function normalizeBlank(value?: string | null): string | null {
  return value?.trim() ? value : null;
}
