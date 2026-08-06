import { randomInt, randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import type {
  AssessmentRecord,
  CanvasOAuthGrantType,
  ContentItem,
  ContentSebSetting,
  CourseSebDefaults,
  Quiz,
  QuizSebSetting,
  StructuredSebConfigRequest
} from "../../shared/models.js";
import {
  applyCourseDefaultsToContentSetting,
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
  extractClassicQuizId,
  normalizeExternalTools,
  normalizeExternalToolIds,
  normalizeUrlRules,
  parseNewQuizContentId,
  quizToAssessmentRecord,
  urlRulesToAllowedEntries
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";
import { CanvasApiService, isCanvasApiAuthorizationError, isCanvasApiPermissionError } from "./canvas-api.service.js";
import { hasSameSebConfigFingerprint, invalidateConfigKeyIfSebConfigChanged } from "./seb-setting-fingerprint.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";
import { assertDistinctSebPasswords, assertNewSebPassword, resolveSebPasswordUpdate } from "./seb-password-policy.js";
import { effectiveSebQuitPassword, requireSebQuitPassword, type SebQuitProtectedSetting } from "./seb-quit-password.js";

export interface CourseAssessmentContent {
  classicQuizzes: Quiz[];
  contentItems: ContentItem[];
  assessments: AssessmentRecord[];
}

export interface CourseResetResult {
  disabledAssessmentCount: number;
  deletedAssessmentCount: number;
  deletedTransientStateCount: number;
  deletedCourseRecordCount: number;
}

interface RefreshCourseContentOptions {
  requireCompleteDiscovery?: boolean;
  courseWriteLockHeld?: boolean;
}

interface CourseResetMutation {
  assessment: AssessmentRecord;
  disableCanvas: () => Promise<unknown>;
  restoreCanvas: () => Promise<unknown>;
}

export const ASSESSMENT_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ASSESSMENT_SYNC_WRITE_BATCH_SIZE = 50;

type AccessCodeSetting = Pick<
  QuizSebSetting | ContentSebSetting,
  "sebRequired" | "enabled" | "accessCode" | "configKey"
>;

interface AccessCodeMutation<T extends AccessCodeSetting> {
  applyCanvas: () => Promise<unknown>;
  restoreCanvas: () => Promise<unknown>;
  persist: () => Promise<T>;
  readCurrent: () => Promise<T | null>;
  prior: T | null;
  desired: T;
}

@Injectable()
export class AssessmentService {
  private readonly lockTtlMs = 30_000;

  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly canvasApi: CanvasApiService,
    private readonly config: AppConfig = new AppConfig()
  ) {}

  async refreshCourseContent(
    courseId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor",
    options: RefreshCourseContentOptions = {}
  ): Promise<CourseAssessmentContent> {
    if (!options.courseWriteLockHeld) {
      return this.withCourseWriteLock(courseId, () =>
        this.refreshCourseContent(courseId, userId, grantType, { ...options, courseWriteLockHeld: true })
      );
    }
    const syncedAt = new Date().toISOString();
    const existingRecords = await this.getAssessmentRecordsForCourse(courseId);
    // Deny learner release while a discovery pass is in flight. This closes
    // the window where an omitted cached assessment could otherwise remain
    // usable until the successful response was persisted as a tombstone.
    await Promise.all([
      this.markCanvasDiscoveryStale(existingRecords, "CLASSIC_QUIZ", syncedAt),
      this.markCanvasDiscoveryStale(existingRecords, "NEW_QUIZ", syncedAt)
    ]);
    const classicQuizzes = await this.canvasApi.getQuizzesForCourse(courseId, userId, ...canvasGrantArgs(grantType));
    const classicIds = new Set(classicQuizzes.map((quiz) => assessmentIdForClassicQuiz(quiz.canvasQuizId || quiz.id)));
    const classicRecords = (
      await mapInBatches(classicQuizzes, ASSESSMENT_SYNC_WRITE_BATCH_SIZE, (quiz) =>
        this.repositories.value.assessments.update(
          assessmentIdForClassicQuiz(quiz.canvasQuizId || quiz.id),
          (existing) =>
            this.mergeVerifiedCanvasRecord(quizToAssessmentRecord(quiz, existing, syncedAt), existing, syncedAt)
        )
      )
    ).filter((record): record is AssessmentRecord => !!record);
    await this.markMissingCanvasAssessments(existingRecords, "CLASSIC_QUIZ", classicIds, syncedAt);
    let contentRecords: AssessmentRecord[];
    let newQuizzes: ContentItem[];
    try {
      newQuizzes = await this.canvasApi.getNewQuizAssignments(courseId, userId, ...canvasGrantArgs(grantType));
    } catch (error) {
      if (options.requireCompleteDiscovery) {
        throw error;
      }
      contentRecords = existingRecords.filter((record) => record.contentType === "NEW_QUIZ");
      return this.toCourseAssessmentContent([...classicRecords, ...contentRecords]);
    }
    const newQuizIds = new Set(newQuizzes.map((item) => canonicalAssessmentId(item.id)));
    contentRecords = (
      await mapInBatches(newQuizzes, ASSESSMENT_SYNC_WRITE_BATCH_SIZE, (item) =>
        this.repositories.value.assessments.update(item.id, (existing) =>
          this.mergeVerifiedCanvasRecord(contentItemToAssessmentRecord(item, existing, syncedAt), existing, syncedAt)
        )
      )
    ).filter((record): record is AssessmentRecord => !!record);
    await this.markMissingCanvasAssessments(existingRecords, "NEW_QUIZ", newQuizIds, syncedAt);
    return this.toCourseAssessmentContent([...classicRecords, ...contentRecords]);
  }

  async getAssessmentRecordsForCourse(courseId: string): Promise<AssessmentRecord[]> {
    return (await this.repositories.value.assessments.find([{ field: "courseId", op: "==", value: courseId }])).sort(
      compareAssessmentRecords
    );
  }

  async resetCourseForAdmin(courseId: string, userId: string, rootAccountId: string): Promise<CourseResetResult> {
    return this.withCourseResetLock(courseId, () =>
      this.withCourseWriteLock(
        courseId,
        async () => {
          const discovered = await this.refreshCourseContent(courseId, userId, "account_admin", {
            requireCompleteDiscovery: true,
            courseWriteLockHeld: true
          });
          const mutations = discovered.assessments.map((assessment) =>
            this.courseResetMutation(assessment, courseId, userId)
          );
          const attempted: CourseResetMutation[] = [];
          try {
            for (const mutation of mutations) {
              await this.withAssessmentLock(
                mutation.assessment.id,
                async () => {
                  await mutation.disableCanvas();
                  attempted.push(mutation);
                  await this.repositories.value.assessments.update(mutation.assessment.id, (current) =>
                    current && current.courseId === courseId
                      ? {
                          ...current,
                          seb: {
                            ...current.seb,
                            required: false,
                            enabled: false,
                            accessCode: null,
                            configKey: null
                          }
                        }
                      : null
                  );
                },
                courseId,
                true
              );
            }
            const deleted = await this.repositories.resetCourseState(courseId, `${rootAccountId}:${courseId}`);
            return {
              disabledAssessmentCount: discovered.assessments.length,
              deletedAssessmentCount: deleted.assessmentCount,
              deletedTransientStateCount: deleted.transientStateCount,
              deletedCourseRecordCount: deleted.courseRecordCount
            };
          } catch (error) {
            await this.rollbackCourseReset(attempted, error);
            throw error;
          }
        },
        true
      )
    );
  }

  private courseResetMutation(assessment: AssessmentRecord, courseId: string, userId: string): CourseResetMutation {
    const parsed = parseNewQuizContentId(assessment.id);
    if (parsed) {
      const prior = assessmentToContentSebSetting(assessment);
      this.assertPriorAccessCodeIsRecoverable(prior);
      return {
        assessment,
        disableCanvas: () =>
          this.canvasApi.removeNewQuizAccessCode(
            courseId,
            parsed.assignmentId,
            userId,
            ...canvasGrantArgs("account_admin")
          ),
        restoreCanvas: () =>
          this.restoreNewQuizCanvasAccessCode(courseId, parsed.assignmentId, userId, prior, "account_admin")
      };
    }
    const quizId = assessment.canvas.quizId || extractClassicQuizId(assessment.id);
    const prior = assessmentToQuizSebSetting(assessment);
    if (!quizId || !prior) {
      throw new CourseResetAssessmentIdentityError();
    }
    this.assertPriorAccessCodeIsRecoverable(prior);
    return {
      assessment,
      disableCanvas: () =>
        this.canvasApi.removeQuizAccessCode(courseId, quizId, userId, ...canvasGrantArgs("account_admin")),
      restoreCanvas: () => this.restoreClassicCanvasAccessCode(courseId, quizId, userId, prior, "account_admin")
    };
  }

  private async rollbackCourseReset(mutations: CourseResetMutation[], cause: unknown): Promise<void> {
    const compensationErrors: unknown[] = [];
    for (const mutation of mutations.slice().reverse()) {
      try {
        await mutation.restoreCanvas();
      } catch (error) {
        compensationErrors.push(error);
      }
      try {
        await this.repositories.value.assessments.save(mutation.assessment.id, mutation.assessment);
      } catch (error) {
        compensationErrors.push(error);
      }
    }
    if (compensationErrors.length) {
      throw new CourseResetCompensationError(cause, compensationErrors);
    }
  }

  async getAssessmentRecord(id: string): Promise<AssessmentRecord | null> {
    return this.repositories.value.assessments.get(canonicalAssessmentId(id));
  }

  async isAssessmentAvailableForLearner(courseId: string, contentId: string): Promise<boolean> {
    const canonicalId = canonicalAssessmentId(contentId);
    const record = await this.repositories.value.assessments.get(canonicalId);
    if (
      !record ||
      record.id !== canonicalId ||
      record.courseId !== courseId ||
      record.canvasVerification?.status !== "verified" ||
      !isFreshCanvasVerification(record) ||
      !isCanvasAssessmentCurrentlyAvailable(record)
    ) {
      return false;
    }
    const parsed = parseNewQuizContentId(canonicalId);
    if (parsed) {
      return (
        record.contentType === "NEW_QUIZ" &&
        record.canvas.assignmentId === parsed.assignmentId &&
        record.canvas.id === parsed.assignmentId
      );
    }
    const quizId = extractClassicQuizId(canonicalId);
    return !!quizId && record.contentType === "CLASSIC_QUIZ" && (record.canvas.quizId || record.canvas.id) === quizId;
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
    const saved = await this.repositories.value.assessments.update(
      assessmentIdForClassicQuiz(quizId),
      (existingRecord) => {
        const existingSetting = existingRecord ? assessmentToQuizSebSetting(existingRecord) : null;
        const normalized: QuizSebSetting = {
          ...setting,
          id: quizId,
          quizId,
          ssoDomains: setting.ssoDomains || [],
          educationalToolDomains: setting.educationalToolDomains || [],
          customDomains: setting.customDomains || [],
          urlRules: normalizeUrlRules(setting.urlRules),
          externalTools: normalizeExternalTools(setting.externalTools),
          quizOnlyExternalTools: normalizeExternalTools(setting.quizOnlyExternalTools),
          externalToolIds: normalizeExternalToolIds(setting.externalToolIds),
          quitPassword: resolveSebPasswordUpdate(existingSetting?.quitPassword, setting.quitPassword)
        };
        assertNewSebPassword(existingSetting?.quitPassword, normalized.quitPassword, "exit");
        const withStartPassword = normalizeSebStartPasswordState(existingSetting, normalized);
        this.assertAssessmentCanRunSeb(withStartPassword);
        const nextSetting = invalidateConfigKeyIfSebConfigChanged(existingSetting, withStartPassword);
        return assessmentWithQuizSebSetting(existingRecord, nextSetting);
      }
    );
    const result = saved ? assessmentToQuizSebSetting(saved) : null;
    if (!result) {
      throw new Error("Saved assessment is not a Classic Quiz");
    }
    return result;
  }

  async saveContentSebSetting(setting: ContentSebSetting): Promise<ContentSebSetting> {
    const saved = await this.repositories.value.assessments.update(setting.contentId, (existingRecord) => {
      const existingSetting = existingRecord ? assessmentToContentSebSetting(existingRecord) : null;
      const normalized: ContentSebSetting = {
        ...setting,
        id: setting.contentId,
        contentId: setting.contentId,
        ssoDomains: setting.ssoDomains || [],
        educationalToolDomains: setting.educationalToolDomains || [],
        customDomains: setting.customDomains || [],
        urlRules: normalizeUrlRules(setting.urlRules),
        externalTools: normalizeExternalTools(setting.externalTools),
        quizOnlyExternalTools: normalizeExternalTools(setting.quizOnlyExternalTools),
        externalToolIds: normalizeExternalToolIds(setting.externalToolIds),
        quitPassword: resolveSebPasswordUpdate(existingSetting?.quitPassword, setting.quitPassword)
      };
      assertNewSebPassword(existingSetting?.quitPassword, normalized.quitPassword, "exit");
      const withStartPassword = normalizeSebStartPasswordState(existingSetting, normalized);
      this.assertAssessmentCanRunSeb(withStartPassword);
      const nextSetting = invalidateConfigKeyIfSebConfigChanged(existingSetting, withStartPassword);
      return assessmentWithContentSebSetting(existingRecord, nextSetting);
    });
    if (!saved) {
      throw new Error("Saved assessment is missing");
    }
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
        externalTools: normalizeExternalTools(existing.externalTools),
        externalToolIds: normalizeExternalToolIds(existing.externalToolIds)
      };
    }
    return {
      ...defaultContentSebSetting(contentId, courseId),
      htmlUrl: `${this.canvasApi.getCanvasDomain()}/courses/${courseId}/assignments/${assignmentId}`
    };
  }

  async updateSebConfigurationStructured(request: StructuredSebConfigRequest): Promise<QuizSebSetting> {
    if (!request.quizId) {
      throw new Error("quizId is required");
    }
    if (request.externalTools !== undefined) {
      throw new Error("Exam tool definitions are managed in Course settings");
    }
    const existing = await this.getSebSettingForQuiz(request.quizId);
    return this.saveQuizSebSetting({
      ...defaultQuizSebSetting(request.quizId),
      ...existing,
      id: request.quizId,
      quizId: request.quizId,
      // Policy edits never toggle enforcement. Only the Canvas access-code commit workflow may do that.
      sebRequired: existing?.sebRequired === true,
      enabled: existing?.enabled === true,
      ssoDomains: request.ssoDomains || [],
      educationalToolDomains: request.educationalToolDomains || [],
      customDomains: request.customDomains || urlRulesToAllowedEntries(request.urlRules),
      urlRules: normalizeUrlRules(request.urlRules),
      externalTools: normalizeExternalTools(existing?.externalTools),
      externalToolIds: normalizeExternalToolIds(request.externalToolIds),
      externalToolUrl: request.externalToolUrl || existing?.externalToolUrl || null,
      quitPassword: resolveSebPasswordUpdate(existing?.quitPassword, request.quitPassword),
      startPassword: resolveSebPasswordUpdate(existing?.startPassword, request.startPassword),
      usesCourseDefaults: request.usesCourseDefaults === true,
      quitPasswordOverride: request.quitPasswordOverride === true,
      startPasswordOverride: request.startPasswordOverride === true
    });
  }

  async enableSebWithAccessCode(
    courseId: string,
    quizId: string,
    userId: string,
    defaults?: CourseSebDefaults | null,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<QuizSebSetting> {
    return this.withAssessmentLock(
      quizId,
      async () => {
        const accessCode = generateAccessCode();
        const existing = await this.getSebSettingForQuiz(quizId);
        const next = applyCourseDefaultsToQuizSetting(
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
            ssoDomains: existing?.ssoDomains || [],
            educationalToolDomains: existing?.educationalToolDomains || [],
            customDomains: existing?.customDomains || [],
            urlRules: normalizeUrlRules(existing?.urlRules),
            externalTools: normalizeExternalTools(existing?.externalTools),
            externalToolIds: normalizeExternalToolIds(existing?.externalToolIds)
          },
          defaults
        );
        this.assertAssessmentCanRunSeb(next);
        this.assertPriorAccessCodeIsRecoverable(existing);
        return this.commitAccessCodeMutation({
          applyCanvas: () =>
            this.canvasApi.setQuizAccessCode(courseId, quizId, accessCode, userId, ...canvasGrantArgs(grantType)),
          restoreCanvas: () => this.restoreClassicCanvasAccessCode(courseId, quizId, userId, existing, grantType),
          persist: () => this.saveQuizSebSetting(next),
          readCurrent: () => this.getSebSettingForQuiz(quizId),
          prior: existing,
          desired: next
        });
      },
      courseId
    );
  }

  assertAssessmentCanRunSeb(setting: SebQuitProtectedSetting & { startPassword?: string | null }): void {
    assertDistinctSebPasswords(
      setting.startPassword,
      effectiveSebQuitPassword(setting.quitPassword, this.config.value.seb.defaultQuitPassword)
    );
    requireSebQuitPassword(setting, this.config.value.seb.defaultQuitPassword);
  }

  async disableSebWithAccessCode(
    courseId: string,
    quizId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<QuizSebSetting> {
    return this.withAssessmentLock(
      quizId,
      async () => {
        const existing = await this.getSebSettingForQuiz(quizId);
        this.assertPriorAccessCodeIsRecoverable(existing);
        const disabled: QuizSebSetting = {
          ...defaultQuizSebSetting(quizId, courseId),
          ...existing,
          id: quizId,
          quizId,
          courseId,
          sebRequired: false,
          enabled: false,
          accessCode: null,
          configKey: null
        };
        return this.commitAccessCodeMutation({
          applyCanvas: () =>
            this.canvasApi.removeQuizAccessCode(courseId, quizId, userId, ...canvasGrantArgs(grantType)),
          restoreCanvas: () => this.restoreClassicCanvasAccessCode(courseId, quizId, userId, existing, grantType),
          persist: () => this.saveQuizSebSetting(disabled),
          readCurrent: () => this.getSebSettingForQuiz(quizId),
          prior: existing,
          desired: disabled
        });
      },
      courseId
    );
  }

  async enableContentSebWithAccessCode(
    courseId: string,
    contentId: string,
    assignmentId: string,
    userId: string,
    defaults?: CourseSebDefaults | null,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<ContentSebSetting> {
    return this.withAssessmentLock(
      contentId,
      async () => {
        const existing = await this.getContentSebSetting(contentId);
        const setting = existing || (await this.getOrCreateContentSebSetting(contentId, courseId, assignmentId));
        const accessCode = generateAccessCode();
        const next = applyCourseDefaultsToContentSetting(
          {
            ...setting,
            sebRequired: true,
            enabled: true,
            accessCode,
            configKey: null
          },
          defaults
        );
        this.assertAssessmentCanRunSeb(next);
        this.assertPriorAccessCodeIsRecoverable(existing);
        return this.commitAccessCodeMutation({
          applyCanvas: () =>
            this.canvasApi.setNewQuizAccessCode(
              courseId,
              assignmentId,
              accessCode,
              userId,
              ...canvasGrantArgs(grantType)
            ),
          restoreCanvas: () => this.restoreNewQuizCanvasAccessCode(courseId, assignmentId, userId, existing, grantType),
          persist: () => this.saveContentSebSetting(next),
          readCurrent: () => this.getContentSebSetting(contentId),
          prior: existing,
          desired: next
        });
      },
      courseId
    );
  }

  async disableContentSebWithAccessCode(
    courseId: string,
    contentId: string,
    assignmentId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<ContentSebSetting> {
    return this.withAssessmentLock(
      contentId,
      async () => {
        const existing = await this.getContentSebSetting(contentId);
        const setting = existing || (await this.getOrCreateContentSebSetting(contentId, courseId, assignmentId));
        this.assertPriorAccessCodeIsRecoverable(existing);
        const disabled: ContentSebSetting = {
          ...setting,
          sebRequired: false,
          enabled: false,
          accessCode: null,
          configKey: null
        };
        return this.commitAccessCodeMutation({
          applyCanvas: () =>
            this.canvasApi.removeNewQuizAccessCode(courseId, assignmentId, userId, ...canvasGrantArgs(grantType)),
          restoreCanvas: () => this.restoreNewQuizCanvasAccessCode(courseId, assignmentId, userId, existing, grantType),
          persist: () => this.saveContentSebSetting(disabled),
          readCurrent: () => this.getContentSebSetting(contentId),
          prior: existing,
          desired: disabled
        });
      },
      courseId
    );
  }

  async regenerateQuizAccessCode(
    courseId: string,
    quizId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<QuizSebSetting | null> {
    return this.withAssessmentLock(
      quizId,
      async () => {
        const existing = await this.getSebSettingForQuiz(quizId);
        if (!existing?.sebRequired) {
          return null;
        }
        this.assertPriorAccessCodeIsRecoverable(existing);
        const accessCode = generateAccessCode();
        const next = { ...existing, accessCode, configKey: null };
        this.assertAssessmentCanRunSeb(next);
        return this.commitAccessCodeMutation({
          applyCanvas: () =>
            this.canvasApi.setQuizAccessCode(courseId, quizId, accessCode, userId, ...canvasGrantArgs(grantType)),
          restoreCanvas: () => this.restoreClassicCanvasAccessCode(courseId, quizId, userId, existing, grantType),
          persist: () => this.saveQuizSebSetting(next),
          readCurrent: () => this.getSebSettingForQuiz(quizId),
          prior: existing,
          desired: next
        });
      },
      courseId
    );
  }

  async regenerateContentAccessCode(
    courseId: string,
    contentId: string,
    assignmentId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor"
  ): Promise<ContentSebSetting | null> {
    return this.withAssessmentLock(
      contentId,
      async () => {
        const existing = await this.getContentSebSetting(contentId);
        if (!existing?.sebRequired) {
          return null;
        }
        this.assertPriorAccessCodeIsRecoverable(existing);
        const accessCode = generateAccessCode();
        const next = { ...existing, accessCode, configKey: null };
        this.assertAssessmentCanRunSeb(next);
        return this.commitAccessCodeMutation({
          applyCanvas: () =>
            this.canvasApi.setNewQuizAccessCode(
              courseId,
              assignmentId,
              accessCode,
              userId,
              ...canvasGrantArgs(grantType)
            ),
          restoreCanvas: () => this.restoreNewQuizCanvasAccessCode(courseId, assignmentId, userId, existing, grantType),
          persist: () => this.saveContentSebSetting(next),
          readCurrent: () => this.getContentSebSetting(contentId),
          prior: existing,
          desired: next
        });
      },
      courseId
    );
  }

  async saveQuizConfigKeyIfUnchanged(setting: QuizSebSetting, configKey: string): Promise<QuizSebSetting | null> {
    const saved = await this.repositories.value.assessments.update(
      assessmentIdForClassicQuiz(setting.quizId),
      (existingRecord) => {
        if (!existingRecord) {
          return null;
        }
        const existingSetting = assessmentToQuizSebSetting(existingRecord);
        if (!existingSetting || !hasSameSebConfigFingerprint(existingSetting, setting)) {
          return null;
        }
        return assessmentWithQuizSebSetting(existingRecord, { ...existingSetting, configKey });
      }
    );
    return saved ? assessmentToQuizSebSetting(saved) : null;
  }

  async ensureQuizConfigKeySaltIfUnchanged(setting: QuizSebSetting): Promise<QuizSebSetting | null> {
    const saved = await this.repositories.value.assessments.update(
      assessmentIdForClassicQuiz(setting.quizId),
      (existingRecord) => {
        if (!existingRecord) {
          return null;
        }
        const existingSetting = assessmentToQuizSebSetting(existingRecord);
        if (!existingSetting || !hasSameSebConfigFingerprint(existingSetting, setting)) {
          return null;
        }
        return assessmentWithQuizSebSetting(
          existingRecord,
          normalizeSebStartPasswordState(existingSetting, existingSetting)
        );
      }
    );
    return saved ? assessmentToQuizSebSetting(saved) : null;
  }

  async saveContentConfigKeyIfUnchanged(
    setting: ContentSebSetting,
    configKey: string
  ): Promise<ContentSebSetting | null> {
    const saved = await this.repositories.value.assessments.update(setting.contentId, (existingRecord) => {
      if (!existingRecord) {
        return null;
      }
      const existingSetting = assessmentToContentSebSetting(existingRecord);
      if (!hasSameSebConfigFingerprint(existingSetting, setting)) {
        return null;
      }
      return assessmentWithContentSebSetting(existingRecord, { ...existingSetting, configKey });
    });
    return saved ? assessmentToContentSebSetting(saved) : null;
  }

  async ensureContentConfigKeySaltIfUnchanged(setting: ContentSebSetting): Promise<ContentSebSetting | null> {
    const saved = await this.repositories.value.assessments.update(setting.contentId, (existingRecord) => {
      if (!existingRecord) {
        return null;
      }
      const existingSetting = assessmentToContentSebSetting(existingRecord);
      if (!hasSameSebConfigFingerprint(existingSetting, setting)) {
        return null;
      }
      return assessmentWithContentSebSetting(
        existingRecord,
        normalizeSebStartPasswordState(existingSetting, existingSetting)
      );
    });
    return saved ? assessmentToContentSebSetting(saved) : null;
  }

  async withAssessmentLock<T>(
    contentId: string,
    action: () => Promise<T>,
    courseId?: string,
    allowDuringCourseReset = false
  ): Promise<T> {
    const lockId = `assessment:${canonicalAssessmentId(contentId)}`;
    const run = () =>
      this.withOperationLock(
        lockId,
        () => new AssessmentOperationInProgressError(),
        (cause) => new AssessmentOperationLockLostError(cause),
        action
      );
    return courseId && !allowDuringCourseReset ? this.withCourseWriteLock(courseId, run) : run();
  }

  async withCourseWriteLock<T>(courseId: string, action: () => Promise<T>, allowDuringCourseReset = false): Promise<T> {
    if (!allowDuringCourseReset && (await this.courseResetInProgress(courseId))) {
      throw new CourseResetInProgressError();
    }
    return this.withOperationLock(
      courseWriteLockId(courseId),
      () => new CourseMutationInProgressError(),
      (cause) => new CourseMutationOperationLockLostError(cause),
      async () => {
        if (!allowDuringCourseReset && (await this.courseResetInProgress(courseId))) {
          throw new CourseResetInProgressError();
        }
        return action();
      }
    );
  }

  private withCourseResetLock<T>(courseId: string, action: () => Promise<T>): Promise<T> {
    return this.withOperationLock(
      courseResetLockId(courseId),
      () => new CourseResetInProgressError(),
      (cause) => new CourseResetOperationLockLostError(cause),
      action
    );
  }

  private async courseResetInProgress(courseId: string): Promise<boolean> {
    const lock = await this.repositories.value.operationLocks.get(courseResetLockId(courseId));
    return !!lock && new Date(lock.expiresAt).getTime() > Date.now();
  }

  private async withOperationLock<T>(
    lockId: string,
    unavailableError: () => Error,
    lostError: (cause?: unknown) => Error,
    action: () => Promise<T>
  ): Promise<T> {
    const ownerId = randomUUID();
    const operationLocks = this.repositories.value.operationLocks;
    const acquired = await operationLocks.acquire(lockId, ownerId, this.lockTtlMs);
    if (!acquired) {
      throw unavailableError();
    }
    let renewalFailure: Error | null = null;
    let renewalInFlight: Promise<void> | null = null;
    const renewalTimer = setInterval(
      () => {
        if (renewalInFlight || renewalFailure) {
          return;
        }
        renewalInFlight = operationLocks
          .renew(lockId, ownerId, this.lockTtlMs)
          .then((renewed) => {
            if (!renewed) {
              renewalFailure = lostError();
            }
          })
          .catch((error: unknown) => {
            renewalFailure = lostError(error);
          })
          .finally(() => {
            renewalInFlight = null;
          });
      },
      Math.max(1, Math.floor(this.lockTtlMs / 3))
    );
    try {
      const result = await action();
      clearInterval(renewalTimer);
      if (renewalInFlight) {
        await renewalInFlight;
      }
      if (renewalFailure) {
        throw renewalFailure;
      }
      let stillOwned: boolean;
      try {
        stillOwned = await operationLocks.renew(lockId, ownerId, this.lockTtlMs);
      } catch (error) {
        throw lostError(error);
      }
      if (!stillOwned) {
        throw lostError();
      }
      return result;
    } finally {
      clearInterval(renewalTimer);
      if (renewalInFlight) {
        await renewalInFlight;
      }
      await operationLocks.release(lockId, ownerId);
    }
  }

  async validateSebConfiguration(quizId: string): Promise<boolean> {
    const setting = await this.getSebSettingForQuiz(quizId);
    if (!setting?.sebRequired || !setting.accessCode) {
      return false;
    }
    try {
      this.assertAssessmentCanRunSeb(setting);
      return true;
    } catch {
      return false;
    }
  }

  private assertPriorAccessCodeIsRecoverable(setting: AccessCodeSetting | null | undefined): void {
    if ((setting?.sebRequired || setting?.enabled) && !setting.accessCode) {
      throw new AssessmentAccessCodeConsistencyError(
        "The stored enabled assessment has no recoverable Canvas access code. Reconcile it before changing SEB state."
      );
    }
  }

  private async commitAccessCodeMutation<T extends AccessCodeSetting>(mutation: AccessCodeMutation<T>): Promise<T> {
    try {
      await mutation.applyCanvas();
    } catch (error) {
      if (isDefinitiveCanvasRejection(error) || hasSameCanvasAccessState(mutation.prior, mutation.desired)) {
        throw error;
      }
      await this.compensateCanvasMutation(mutation.restoreCanvas, error);
      throw error;
    }

    try {
      return await mutation.persist();
    } catch (error) {
      let current: T | null;
      try {
        current = await mutation.readCurrent();
      } catch (verificationError) {
        throw new AssessmentAccessCodeConsistencyError(
          "Canvas changed, but the stored access-code state could not be verified. Manual reconciliation is required.",
          error,
          verificationError
        );
      }
      if (hasSameAccessCodeState(current, mutation.desired)) {
        return current!;
      }
      if (hasSameAccessCodeState(current, mutation.prior)) {
        await this.compensateCanvasMutation(mutation.restoreCanvas, error);
        throw error;
      }
      throw new AssessmentAccessCodeConsistencyError(
        "Canvas changed, but persistence contains an unexpected access-code state. Manual reconciliation is required.",
        error
      );
    }
  }

  private async compensateCanvasMutation(restoreCanvas: () => Promise<unknown>, cause: unknown): Promise<void> {
    try {
      await restoreCanvas();
    } catch (compensationError) {
      throw new AssessmentAccessCodeConsistencyError(
        "The Canvas access-code change could not be rolled back. Manual reconciliation is required.",
        cause,
        compensationError
      );
    }
  }

  private restoreClassicCanvasAccessCode(
    courseId: string,
    quizId: string,
    userId: string,
    prior: QuizSebSetting | null,
    grantType: CanvasOAuthGrantType
  ): Promise<unknown> {
    return prior?.sebRequired || prior?.enabled
      ? this.canvasApi.setQuizAccessCode(courseId, quizId, prior.accessCode!, userId, ...canvasGrantArgs(grantType))
      : this.canvasApi.removeQuizAccessCode(courseId, quizId, userId, ...canvasGrantArgs(grantType));
  }

  private restoreNewQuizCanvasAccessCode(
    courseId: string,
    assignmentId: string,
    userId: string,
    prior: ContentSebSetting | null,
    grantType: CanvasOAuthGrantType
  ): Promise<unknown> {
    return prior?.sebRequired || prior?.enabled
      ? this.canvasApi.setNewQuizAccessCode(
          courseId,
          assignmentId,
          prior.accessCode!,
          userId,
          ...canvasGrantArgs(grantType)
        )
      : this.canvasApi.removeNewQuizAccessCode(courseId, assignmentId, userId, ...canvasGrantArgs(grantType));
  }

  private toCourseAssessmentContent(records: AssessmentRecord[]): CourseAssessmentContent {
    const sorted = records.sort(compareAssessmentRecords);
    return {
      assessments: sorted,
      classicQuizzes: sorted.map(assessmentToQuiz).filter((quiz): quiz is Quiz => !!quiz),
      contentItems: sorted.map(assessmentToContentItem)
    };
  }

  private async markMissingCanvasAssessments(
    existingRecords: AssessmentRecord[],
    contentType: "CLASSIC_QUIZ" | "NEW_QUIZ",
    presentIds: ReadonlySet<string>,
    checkedAt: string
  ): Promise<void> {
    await mapInBatches(
      existingRecords.filter((record) => record.contentType === contentType && !presentIds.has(record.id)),
      ASSESSMENT_SYNC_WRITE_BATCH_SIZE,
      (record) => this.markCanvasVerification(record.id, contentType, "missing", checkedAt)
    );
  }

  private mergeVerifiedCanvasRecord(
    refreshed: AssessmentRecord,
    current: AssessmentRecord | null,
    checkedAt: string
  ): AssessmentRecord {
    if (current && hasNewerCanvasVerification(current, checkedAt)) {
      return current;
    }
    return refreshed;
  }

  private async markCanvasDiscoveryStale(
    existingRecords: AssessmentRecord[],
    contentType: "CLASSIC_QUIZ" | "NEW_QUIZ",
    checkedAt: string
  ): Promise<void> {
    await mapInBatches(
      existingRecords.filter(
        (record) => record.contentType === contentType && record.canvasVerification?.status !== "missing"
      ),
      ASSESSMENT_SYNC_WRITE_BATCH_SIZE,
      (record) => this.markCanvasVerification(record.id, contentType, "stale", checkedAt)
    );
  }

  private async markCanvasVerification(
    assessmentId: string,
    contentType: "CLASSIC_QUIZ" | "NEW_QUIZ",
    status: "missing" | "stale",
    checkedAt: string
  ): Promise<void> {
    await this.repositories.value.assessments.update(assessmentId, (current) => {
      if (!current || current.contentType !== contentType) {
        return current;
      }
      if (hasNewerCanvasVerification(current, checkedAt)) {
        return current;
      }
      if (status === "stale" && current.canvasVerification?.status === "missing") {
        return current;
      }
      return {
        ...current,
        canvasVerification: {
          status,
          checkedAt,
          lastVerifiedAt: current.canvasVerification?.lastVerifiedAt || current.lastSyncedAt || null
        }
      };
    });
  }
}

export class AssessmentAccessCodeConsistencyError extends Error {
  constructor(
    message: string,
    cause?: unknown,
    readonly compensationError?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AssessmentAccessCodeConsistencyError";
  }
}

export class AssessmentOperationLockLostError extends Error {
  constructor(cause?: unknown) {
    super(
      "The assessment update lock was lost before the operation completed. The result was not accepted as successful; verify the assessment state before retrying.",
      cause === undefined ? undefined : { cause }
    );
    this.name = "AssessmentOperationLockLostError";
  }
}

export class AssessmentOperationInProgressError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "ASSESSMENT_UPDATE_IN_PROGRESS",
      message: "Another SEB update is already in progress for this assessment. Try again shortly."
    });
    this.name = "AssessmentOperationInProgressError";
  }
}

