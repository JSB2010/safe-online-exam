import { Injectable } from "@nestjs/common";
import type { CourseSebDefaults } from "../../shared/models.js";
import {
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  assessmentToContentSebSetting,
  assessmentToQuizSebSetting,
  assessmentWithContentSebSetting,
  assessmentWithQuizSebSetting,
  canonicalAssessmentId,
  courseDefaultsToRecord,
  courseRecordToDefaults
} from "../../shared/models.js";
import { RepositoryProvider } from "../data/repositories.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";

@Injectable()
export class CourseSettingsService {
  constructor(private readonly repositories: RepositoryProvider) {}

  async getDefaults(courseId: string): Promise<CourseSebDefaults> {
    const existing = await this.repositories.value.courses.get(courseId);
    return courseRecordToDefaults(existing, courseId);
  }

  async saveDefaults(
    courseId: string,
    defaults: Partial<CourseSebDefaults>,
    options: { propagate?: boolean } = {}
  ): Promise<CourseSebDefaults> {
    const existing = await this.repositories.value.courses.get(courseId);
    const saved = await this.repositories.value.courses.save(
      courseId,
      courseDefaultsToRecord(courseId, defaults, existing)
    );
    const normalized = courseRecordToDefaults(saved, courseId);
    if (options.propagate !== false) {
      await this.propagateDefaults(courseId, normalized);
    }
    return normalized;
  }

  async resetQuizToDefaults(courseId: string, quizId: string): Promise<unknown> {
    const defaults = await this.getDefaults(courseId);
    const record = await this.repositories.value.assessments.get(canonicalAssessmentId(quizId));
    if (!record) {
      return null;
    }
    if (record.contentType !== "CLASSIC_QUIZ") {
      const existing = assessmentToContentSebSetting(record);
      const withDefaults = applyCourseDefaultsToContentSetting(
        {
          ...existing,
          usesCourseDefaults: true,
          quitPasswordOverride: false,
          startPasswordOverride: false
        },
        defaults
      );
      const next = {
        ...normalizeSebStartPasswordState(existing, withDefaults),
        configKey: null
      };
      const saved = await this.repositories.value.assessments.save(
        record.id,
        assessmentWithContentSebSetting(record, next)
      );
      return assessmentToContentSebSetting(saved);
    }
    const existing = assessmentToQuizSebSetting(record);
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
    const next = {
      ...normalizeSebStartPasswordState(existing, withDefaults),
      configKey: null
    };
    const saved = await this.repositories.value.assessments.save(record.id, assessmentWithQuizSebSetting(record, next));
    return assessmentToQuizSebSetting(saved);
  }

  private async propagateDefaults(courseId: string, defaults: CourseSebDefaults): Promise<void> {
    const records = await this.repositories.value.assessments.find([{ field: "courseId", op: "==", value: courseId }]);
    await Promise.all(
      records.map((record) => {
        if (record.contentType !== "CLASSIC_QUIZ") {
          const setting = assessmentToContentSebSetting(record);
          const withDefaults = applyCourseDefaultsToContentSetting(setting, defaults);
          return this.repositories.value.assessments.save(
            record.id,
            assessmentWithContentSebSetting(record, {
              ...normalizeSebStartPasswordState(setting, withDefaults),
              configKey: null
            })
          );
        }
        const setting = assessmentToQuizSebSetting(record);
        if (!setting) {
          return Promise.resolve(record);
        }
        const withDefaults = applyCourseDefaultsToQuizSetting(setting, defaults);
        return this.repositories.value.assessments.save(
          record.id,
          assessmentWithQuizSebSetting(record, {
            ...normalizeSebStartPasswordState(setting, withDefaults),
            configKey: null
          })
        );
      })
    );
  }
}
