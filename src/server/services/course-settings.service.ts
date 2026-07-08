import { Injectable } from "@nestjs/common";
import type { CourseSebDefaults } from "../../shared/models.js";
import {
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  defaultCourseSebDefaults,
  normalizeCourseSebDefaults
} from "../../shared/models.js";
import { RepositoryProvider } from "../data/repositories.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";

@Injectable()
export class CourseSettingsService {
  constructor(private readonly repositories: RepositoryProvider) {}

  async getDefaults(courseId: string): Promise<CourseSebDefaults> {
    const existing = await this.repositories.value.courseSebDefaults.get(courseId);
    return normalizeCourseSebDefaults(existing || defaultCourseSebDefaults(courseId));
  }

  async saveDefaults(
    courseId: string,
    defaults: Partial<CourseSebDefaults>,
    options: { propagate?: boolean } = {}
  ): Promise<CourseSebDefaults> {
    const saved = await this.repositories.value.courseSebDefaults.save(
      courseId,
      normalizeCourseSebDefaults({
        ...defaultCourseSebDefaults(courseId),
        ...defaults,
        id: courseId,
        courseId
      })
    );
    if (options.propagate !== false) {
      await this.propagateDefaults(courseId, saved);
    }
    return saved;
  }

  async resetQuizToDefaults(courseId: string, quizId: string): Promise<unknown> {
    const defaults = await this.getDefaults(courseId);
    if (quizId.startsWith("newquiz:")) {
      const existing = await this.repositories.value.contentSebSettings.get(quizId);
      if (!existing) {
        return null;
      }
      const withDefaults = applyCourseDefaultsToContentSetting(
        {
          ...existing,
          usesCourseDefaults: true,
          quitPasswordOverride: false,
          startPasswordOverride: false
        },
        defaults
      );
      return this.repositories.value.contentSebSettings.save(existing.id || existing.contentId, {
        ...normalizeSebStartPasswordState(existing, withDefaults),
        configKey: null
      });
    }
    const existing = await this.getQuizSetting(quizId);
    if (!existing) {
      return null;
    }
    const withDefaults = applyCourseDefaultsToQuizSetting(
      {
        ...existing,
        usesCourseDefaults: true,
        quitPasswordOverride: false,
        startPasswordOverride: false
      },
      defaults
    );
    return this.repositories.value.quizSebSettings.save(existing.id || existing.quizId, {
      ...normalizeSebStartPasswordState(existing, withDefaults),
      configKey: null
    });
  }

  private async getQuizSetting(quizId: string) {
    const direct = await this.repositories.value.quizSebSettings.get(quizId);
    if (direct) {
      return direct;
    }
    const matches = await this.repositories.value.quizSebSettings.find([{ field: "quizId", op: "==", value: quizId }]);
    return matches[0] || null;
  }

  private async propagateDefaults(courseId: string, defaults: CourseSebDefaults): Promise<void> {
    const [quizSettings, contentSettings] = await Promise.all([
      this.repositories.value.quizSebSettings.find([{ field: "courseId", op: "==", value: courseId }]),
      this.repositories.value.contentSebSettings.find([{ field: "courseId", op: "==", value: courseId }])
    ]);
    await Promise.all([
      ...quizSettings.map((setting) => {
        const withDefaults = applyCourseDefaultsToQuizSetting(setting, defaults);
        return this.repositories.value.quizSebSettings.save(setting.id || setting.quizId, {
          ...normalizeSebStartPasswordState(setting, withDefaults),
          configKey: null
        });
      }),
      ...contentSettings.map((setting) => {
        const withDefaults = applyCourseDefaultsToContentSetting(setting, defaults);
        return this.repositories.value.contentSebSettings.save(setting.id || setting.contentId, {
          ...normalizeSebStartPasswordState(setting, withDefaults),
          configKey: null
        });
      })
    ]);
  }
}
