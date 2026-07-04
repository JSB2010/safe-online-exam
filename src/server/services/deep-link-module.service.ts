import { Injectable } from "@nestjs/common";
import type { ContentItem, Quiz } from "../../shared/models.js";
import { quizToContentItem } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { CanvasApiService } from "./canvas-api.service.js";

interface ModuleItemInfo {
  moduleId: string;
  itemId: string;
  title: string;
  type: string;
}

@Injectable()
export class DeepLinkModuleService {
  constructor(
    private readonly config: AppConfig,
    private readonly canvasApi: CanvasApiService
  ) {}

  async createOrUpdateModuleItemForQuiz(
    courseId: string,
    quiz: Quiz,
    userId: string,
    sebRequired: boolean
  ): Promise<boolean> {
    return this.createOrUpdateModuleItemForContent(courseId, quizToContentItem(quiz), userId, sebRequired);
  }

  async createOrUpdateModuleItemForContent(
    courseId: string,
    content: ContentItem,
    userId: string,
    sebRequired: boolean
  ): Promise<boolean> {
    const modules = await this.getModules(courseId, userId);
    for (const module of modules) {
      const moduleId = String(module.id);
      const items = await this.getModuleItems(courseId, moduleId, userId);
      const match = findMatchingModuleItem(moduleId, items, content);
      if (!match) {
        continue;
      }
      return sebRequired
        ? this.updateToLtiLink(courseId, match, content, userId)
        : this.restoreDirectLink(courseId, match, content, userId);
    }
    return false;
  }

  private async getModules(courseId: string, userId: string): Promise<Array<Record<string, any>>> {
    return this.canvasApi.request<Array<Record<string, any>>>(
      userId,
      `${this.canvasApi.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/modules?per_page=100`
    );
  }

  private async getModuleItems(
    courseId: string,
    moduleId: string,
    userId: string
  ): Promise<Array<Record<string, any>>> {
    return this.canvasApi.request<Array<Record<string, any>>>(
      userId,
      `${this.canvasApi.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/items?per_page=100`
    );
  }

  private async updateToLtiLink(
    courseId: string,
    item: ModuleItemInfo,
    content: ContentItem,
    userId: string
  ): Promise<boolean> {
    await this.canvasApi.request(userId, this.moduleItemUrl(courseId, item), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        module_item: {
          type: "ExternalTool",
          title: item.title,
          external_url: `${this.config.getRequiredToolUrl()}/seb/launch/${content.id}`,
          new_tab: false
        }
      })
    });
    return true;
  }

  private async restoreDirectLink(
    courseId: string,
    item: ModuleItemInfo,
    content: ContentItem,
    userId: string
  ): Promise<boolean> {
    const moduleItem: Record<string, unknown> = { title: item.title };
    if (content.contentType === "CLASSIC_QUIZ") {
      moduleItem.type = "Quiz";
      moduleItem.content_id = content.canvasId;
    } else if (content.contentType === "NEW_QUIZ" || content.contentType === "ASSIGNMENT") {
      moduleItem.type = "Assignment";
      moduleItem.content_id = content.assignmentId || content.canvasId;
    } else {
      moduleItem.type = "ExternalTool";
      moduleItem.external_url = content.externalToolUrl || content.htmlUrl;
    }
    await this.canvasApi.request(userId, this.moduleItemUrl(courseId, item), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ module_item: moduleItem })
    });
    return true;
  }

  private moduleItemUrl(courseId: string, item: ModuleItemInfo): string {
    return `${this.canvasApi.getCanvasApiBaseUrl()}/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(item.moduleId)}/items/${encodeURIComponent(item.itemId)}`;
  }
}

function findMatchingModuleItem(
  moduleId: string,
  items: Array<Record<string, any>>,
  content: ContentItem
): ModuleItemInfo | null {
  for (const item of items) {
    const type = String(item.type || "");
    const contentId = item.content_id === undefined || item.content_id === null ? "" : String(item.content_id);
    const externalUrl = String(item.external_url || "");
    const matches =
      (content.contentType === "CLASSIC_QUIZ" && type === "Quiz" && contentId === content.canvasId) ||
      ((content.contentType === "NEW_QUIZ" || content.contentType === "ASSIGNMENT") &&
        type === "Assignment" &&
        contentId === (content.assignmentId || content.canvasId)) ||
      (type === "ExternalTool" && externalUrl.includes(`/seb/launch/${content.id}`));
    if (matches) {
      return {
        moduleId,
        itemId: String(item.id),
        title: String(item.title || content.title),
        type
      };
    }
  }
  return null;
}
