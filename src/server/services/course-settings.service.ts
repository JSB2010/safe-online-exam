import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import type {
  AdminToolPresetRecord,
  AssessmentRecord,
  ContentSebSetting,
  CourseSebDefaults,
  ExternalToolConfig,
  QuizSebSetting
} from "../../shared/models.js";
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
  normalizeCourseExternalTools,
  parseNewQuizContentId,
  YOUTUBE_VIDEO_TOOL_PRESET
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";
import { AssessmentService } from "./assessment.service.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";
import { assertDistinctSebPasswords, assertNewSebPassword, resolveSebPasswordUpdate } from "./seb-password-policy.js";
import { effectiveSebQuitPassword, requireSebQuitPassword, type SebQuitProtectedSetting } from "./seb-quit-password.js";

@Injectable()
export class CourseSettingsService {
  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly config: AppConfig = new AppConfig(),
    @Optional() private readonly assessments?: AssessmentService
  ) {}

  private withCourseWriteLock<T>(courseId: string, action: () => Promise<T>): Promise<T> {
    return this.assessments ? this.assessments.withCourseWriteLock(courseId, action) : action();
  }

  async getDefaults(courseId: string): Promise<CourseSebDefaults> {
    const existing = await this.repositories.value.courses.get(courseId);
    return courseRecordToDefaults(existing, courseId);
  }

  /** Creates the persisted catalog for a newly launched instructor course. */
  async ensureDefaults(courseId: string): Promise<CourseSebDefaults> {
    return this.withCourseWriteLock(courseId, async () => {
      const saved = await this.repositories.value.courses.update(courseId, (existing) => {
        return existing || courseDefaultsToRecord(courseId, defaultCourseSebDefaults(courseId));
      });
      return courseRecordToDefaults(saved, courseId);
    });
  }

  async saveDefaults(
    courseId: string,
    defaults: Partial<CourseSebDefaults>,
    options: { propagate?: boolean; allowAdminToolChanges?: boolean } = {}
  ): Promise<CourseSebDefaults> {
    return this.withCourseWriteLock(courseId, () => this.saveDefaultsUnlocked(courseId, defaults, options));
  }

  private async saveDefaultsUnlocked(
    courseId: string,
    defaults: Partial<CourseSebDefaults>,
    options: { propagate?: boolean; allowAdminToolChanges?: boolean } = {}
  ): Promise<CourseSebDefaults> {
    const existing = await this.repositories.value.courses.get(courseId);
    const existingDefaults = existing ? courseRecordToDefaults(existing, courseId) : defaultCourseSebDefaults(courseId);
    const resolvedDefaults = {
      ...existingDefaults,
      ...defaults,
      quitPassword: resolveSebPasswordUpdate(existingDefaults.quitPassword, defaults.quitPassword),
      startPassword: resolveSebPasswordUpdate(existingDefaults.startPassword, defaults.startPassword),
      externalTools: options.allowAdminToolChanges
        ? normalizeCourseExternalTools(defaults.externalTools)
        : mergeInstructorCourseTools(existingDefaults.externalTools, defaults.externalTools)
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

  async pushAdminToolPreset(
    courseId: string,
    preset: AdminToolPresetRecord,
    options: { courseWriteLockHeld?: boolean } = {}
  ): Promise<CourseSebDefaults> {
    const action = async () => {
      const existing = await this.getDefaults(courseId);
      const tool = adminManagedTool(preset);
      const current = existing.externalTools.find((entry) => entry.adminPresetId === preset.id);
      if (!current && existing.externalTools.length >= 16) {
        throw new BadRequestException({
          success: false,
          statusCode: 400,
          error_code: "COURSE_TOOL_LIMIT",
          message: "This course already has the maximum of 16 exam tools. Remove one before assigning another preset."
        });
      }
      const nextTools = [
        { ...tool, enabled: current?.enabled === true },
        ...existing.externalTools.filter((entry) => entry.adminPresetId !== preset.id)
      ];
      return this.saveDefaultsUnlocked(
        courseId,
        { ...existing, externalTools: nextTools, externalToolsInitialized: true },
        { propagate: true, allowAdminToolChanges: true }
      );
    };
    return options.courseWriteLockHeld ? action() : this.withCourseWriteLock(courseId, action);
  }

  async removeAdminToolPreset(
    courseId: string,
    presetId: string,
    options: { courseWriteLockHeld?: boolean } = {}
  ): Promise<CourseSebDefaults> {
    const action = async () => {
      const existing = await this.getDefaults(courseId);
      return this.saveDefaultsUnlocked(
        courseId,
        {
          ...existing,
          externalTools: existing.externalTools.filter((entry) => entry.adminPresetId !== presetId),
          externalToolsInitialized: true
        },
        { propagate: true, allowAdminToolChanges: true }
      );
    };
    return options.courseWriteLockHeld ? action() : this.withCourseWriteLock(courseId, action);
  }

  /**
   * Adds a course-owned tool to one target course without replacing its
   * existing catalog. The caller is responsible for proving target-course
   * authorization with Canvas before invoking this mutation.
   */
  async copyInstructorToolToCourse(
    targetCourseId: string,
    sourceTool: ExternalToolConfig
  ): Promise<{ status: "copied" | "already_present"; toolId: string }> {
    return this.withCourseWriteLock(targetCourseId, async () => {
      const [normalizedSource] = normalizeCourseExternalTools([sourceTool]);
      if (!normalizedSource || normalizedSource.managedByAdmin === true || normalizedSource.adminPresetId) {
        throw new BadRequestException({
          success: false,
          statusCode: 400,
          error_code: "COURSE_TOOL_COPY_NOT_ALLOWED",
          message: "School-managed exam tools cannot be copied as instructor-owned tools."
        });
      }

      const existing = await this.getDefaults(targetCourseId);
      const existingTools = normalizeCourseExternalTools(existing.externalTools);
      const matchingTool = existingTools.find((tool) => sameInstructorToolConfiguration(tool, normalizedSource));
      if (matchingTool) {
        return { status: "already_present", toolId: matchingTool.id };
      }
      if (existingTools.length >= 16) {
        throw new BadRequestException({
          success: false,
          statusCode: 400,
          error_code: "COURSE_TOOL_LIMIT",
          message: "This course already has the maximum of 16 exam tools. Remove one before copying another tool."
        });
      }

      const copiedTool = {
        ...normalizedSource,
        id: availableCopiedToolId(normalizedSource.id, existingTools),
        // An instructor can only copy an instructor-owned tool. Keep the target
        // definition local even if old stored data contains stale admin fields.
        managedByAdmin: false,
        adminPresetId: null,
        allowedRules: normalizedSource.allowedRules?.map((rule) => ({ ...rule })),
        allowedDomains: normalizedSource.allowedDomains?.slice()
      };
      await this.saveDefaultsUnlocked(
        targetCourseId,
        {
          ...existing,
          externalTools: [...existingTools, copiedTool],
          externalToolsInitialized: true
        },
        { propagate: true }
      );
      return { status: "copied", toolId: copiedTool.id };
    });
  }

  async resetQuizToDefaults(courseId: string, quizId: string): Promise<QuizSebSetting | ContentSebSetting | null> {
    return this.withCourseWriteLock(courseId, async () => {
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
              quizOnlyExternalTools: [],
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
            quizOnlyExternalTools: [],
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
    });
  }

  async resetQuizQuitPasswordToDefault(
    courseId: string,
    quizId: string
  ): Promise<QuizSebSetting | ContentSebSetting | null> {
    return this.withCourseWriteLock(courseId, async () => {
      const defaults = await this.getDefaults(courseId);
      const assessmentId = canonicalAssessmentId(quizId);
      const saved = await this.repositories.value.assessments.update(assessmentId, (record) => {
        if (!record || !matchesResetTarget(record, courseId, quizId, assessmentId)) {
          return null;
        }
        if (record.contentType !== "CLASSIC_QUIZ") {
          const existing = assessmentToContentSebSetting(record);
          const next = applyCourseDefaultsToContentSetting(
            { ...existing, quitPassword: null, quitPasswordOverride: false },
            defaults
          );
          this.assertAssessmentCanRunSeb(next);
          return assessmentWithContentSebSetting(record, {
            ...normalizeSebStartPasswordState(existing, next),
            configKey: null
          });
        }
        const existing = assessmentToQuizSebSetting(record);
        if (!existing) {
          return null;
        }
        const next = applyCourseDefaultsToQuizSetting(
          { ...existing, quitPassword: null, quitPasswordOverride: false },
          defaults
        );
        this.assertAssessmentCanRunSeb(next);
        return assessmentWithQuizSebSetting(record, {
          ...normalizeSebStartPasswordState(existing, next),
          configKey: null
        });
      });
      if (!saved) {
        return null;
      }
      return saved.contentType === "CLASSIC_QUIZ"
        ? assessmentToQuizSebSetting(saved)
        : assessmentToContentSebSetting(saved);
    });
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

function mergeInstructorCourseTools(
  existingTools: ExternalToolConfig[],
  submittedTools?: ExternalToolConfig[] | null
): ExternalToolConfig[] {
  if (!Array.isArray(submittedTools)) {
    return normalizeCourseExternalTools(existingTools);
  }
  const normalizedSubmitted = normalizeCourseExternalTools(submittedTools);
  const submittedById = new Map(normalizedSubmitted.map((tool) => [tool.id, tool]));
  const managed = normalizeCourseExternalTools(existingTools)
    .filter((tool) => tool.managedByAdmin === true && !!tool.adminPresetId)
    .map((tool) => ({ ...tool, enabled: submittedById.get(tool.id)?.enabled === true }));
  const managedIds = new Set(managed.map((tool) => tool.id));
  const local = normalizedSubmitted
    .filter((tool) => !managedIds.has(tool.id) && tool.managedByAdmin !== true)
    .map((tool) => ({ ...tool, managedByAdmin: false, adminPresetId: null }));
  return [...managed, ...local].slice(0, 16);
}

function adminManagedTool(preset: AdminToolPresetRecord): ExternalToolConfig {
  const [normalized] = normalizeCourseExternalTools([
    {
      ...preset.tool,
      id: `school-${preset.id}`,
      label: preset.name,
      enabled: false,
      preset: preset.tool.preset === YOUTUBE_VIDEO_TOOL_PRESET ? YOUTUBE_VIDEO_TOOL_PRESET : null,
      adminPresetId: preset.id,
      managedByAdmin: true
    }
  ]);
  if (!normalized) {
    throw new Error("Administrator tool preset is invalid");
  }
  return normalized;
}

function sameInstructorToolConfiguration(left: ExternalToolConfig, right: ExternalToolConfig): boolean {
  return JSON.stringify(instructorToolConfiguration(left)) === JSON.stringify(instructorToolConfiguration(right));
}

function instructorToolConfiguration(
  tool: ExternalToolConfig
): Omit<ExternalToolConfig, "id" | "adminPresetId" | "managedByAdmin"> {
  const [normalized] = normalizeCourseExternalTools([tool]);
  if (!normalized) {
    return {
      label: "",
      url: "",
      enabled: false,
      preset: null,
      allowedRules: [],
      allowedDomains: []
    };
  }
  return {
    label: normalized.label,
    url: normalized.url,
    enabled: normalized.enabled,
    preset: normalized.preset || null,
    allowedRules: normalized.allowedRules || [],
    allowedDomains: normalized.allowedDomains || []
  };
}

function availableCopiedToolId(sourceId: string, existingTools: ExternalToolConfig[]): string {
  const usedIds = new Set(existingTools.map((tool) => tool.id));
  if (!usedIds.has(sourceId)) {
    return sourceId;
  }
  const base = `${sourceId}-copy`;
  if (!usedIds.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
  // The course-level limit prevents this fallback in normal operation. Keep a
  // stable final candidate for malformed legacy data with many duplicates.
  return `${base}-101`;
}