export class CourseResetInProgressError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "COURSE_RESET_IN_PROGRESS",
      message: "A Canvas administrator is resetting this course. Wait for the reset to finish, then try again."
    });
    this.name = "CourseResetInProgressError";
  }
}

export class CourseResetAssessmentIdentityError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "COURSE_RESET_ASSESSMENT_IDENTITY_UNAVAILABLE",
      message:
        "Canvas did not provide an assessment identifier required for reset. Course records were not deleted; refresh the course and retry."
    });
    this.name = "CourseResetAssessmentIdentityError";
  }
}

export class CourseResetCompensationError extends Error {
  constructor(
    cause: unknown,
    readonly compensationErrors: readonly unknown[]
  ) {
    super(
      "One or more Canvas assessment access codes could not be restored after the course reset stopped. Manual verification is required.",
      { cause }
    );
    this.name = "CourseResetCompensationError";
  }
}

export class CourseMutationInProgressError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "COURSE_UPDATE_IN_PROGRESS",
      message: "Another course update is already in progress. Wait for it to finish, then try again."
    });
    this.name = "CourseMutationInProgressError";
  }
}

export class CourseMutationOperationLockLostError extends ConflictException {
  constructor(cause?: unknown) {
    super(
      {
        success: false,
        statusCode: 409,
        error_code: "COURSE_UPDATE_VERIFY_REQUIRED",
        message: "The course update could not be confirmed. Refresh the course and verify its current settings."
      },
      cause === undefined ? undefined : { cause }
    );
    this.name = "CourseMutationOperationLockLostError";
  }
}

