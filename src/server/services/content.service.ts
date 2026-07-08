import { Injectable } from "@nestjs/common";
import type { ContentItem, ContentSebSetting } from "../../shared/models.js";
import {
  defaultContentSebSetting,
  newQuizContentId,
  normalizeExternalTools,
  normalizeUrlRules,
  quizToContentItem
} from "../../shared/models.js";
import { RepositoryProvider } from "../data/repositories.js";
import { CanvasApiService } from "./canvas-api.service.js";
import { invalidateConfigKeyIfSebConfigChanged } from "./seb-setting-fingerprint.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";

@Injectable()
export class ContentService {
  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly canvasApi: CanvasApiService
  ) {}

  async getAllContentForCourse(courseId: string, userId: string): Promise<ContentItem[]> {
    try {
      const classic = (await this.canvasApi.getQuizzesForCourse(courseId, userId)).map(quizToContentItem);
      const newQuizzes = await this.canvasApi.getNewQuizAssignments(courseId, userId);
      const content = [...classic, ...newQuizzes];
      await this.repositories.value.contentItems.saveMany(content.map((value) => ({ id: value.id, value })));
      for (const item of newQuizzes) {
        await this.seedNewQuizSetting(item);
      }
      return content;
    } catch {
      return this.repositories.value.contentItems.find([{ field: "courseId", op: "==", value: courseId }]);
    }
  }

  async getContentItem(contentId: string): Promise<ContentItem | null> {
    return this.repositories.value.contentItems.get(contentId);
  }

  async getCachedContentForCourse(courseId: string): Promise<ContentItem[]> {
    return this.repositories.value.contentItems.find([{ field: "courseId", op: "==", value: courseId }]);
  }

  async saveContentItem(content: ContentItem): Promise<ContentItem> {
    return this.repositories.value.contentItems.save(content.id, content);
  }

  async getSebSetting(contentId: string): Promise<ContentSebSetting | null> {
    return this.repositories.value.contentSebSettings.get(contentId);
  }

  async saveSebSetting(setting: ContentSebSetting): Promise<ContentSebSetting> {
    const existing = await this.getSebSetting(setting.contentId);
    const normalized = {
      ...setting,
      id: setting.id || setting.contentId,
      contentId: setting.contentId,
      ssoDomains: setting.ssoDomains || [],
      educationalToolDomains: setting.educationalToolDomains || [],
      customDomains: setting.customDomains || [],
      urlRules: normalizeUrlRules(setting.urlRules),
      externalTools: normalizeExternalTools(setting.externalTools)
    };
    const withStartPassword = normalizeSebStartPasswordState(existing, normalized);
    return this.repositories.value.contentSebSettings.save(
      setting.id || setting.contentId,
      invalidateConfigKeyIfSebConfigChanged(existing, withStartPassword)
    );
  }

  private async seedNewQuizSetting(item: ContentItem): Promise<void> {
    const existing = await this.getSebSetting(item.id);
    const setting: ContentSebSetting = {
      ...defaultContentSebSetting(item.id, item.courseId),
      ...existing,
      id: item.id,
      contentId: item.id,
      courseId: item.courseId,
      canvasId: item.canvasId,
      assignmentId: item.assignmentId || item.canvasId,
      contentType: item.contentType,
      htmlUrl: item.htmlUrl,
      canvasLaunchUrl: item.canvasLaunchUrl,
      resourceLinkUuid: item.resourceLinkUuid,
      lookupUuid: item.lookupUuid,
      ssoDomains: existing?.ssoDomains || [],
      educationalToolDomains: existing?.educationalToolDomains || [],
      customDomains: existing?.customDomains || [],
      urlRules: normalizeUrlRules(existing?.urlRules),
      externalTools: normalizeExternalTools(existing?.externalTools)
    };
    await this.saveSebSetting(setting);
  }
}

export function contentIdForNewQuiz(courseId: string, assignmentId: string): string {
  return newQuizContentId(courseId, assignmentId);
}
