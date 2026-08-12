import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
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
  courseRecordToDefaults,
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
import { CanvasApiService } from "./canvas-api.service.js";
import {
  AssessmentAccessCodeConsistencyError,
  AssessmentNoLongerAvailableError,
  AssessmentOperationInProgressError,
  AssessmentOperationLockLostError,
  CourseMutationInProgressError,
  CourseMutationOperationLockLostError,
  CourseResetInProgressError,
  CourseResetOperationLockLostError
} from "./assessment-errors.js";
import {
  type AccessCodeSetting,
  type OperationLease,
  assertPriorAccessCodeIsRecoverable,
  canvasGrantArgs,
  combineOperationLeases,
  compareAssessmentRecords,
  courseResetLockId,
  courseWriteLockId,
  generateAccessCode,
  hasNewerCanvasVerification,
  hasSameAccessCodeState,
  hasSameCanvasAccessState,
  isCanvasAssessmentCurrentlyAvailable,
  isDefinitiveCanvasRejection,
  isFreshCanvasVerification,
  mapInBatches
} from "./assessment-helpers.js";
import { hasSameSebConfigFingerprint, invalidateConfigKeyIfSebConfigChanged } from "./seb-setting-fingerprint.js";
import { normalizeSebStartPasswordState } from "./seb-start-password.js";
import { assertDistinctSebPasswords, assertNewSebPassword, resolveSebPasswordUpdate } from "./seb-password-policy.js";
import { effectiveSebQuitPassword, requireSebQuitPassword, type SebQuitProtectedSetting } from "./seb-quit-password.js";
import { resetCourseForAdmin, type CourseResetResult } from "./assessment-course-reset.js";

export interface CourseAssessmentContent {
  classicQuizzes: Quiz[];
  contentItems: ContentItem[];
  assessments: AssessmentRecord[];
}

type CourseWriteLockOptions =
  | { courseWriteLockHeld?: false; operationLease?: never }
  | { courseWriteLockHeld: true; operationLease: OperationLease };

type RefreshCourseContentOptions = CourseWriteLockOptions & {
  requireCompleteDiscovery?: boolean;
};

const ASSESSMENT_SYNC_WRITE_BATCH_SIZE = 50;

interface AccessCodeMutation<T extends AccessCodeSetting> {
  assertActive: () => void;
  applyCanvas: () => Promise<unknown>;
  restoreCanvas: () => Promise<unknown>;
  persist: () => Promise<T>;
  readCurrent: () => Promise<T | null>;
  prior: T | null;
  desired: T;
}

type AccessCodeMutationOptions = CourseWriteLockOptions;

