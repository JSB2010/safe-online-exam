import { createHash, randomInt, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { CourseSebDefaults, Quiz, QuizSebSetting, StructuredSebConfigRequest } from "../../shared/models.js";
import {
  applyCourseDefaultsToQuizSetting,
  defaultQuizSebSetting,
  normalizeExternalTools,
  normalizeUrlRules,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { RepositoryProvider } from "../data/repositories.js";
import { CanvasApiService } from "./canvas-api.service.js";

@Injectable()
export class QuizService {
  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly canvasApi: CanvasApiService
  ) {}

  async getQuizzesForCourse(courseId: string, userId?: string, forceRefresh = false): Promise<Quiz[]> {
    if (userId && forceRefresh) {
      return this.refreshQuizzes(courseId, userId);
    }
    const cached = await this.repositories.value.quizzes.find([{ field: "courseId", op: "==", value: courseId }]);
    if (cached.length || !userId) {
      return cached;
    }
    return this.refreshQuizzes(courseId, userId);
  }

  async refreshQuizzes(courseId: string, userId: string): Promise<Quiz[]> {
    const quizzes = await this.canvasApi.getQuizzesForCourse(courseId, userId);
    await this.repositories.value.quizzes.saveMany(quizzes.map((value) => ({ id: value.id, value })));
    return quizzes;
  }

  async getQuiz(quizId: string): Promise<Quiz | null> {
    return this.repositories.value.quizzes.get(quizId);
  }

  async getSebSettingForQuiz(quizId: string): Promise<QuizSebSetting | null> {
    const direct = await this.repositories.value.quizSebSettings.get(quizId);
    if (direct) {
      return direct;
    }
    const matches = await this.repositories.value.quizSebSettings.find([{ field: "quizId", op: "==", value: quizId }]);
    return matches[0] || null;
  }

  async saveSebSetting(setting: QuizSebSetting): Promise<QuizSebSetting> {
    return this.repositories.value.quizSebSettings.save(setting.id || setting.quizId, {
      ...setting,
      id: setting.id || setting.quizId,
      quizId: setting.quizId,
      ssoDomains: setting.ssoDomains || [],
      educationalToolDomains: setting.educationalToolDomains || [],
      customDomains: setting.customDomains || [],
      urlRules: normalizeUrlRules(setting.urlRules),
      externalTools: normalizeExternalTools(setting.externalTools)
    });
  }

  async updateSebConfigurationStructured(
    request: StructuredSebConfigRequest,
    required = true
  ): Promise<QuizSebSetting> {
    if (!request.quizId) {
      throw new Error("quizId is required");
    }
    const existing = await this.getSebSettingForQuiz(request.quizId);
    return this.saveSebSetting({
      ...defaultQuizSebSetting(request.quizId),
      ...existing,
      id: existing?.id || request.quizId,
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
      usesCourseDefaults: request.usesCourseDefaults === true,
      quitPasswordOverride: request.quitPasswordOverride === true,
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
    return this.saveSebSetting(
      applyCourseDefaultsToQuizSetting(
        {
          ...defaultQuizSebSetting(quizId, courseId),
          ...existing,
          id: existing?.id || quizId,
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
    return this.saveSebSetting({
      ...defaultQuizSebSetting(quizId, courseId),
      ...existing,
      id: existing?.id || quizId,
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

function normalizeBlank(value?: string | null): string | null {
  return value?.trim() ? value : null;
}