export class CourseResetOperationLockLostError extends Error {
  constructor(cause?: unknown) {
    super(
      "The course reset lock was lost before completion could be confirmed. The reset may have completed; refresh the course and verify Canvas assessment access codes before retrying.",
      cause === undefined ? undefined : { cause }
    );
    this.name = "CourseResetOperationLockLostError";
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

function compareAssessmentRecords(left: AssessmentRecord, right: AssessmentRecord): number {
  return (
    String(left.canvas.title || "").localeCompare(String(right.canvas.title || "")) || left.id.localeCompare(right.id)
  );
}

function courseResetLockId(courseId: string): string {
  return `course-reset:${courseId}`;
}

function courseWriteLockId(courseId: string): string {
  return `course-write:${courseId}`;
}

function isCanvasAssessmentCurrentlyAvailable(record: AssessmentRecord): boolean {
  if (record.canvas.published !== true) {
    return false;
  }
  const now = Date.now();
  if (record.canvas.unlockAt) {
    const unlockAt = Date.parse(record.canvas.unlockAt);
    if (!Number.isFinite(unlockAt) || now < unlockAt) {
      return false;
    }
  }
  if (record.canvas.lockAt) {
    const lockAt = Date.parse(record.canvas.lockAt);
    if (!Number.isFinite(lockAt) || now >= lockAt) {
      return false;
    }
  }
  return true;
}

function isFreshCanvasVerification(record: AssessmentRecord): boolean {
  const checkedAtValue = record.canvasVerification?.checkedAt;
  const lastVerifiedAtValue = record.canvasVerification?.lastVerifiedAt;
  if (!checkedAtValue || !lastVerifiedAtValue) {
    return false;
  }
  const checkedAt = Date.parse(checkedAtValue);
  const lastVerifiedAt = Date.parse(lastVerifiedAtValue);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(lastVerifiedAt) || checkedAt !== lastVerifiedAt) {
    return false;
  }
  const age = Date.now() - checkedAt;
  return age <= ASSESSMENT_VERIFICATION_MAX_AGE_MS && age >= -ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS;
}

function hasNewerCanvasVerification(record: AssessmentRecord | null, candidateCheckedAt: string): boolean {
  const currentCheckedAt = Date.parse(record?.canvasVerification?.checkedAt || "");
  const candidate = Date.parse(candidateCheckedAt);
  return (
    Number.isFinite(currentCheckedAt) &&
    Number.isFinite(candidate) &&
    currentCheckedAt > candidate &&
    currentCheckedAt <= Date.now() + ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS
  );
}

async function mapInBatches<T, R>(
  values: readonly T[],
  batchSize: number,
  action: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    results.push(...(await Promise.all(values.slice(offset, offset + batchSize).map(action))));
  }
  return results;
}

function isDefinitiveCanvasRejection(error: unknown): boolean {
  return isCanvasApiAuthorizationError(error) || isCanvasApiPermissionError(error);
}

function hasSameAccessCodeState(
  left: AccessCodeSetting | null | undefined,
  right: AccessCodeSetting | null | undefined
): boolean {
  if (!left || !right) {
    return !left && !right;
  }
  return (
    left.sebRequired === right.sebRequired &&
    left.enabled === right.enabled &&
    (left.accessCode || null) === (right.accessCode || null) &&
    (left.configKey || null) === (right.configKey || null)
  );
}

function hasSameCanvasAccessState(
  left: AccessCodeSetting | null | undefined,
  right: AccessCodeSetting | null | undefined
): boolean {
  const leftEnabled = !!(left?.sebRequired || left?.enabled);
  const rightEnabled = !!(right?.sebRequired || right?.enabled);
  return leftEnabled === rightEnabled && (!leftEnabled || (left?.accessCode || null) === (right?.accessCode || null));
}

function canvasGrantArgs(grantType: CanvasOAuthGrantType): [] | [CanvasOAuthGrantType] {
  return grantType === "instructor" ? [] : [grantType];
}
