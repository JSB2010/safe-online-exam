import { Injectable } from "@nestjs/common";
import type { AssessmentRecord, ContentSebSetting, CourseSebDefaults, QuizSebSetting } from "../../shared/models.js";
import {
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  assessmentToContentSebSetting,
  assessmentToQuizSebSetting,
  assessmentWithContentSebSetting,
  assessmentWithQuizSebSetting,
  canonicalAssessmentId,
  courseDefaultsToRecord,
  courseRecordToDefaults,
  defaultCourseSebDefaults,
  extractClassicQuizId,
  parseNewQuizContentId
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";
import { assertDistinctSebPasswords, assertNewSebPassword, resolveSebPasswordUpdate } from "./seb-password-policy.js";
import { effectiveSebQuitPassword, requireSebQuitPassword, type SebQuitProtectedSetting } from "./seb-quit-password.js";

@Injectable()
export class CourseSettingsService {
  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly config: AppConfig = new AppConfig()
  ) {}

  async getDefaults(courseId: string): Promise<CourseSebDefaults> {
    const existing = await this.repositories.value.courses.get(courseId);
    return courseRecordToDefaults(existing, courseId);
  }

  /** Creates the persisted catalog for a newly launched instructor course. */
  async ensureDefaults(courseId: string): Promise<CourseSebDefaults> {
    const saved = await this.repositories.value.courses.update(courseId, (existing) => {
      return existing || courseDefaultsToRecord(courseId, defaultCourseSebDefaults(courseId));
    });
    return courseRecordToDefaults(saved, courseId);
  }

  async saveDefaults(
    courseId: string,
    defaults: Partial<CourseSebDefaults>,
    options: { propagate?: boolean } = {}
  ): Promise<CourseSebDefaults> {
    const existing = await this.repositories.value.courses.get(courseId);
    const existingDefaults = courseRecordToDefaults(existing, courseId);
    const resolvedDefaults = {
      ...defaults,
      quitPassword: resolveSebPasswordUpdate(existingDefaults.quitPassword, defaults.quitPassword),
      startPassword: resolveSebPasswordUpdate(existingDefaults.startPassword, defaults.startPassword)
    };
    assertNewSebPassword(existingDefaults.quitPassword, resolvedDefaults.quitPassword, "exit");
    assertNewSebPassword(existingDefaults.startPassword, resolvedDefaults.startPassword, "start");
    assertDistinctSebPasswords(
      resolvedDefaults.startPassword,
      effectiveSebQuitPassword(resolvedDefaults.quitPassword, this.config.value.seb.defaultQuitPassword)
    );
    const nextRecord = courseDefaultsToRecord(courseId, resolvedDefaults, existing);
    const normalized = courseRecordToDefaults(nextRecord, courseId);
    if (options.propagate !== false) {
      await this.assertDefaultsPreserveQuitProtection(courseId, normalized);
    }
    const saved = await this.repositories.value.courses.save(courseId, nextRecord);
    const persisted = courseRecordToDefaults(saved, courseId);
    if (options.propagate !== false) {
      await this.propagateDefaults(courseId, persisted);
    }
    return persisted;
  }

  async resetQuizToDefaults(courseId: string, quizId: string): Promise<QuizSebSetting | ContentSebSetting | null> {
    const defaults = await this.getDefaults(courseId);
    const assessmentId = canonicalAssessmentId(quizId);
    const saved = await this.repositories.value.assessments.update(assessmentId, (record) => {
      if (!record || !matchesResetTarget(record, courseId, quizId, assessmentId)) {
        return null;
      }
      if (record.contentType !== "CLASSIC_QUIZ") {
        const existing = assessmentToContentSebSetting(record);
        const withDefaults = applyCourseDefaultsToContentSetting(
          {
            ...existing,
            usesCourseDefaults: true,
            externalToolIds: null,
            quitPasswordOverride: false,
            startPasswordOverride: false
          },
          defaults
        );
        this.assertAssessmentCanRunSeb(withDefaults);
        const next = {
          ...normalizeSebStartPasswordState(existing, withDefaults),
          configKey: null
        };
        return assessmentWithContentSebSetting(record, next);
      }
      const existing = assessmentToQuizSebSetting(record);
      if (!existing) {
        return null;
      }
      const withDefaults = applyCourseDefaultsToQuizSetting(
        {
          ...existing,
          usesCourseDefaults: true,
          externalToolIds: null,
          quitPasswordOverride: false,
          startPasswordOverride: false
        },
        defaults
      );
      this.assertAssessmentCanRunSeb(withDefaults);
      const next = {
        ...normalizeSebStartPasswordState(existing, withDefaults),
        configKey: null
      };
      return assessmentWithQuizSebSetting(record, next);
    });
    if (!saved) {
      return null;
    }
    if (saved.contentType !== "CLASSIC_QUIZ") {
      return assessmentToContentSebSetting(saved);
    }
    return assessmentToQuizSebSetting(saved);
  }

  private async propagateDefaults(courseId: string, defaults: CourseSebDefaults): Promise<void> {
    const records = await this.repositories.value.assessments.find([{ field: "courseId", op: "==", value: courseId }]);
    await Promise.all(
      records.map((record) => {
        return this.repositories.value.assessments.update(record.id, (current) => {
          const latest = current || record;
          if (latest.contentType !== "CLASSIC_QUIZ") {
            const setting = assessmentToContentSebSetting(latest);
            const withDefaults = applyCourseDefaultsToContentSetting(setting, defaults);
            this.assertAssessmentCanRunSeb(withDefaults);
            return assessmentWithContentSebSetting(latest, {
              ...normalizeSebStartPasswordState(setting, withDefaults),
              configKey: null
            });
          }
          const setting = assessmentToQuizSebSetting(latest);
          if (!setting) {
            return latest;
          }
          const withDefaults = applyCourseDefaultsToQuizSetting(setting, defaults);
          this.assertAssessmentCanRunSeb(withDefaults);
          return assessmentWithQuizSebSetting(latest, {
            ...normalizeSebStartPasswordState(setting, withDefaults),
            configKey: null
          });
        });
      })
    );
  }

  private async assertDefaultsPreserveQuitProtection(courseId: string, defaults: CourseSebDefaults): Promise<void> {
    const records = await this.repositories.value.assessments.find([{ field: "courseId", op: "==", value: courseId }]);
    for (const record of records) {
      const setting =
        record.contentType === "CLASSIC_QUIZ"
          ? assessmentToQuizSebSetting(record)
          : assessmentToContentSebSetting(record);
      if (setting) {
        this.assertAssessmentCanRunSeb(
          record.contentType === "CLASSIC_QUIZ"
            ? applyCourseDefaultsToQuizSetting(setting as QuizSebSetting, defaults)
            : applyCourseDefaultsToContentSetting(setting as ContentSebSetting, defaults)
        );
      }
    }
  }

  private assertAssessmentCanRunSeb(setting: SebQuitProtectedSetting & { startPassword?: string | null }): void {
    assertDistinctSebPasswords(
      setting.startPassword,
      effectiveSebQuitPassword(setting.quitPassword, this.config.value.seb.defaultQuitPassword)
    );
    requireSebQuitPassword(setting, this.config.value.seb.defaultQuitPassword);
  }
}

function matchesResetTarget(
  record: AssessmentRecord,
  courseId: string,
  requestedContentId: string,
  canonicalContentId: string
): boolean {
  if (record.id !== canonicalContentId || record.courseId !== courseId) {
    return false;
  }

  const parsedNewQuiz = parseNewQuizContentId(requestedContentId);
  if (parsedNewQuiz) {
    return (
      parsedNewQuiz.courseId === courseId &&
      record.contentType === "NEW_QUIZ" &&
      record.canvas.assignmentId === parsedNewQuiz.assignmentId &&
      record.canvas.id === parsedNewQuiz.assignmentId
    );
  }

  const classicQuizId = extractClassicQuizId(requestedContentId);
  return (
    Boolean(classicQuizId) &&
    record.contentType === "CLASSIC_QUIZ" &&
    (record.canvas.quizId || record.canvas.id) === classicQuizId
  );
}