export {
  AssessmentAccessCodeConsistencyError,
  AssessmentNoLongerAvailableError,
  AssessmentOperationInProgressError,
  AssessmentOperationLockLostError,
  CourseMutationInProgressError,
  CourseMutationOperationLockLostError,
  CourseResetAssessmentIdentityError,
  CourseResetCompensationError,
  CourseResetInProgressError,
  CourseResetOperationLockLostError,
  CourseResetOutcomeUnknownError
} from "./assessment-errors.js";
export {
  ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS,
  ASSESSMENT_VERIFICATION_MAX_AGE_MS,
  generateAccessCode
} from "./assessment-helpers.js";
export type { OperationLease } from "./assessment-helpers.js";
export type { CourseResetResult } from "./assessment-course-reset.js";

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
      return this.withCourseWriteLock(courseId, (operationLease) =>
        this.refreshCourseContent(courseId, userId, grantType, {
          ...options,
          courseWriteLockHeld: true,
          operationLease
        })
      );
    }
    const operationLease = options.operationLease;
    operationLease?.assertActive();
    const syncedAt = new Date().toISOString();
    const existingRecords = await this.getAssessmentRecordsForCourse(courseId);
    if (options.requireCompleteDiscovery) {
      // A reset must discover both assessment types before changing any cached
      // state. Keep this preflight read-only because the reset deletes the
      // records after disabling Canvas codes; a partial discovery write would
      // otherwise damage learner verification when persistence or the lease
      // fails before the destructive reset begins.
      const classicQuizzes = await this.canvasApi.getQuizzesForCourse(courseId, userId, ...canvasGrantArgs(grantType));
      operationLease?.assertActive();
      const newQuizzes = await this.canvasApi.getNewQuizAssignments(courseId, userId, ...canvasGrantArgs(grantType));
      operationLease?.assertActive();
      const existingById = new Map(existingRecords.map((record) => [record.id, record]));
      return this.toCourseAssessmentContent([
        ...classicQuizzes.map((quiz) => {
          const assessmentId = assessmentIdForClassicQuiz(quiz.canvasQuizId || quiz.id);
          const existing = existingById.get(assessmentId) || null;
          return this.mergeVerifiedCanvasRecord(quizToAssessmentRecord(quiz, existing, syncedAt), existing, syncedAt);
        }),
        ...newQuizzes.map((item) => {
          const assessmentId = canonicalAssessmentId(item.id);
          const existing = existingById.get(assessmentId) || null;
          return this.mergeVerifiedCanvasRecord(
            contentItemToAssessmentRecord(item, existing, syncedAt),
            existing,
            syncedAt
          );
        })
      ]);
    }

    // Deny learner release while a normal discovery pass is in flight. This
    // closes the window where an omitted cached assessment could otherwise
    // remain usable until the successful response was persisted as a tombstone.
    await Promise.all([
      this.markCanvasDiscoveryStale(existingRecords, "CLASSIC_QUIZ", syncedAt, operationLease),
      this.markCanvasDiscoveryStale(existingRecords, "NEW_QUIZ", syncedAt, operationLease)
    ]);
    const classicQuizzes = await this.canvasApi.getQuizzesForCourse(courseId, userId, ...canvasGrantArgs(grantType));
    operationLease?.assertActive();
    const classicIds = new Set(classicQuizzes.map((quiz) => assessmentIdForClassicQuiz(quiz.canvasQuizId || quiz.id)));
    const classicRecords = (
      await mapInBatches(classicQuizzes, ASSESSMENT_SYNC_WRITE_BATCH_SIZE, (quiz) => {
        operationLease?.assertActive();
        return this.repositories.value.assessments.update(
          assessmentIdForClassicQuiz(quiz.canvasQuizId || quiz.id),
          (existing) =>
            this.mergeVerifiedCanvasRecord(quizToAssessmentRecord(quiz, existing, syncedAt), existing, syncedAt)
        );
      })
    ).filter((record): record is AssessmentRecord => !!record);
    await this.markMissingCanvasAssessments(existingRecords, "CLASSIC_QUIZ", classicIds, syncedAt, operationLease);
    let contentRecords: AssessmentRecord[];
    let newQuizzes: ContentItem[];
    try {
      newQuizzes = await this.canvasApi.getNewQuizAssignments(courseId, userId, ...canvasGrantArgs(grantType));
      operationLease?.assertActive();
    } catch {
      contentRecords = existingRecords.filter((record) => record.contentType === "NEW_QUIZ");
      return this.toCourseAssessmentContent([...classicRecords, ...contentRecords]);
    }
    const newQuizIds = new Set(newQuizzes.map((item) => canonicalAssessmentId(item.id)));
    contentRecords = (
      await mapInBatches(newQuizzes, ASSESSMENT_SYNC_WRITE_BATCH_SIZE, (item) => {
        operationLease?.assertActive();
        return this.repositories.value.assessments.update(item.id, (existing) =>
          this.mergeVerifiedCanvasRecord(contentItemToAssessmentRecord(item, existing, syncedAt), existing, syncedAt)
        );
      })
    ).filter((record): record is AssessmentRecord => !!record);
    await this.markMissingCanvasAssessments(existingRecords, "NEW_QUIZ", newQuizIds, syncedAt, operationLease);
    return this.toCourseAssessmentContent([...classicRecords, ...contentRecords]);
  }

  async getAssessmentRecordsForCourse(courseId: string): Promise<AssessmentRecord[]> {
    return (await this.repositories.value.assessments.find([{ field: "courseId", op: "==", value: courseId }])).sort(
      compareAssessmentRecords
    );
  }

  async resetCourseForAdmin(courseId: string, userId: string, rootAccountId: string): Promise<CourseResetResult> {
    return resetCourseForAdmin(
      {
        repositories: this.repositories,
        canvasApi: this.canvasApi,
        refreshCourseContent: (targetCourseId, targetUserId, operationLease) =>
          this.refreshCourseContent(targetCourseId, targetUserId, "account_admin", {
            requireCompleteDiscovery: true,
            courseWriteLockHeld: true,
            operationLease
          }),
        withCourseResetLock: (targetCourseId, action) => this.withCourseResetLock(targetCourseId, action),
        withCourseWriteLock: (targetCourseId, action, allowDuringCourseReset) =>
          this.withCourseWriteLock(targetCourseId, action, allowDuringCourseReset),
        withAssessmentLock: (contentId, action, targetCourseId, allowDuringCourseReset) =>
          this.withAssessmentLock(contentId, action, targetCourseId, allowDuringCourseReset)
      },
      courseId,
      userId,
      rootAccountId
    );
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
    grantType: CanvasOAuthGrantType = "instructor",
    options: AccessCodeMutationOptions = {}
  ): Promise<QuizSebSetting> {
    return this.withAssessmentMutationLock(
      quizId,
      courseId,
      async (operationLease) => {
        const currentDefaults = await this.getCourseDefaultsForMutation(courseId, defaults);
        const accessCode = generateAccessCode();
        const existing = await this.getSebSettingForQuiz(quizId);
        if (!existing || existing.courseId !== courseId) {
          throw new AssessmentNoLongerAvailableError();
        }
        const next = applyCourseDefaultsToQuizSetting(
          {
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
          currentDefaults
        );
        this.assertAssessmentCanRunSeb(next);
        assertPriorAccessCodeIsRecoverable(existing);
        return this.commitAccessCodeMutation({
          assertActive: () => operationLease.assertActive(),
          applyCanvas: () =>
            this.canvasApi.setQuizAccessCode(courseId, quizId, accessCode, userId, ...canvasGrantArgs(grantType)),
          restoreCanvas: () => this.restoreClassicCanvasAccessCode(courseId, quizId, userId, existing, grantType),
          persist: () => this.saveQuizSebSetting(next),
          readCurrent: () => this.getSebSettingForQuiz(quizId),
          prior: existing,
          desired: next
        });
      },
      options
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
    grantType: CanvasOAuthGrantType = "instructor",
    options: AccessCodeMutationOptions = {}
  ): Promise<QuizSebSetting> {
    return this.withAssessmentMutationLock(
      quizId,
      courseId,
      async (operationLease) => {
        const existing = await this.getSebSettingForQuiz(quizId);
        if (!existing || existing.courseId !== courseId) {
          throw new AssessmentNoLongerAvailableError();
        }
        assertPriorAccessCodeIsRecoverable(existing);
        const disabled: QuizSebSetting = {
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
          assertActive: () => operationLease.assertActive(),
          applyCanvas: () =>
            this.canvasApi.removeQuizAccessCode(courseId, quizId, userId, ...canvasGrantArgs(grantType)),
          restoreCanvas: () => this.restoreClassicCanvasAccessCode(courseId, quizId, userId, existing, grantType),
          persist: () => this.saveQuizSebSetting(disabled),
          readCurrent: () => this.getSebSettingForQuiz(quizId),
          prior: existing,
          desired: disabled
        });
      },
      options
    );
  }

  async enableContentSebWithAccessCode(
    courseId: string,
    contentId: string,
    assignmentId: string,
    userId: string,
    defaults?: CourseSebDefaults | null,
    grantType: CanvasOAuthGrantType = "instructor",
    options: AccessCodeMutationOptions = {}
  ): Promise<ContentSebSetting> {
    return this.withAssessmentMutationLock(
      contentId,
      courseId,
      async (operationLease) => {
        const currentDefaults = await this.getCourseDefaultsForMutation(courseId, defaults);
        const existing = await this.getContentSebSetting(contentId);
        if (!existing || existing.courseId !== courseId || existing.assignmentId !== assignmentId) {
          throw new AssessmentNoLongerAvailableError();
        }
        const accessCode = generateAccessCode();
        const next = applyCourseDefaultsToContentSetting(
          {
            ...existing,
            sebRequired: true,
            enabled: true,
            accessCode,
            configKey: null
          },
          currentDefaults
        );
        this.assertAssessmentCanRunSeb(next);
        assertPriorAccessCodeIsRecoverable(existing);
        return this.commitAccessCodeMutation({
          assertActive: () => operationLease.assertActive(),
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
      options
    );
  }

  async disableContentSebWithAccessCode(
    courseId: string,
    contentId: string,
    assignmentId: string,
    userId: string,
    grantType: CanvasOAuthGrantType = "instructor",
    options: AccessCodeMutationOptions = {}
  ): Promise<ContentSebSetting> {
    return this.withAssessmentMutationLock(
      contentId,
      courseId,
      async (operationLease) => {
        const existing = await this.getContentSebSetting(contentId);
        if (!existing || existing.courseId !== courseId || existing.assignmentId !== assignmentId) {
          throw new AssessmentNoLongerAvailableError();
        }
        assertPriorAccessCodeIsRecoverable(existing);
        const disabled: ContentSebSetting = {
          ...existing,
          sebRequired: false,
          enabled: false,
          accessCode: null,
          configKey: null
        };
        return this.commitAccessCodeMutation({
          assertActive: () => operationLease.assertActive(),
          applyCanvas: () =>
            this.canvasApi.removeNewQuizAccessCode(courseId, assignmentId, userId, ...canvasGrantArgs(grantType)),
          restoreCanvas: () => this.restoreNewQuizCanvasAccessCode(courseId, assignmentId, userId, existing, grantType),
          persist: () => this.saveContentSebSetting(disabled),
          readCurrent: () => this.getContentSebSetting(contentId),
          prior: existing,
          desired: disabled
        });
      },
      options
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
      async (operationLease) => {
        const existing = await this.getSebSettingForQuiz(quizId);
        if (!existing?.sebRequired) {
          return null;
        }
        assertPriorAccessCodeIsRecoverable(existing);
        const accessCode = generateAccessCode();
        const next = { ...existing, accessCode, configKey: null };
        this.assertAssessmentCanRunSeb(next);
        return this.commitAccessCodeMutation({
          assertActive: () => operationLease.assertActive(),
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
      async (operationLease) => {
        const existing = await this.getContentSebSetting(contentId);
        if (!existing?.sebRequired) {
          return null;
        }
        assertPriorAccessCodeIsRecoverable(existing);
        const accessCode = generateAccessCode();
        const next = { ...existing, accessCode, configKey: null };
        this.assertAssessmentCanRunSeb(next);
        return this.commitAccessCodeMutation({
          assertActive: () => operationLease.assertActive(),
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
    action: (operationLease: OperationLease) => Promise<T>,
    courseId?: string,
    allowDuringCourseReset = false
  ): Promise<T> {
    const lockId = `assessment:${canonicalAssessmentId(contentId)}`;
    const run = (courseWriteLease?: OperationLease) =>
      this.withOperationLock(
        lockId,
        () => new AssessmentOperationInProgressError(),
        (cause) => new AssessmentOperationLockLostError(cause),
        (assessmentLease) =>
          action(courseWriteLease ? combineOperationLeases(courseWriteLease, assessmentLease) : assessmentLease)
      );
    return courseId && !allowDuringCourseReset ? this.withCourseWriteLock(courseId, run) : run();
  }

  private withAssessmentMutationLock<T>(
    contentId: string,
    courseId: string,
    action: (operationLease: OperationLease) => Promise<T>,
    options: AccessCodeMutationOptions
  ): Promise<T> {
    return options.courseWriteLockHeld
      ? this.withAssessmentLock(contentId, (assessmentLease) =>
          action(combineOperationLeases(options.operationLease, assessmentLease))
        )
      : this.withAssessmentLock(contentId, action, courseId);
  }

  private async getCourseDefaultsForMutation(
    courseId: string,
    fallback?: CourseSebDefaults | null
  ): Promise<CourseSebDefaults | null | undefined> {
    const current = await this.repositories.value.courses.get(courseId);
    return current ? courseRecordToDefaults(current, courseId) : fallback;
  }

  async withCourseWriteLock<T>(
    courseId: string,
    action: (operationLease: OperationLease) => Promise<T>,
    allowDuringCourseReset = false
  ): Promise<T> {
    if (!allowDuringCourseReset && (await this.isCourseResetInProgress(courseId))) {
      throw new CourseResetInProgressError();
    }
    return this.withOperationLock(
      courseWriteLockId(courseId),
      () => new CourseMutationInProgressError(),
      (cause) => new CourseMutationOperationLockLostError(cause),
      async (operationLease) => {
        if (!allowDuringCourseReset && (await this.isCourseResetInProgress(courseId))) {
          throw new CourseResetInProgressError();
        }
        operationLease.assertActive();
        return action(operationLease);
      }
    );
  }

  private withCourseResetLock<T>(courseId: string, action: (operationLease: OperationLease) => Promise<T>): Promise<T> {
    return this.withOperationLock(
      courseResetLockId(courseId),
      () => new CourseResetInProgressError(),
      (cause) => new CourseResetOperationLockLostError(cause),
      action
    );
  }

  async isCourseResetInProgress(courseId: string): Promise<boolean> {
    const lock = await this.repositories.value.operationLocks.get(courseResetLockId(courseId));
    return !!lock && new Date(lock.expiresAt).getTime() > Date.now();
  }

  private async withOperationLock<T>(
    lockId: string,
    unavailableError: () => Error,
    lostError: (cause?: unknown) => Error,
    action: (operationLease: OperationLease) => Promise<T>
  ): Promise<T> {
    const ownerId = randomUUID();
    const operationLocks = this.repositories.value.operationLocks;
    const acquired = await operationLocks.acquire(lockId, ownerId, this.lockTtlMs);
    if (!acquired) {
      throw unavailableError();
    }
    let renewalFailure: Error | null = null;
    let leaseExpiresAt = Date.now() + this.lockTtlMs;
    const operationLease: OperationLease = {
      assertActive: () => {
        if (!renewalFailure && Date.now() >= leaseExpiresAt) {
          renewalFailure = lostError();
        }
        if (renewalFailure) {
          throw renewalFailure;
        }
      }
    };
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
            } else {
              leaseExpiresAt = Date.now() + this.lockTtlMs;
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
      operationLease.assertActive();
      const result = await action(operationLease);
      operationLease.assertActive();
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
      try {
        await operationLocks.release(lockId, ownerId);
      } catch {
        // Ownership was already verified before the action result was accepted.
        // A failed cleanup must not replace that result; the bounded lease is
        // still safe because it expires automatically.
      }
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

  private async commitAccessCodeMutation<T extends AccessCodeSetting>(mutation: AccessCodeMutation<T>): Promise<T> {
    mutation.assertActive();
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
      mutation.assertActive();
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
    checkedAt: string,
    operationLease?: OperationLease
  ): Promise<void> {
    await mapInBatches(
      existingRecords.filter((record) => record.contentType === contentType && !presentIds.has(record.id)),
      ASSESSMENT_SYNC_WRITE_BATCH_SIZE,
      (record) => {
        operationLease?.assertActive();
        return this.markCanvasVerification(record.id, contentType, "missing", checkedAt);
      }
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
    checkedAt: string,
    operationLease?: OperationLease
  ): Promise<void> {
    await mapInBatches(
      existingRecords.filter(
        (record) => record.contentType === contentType && record.canvasVerification?.status !== "missing"
      ),
      ASSESSMENT_SYNC_WRITE_BATCH_SIZE,
      (record) => {
        operationLease?.assertActive();
        return this.markCanvasVerification(record.id, contentType, "stale", checkedAt);
      }
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
