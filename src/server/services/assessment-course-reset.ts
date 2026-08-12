import { randomUUID } from "node:crypto";
import type { AssessmentRecord } from "../../shared/models.js";
import {
  assessmentToContentSebSetting,
  assessmentToQuizSebSetting,
  extractClassicQuizId,
  parseNewQuizContentId
} from "../../shared/models.js";
import type { RepositoryProvider } from "../data/repositories.js";
import type { CanvasApiService } from "./canvas-api.service.js";
import {
  CourseResetAssessmentIdentityError,
  CourseResetCompensationError,
  CourseResetOutcomeUnknownError
} from "./assessment-errors.js";
import {
  type OperationLease,
  assertPriorAccessCodeIsRecoverable,
  canvasGrantArgs,
  combineOperationLeases,
  isDefinitiveCanvasRejection
} from "./assessment-helpers.js";

export interface CourseResetResult {
  disabledAssessmentCount: number;
  deletedAssessmentCount: number;
  deletedTransientStateCount: number;
  deletedCourseRecordCount: number;
  deletedPresetAssignmentCount: number;
}

interface CourseResetMutation {
  assessment: AssessmentRecord;
  priorAssessment: AssessmentRecord | null;
  disableCanvas: () => Promise<unknown>;
  restoreCanvas: () => Promise<unknown>;
}

interface CourseResetContext {
  repositories: RepositoryProvider;
  canvasApi: CanvasApiService;
  refreshCourseContent: (
    courseId: string,
    userId: string,
    operationLease: OperationLease
  ) => Promise<{ assessments: AssessmentRecord[] }>;
  withCourseResetLock: <T>(courseId: string, action: (operationLease: OperationLease) => Promise<T>) => Promise<T>;
  withCourseWriteLock: <T>(
    courseId: string,
    action: (operationLease: OperationLease) => Promise<T>,
    allowDuringCourseReset: boolean
  ) => Promise<T>;
  withAssessmentLock: <T>(
    contentId: string,
    action: (operationLease: OperationLease) => Promise<T>,
    courseId: string,
    allowDuringCourseReset: boolean
  ) => Promise<T>;
}

export async function resetCourseForAdmin(
  context: CourseResetContext,
  courseId: string,
  userId: string,
  rootAccountId: string
): Promise<CourseResetResult> {
  return context.withCourseResetLock(courseId, (resetLease) =>
    context.withCourseWriteLock(
      courseId,
      async (courseWriteLease) => {
        const resetOperationLease = combineOperationLeases(resetLease, courseWriteLease);
        const discovered = await context.refreshCourseContent(courseId, userId, resetOperationLease);
        const mutations: CourseResetMutation[] = [];
        for (const assessment of discovered.assessments) {
          resetOperationLease.assertActive();
          mutations.push(await courseResetMutation(context, assessment, courseId, userId, resetOperationLease));
        }
        const attempted: CourseResetMutation[] = [];
        let resetOperationId: string | null = null;
        try {
          for (const mutation of mutations) {
            await context.withAssessmentLock(
              mutation.assessment.id,
              async (assessmentLease) => {
                const mutationLease = combineOperationLeases(resetOperationLease, assessmentLease);
                mutationLease.assertActive();
                try {
                  await mutation.disableCanvas();
                } catch (error) {
                  if (!isDefinitiveCanvasRejection(error)) {
                    attempted.push(mutation);
                  }
                  throw error;
                }
                attempted.push(mutation);
                mutationLease.assertActive();
                await context.repositories.value.assessments.update(mutation.assessment.id, (current) =>
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
          resetOperationLease.assertActive();
          resetOperationId = randomUUID();
          const deleted = await context.repositories.resetCourseState(
            courseId,
            `${rootAccountId}:${courseId}`,
            resetOperationId
          );
          return resetResult(discovered.assessments.length, deleted);
        } catch (error) {
          if (resetOperationId) {
            let committed;
            try {
              committed = await context.repositories.getCourseResetOutcome(
                `${rootAccountId}:${courseId}`,
                resetOperationId,
                courseId
              );
            } catch (verificationError) {
              throw new CourseResetOutcomeUnknownError(error, verificationError);
            }
            if (committed) {
              return resetResult(discovered.assessments.length, committed);
            }
          }
          await rollbackCourseReset(context.repositories, attempted, error);
          throw error;
        }
      },
      true
    )
  );
}

function resetResult(
  disabledAssessmentCount: number,
  deleted: {
    assessmentCount: number;
    transientStateCount: number;
    courseRecordCount: number;
    presetAssignmentCount: number;
  }
): CourseResetResult {
  return {
    disabledAssessmentCount,
    deletedAssessmentCount: deleted.assessmentCount,
    deletedTransientStateCount: deleted.transientStateCount,
    deletedCourseRecordCount: deleted.courseRecordCount,
    deletedPresetAssignmentCount: deleted.presetAssignmentCount
  };
}

async function courseResetMutation(
  context: Pick<CourseResetContext, "repositories" | "canvasApi">,
  assessment: AssessmentRecord,
  courseId: string,
  userId: string,
  operationLease: OperationLease
): Promise<CourseResetMutation> {
  const priorAssessment = await context.repositories.value.assessments.get(assessment.id);
  operationLease.assertActive();
  const parsed = parseNewQuizContentId(assessment.id);
  if (parsed) {
    assertPriorAccessCodeIsRecoverable(assessmentToContentSebSetting(assessment));
    const canvasAccessCode = await context.canvasApi.getNewQuizAccessCode(
      courseId,
      parsed.assignmentId,
      userId,
      ...canvasGrantArgs("account_admin")
    );
    operationLease.assertActive();
    return {
      assessment,
      priorAssessment,
      disableCanvas: () =>
        context.canvasApi.removeNewQuizAccessCode(
          courseId,
          parsed.assignmentId,
          userId,
          ...canvasGrantArgs("account_admin")
        ),
      restoreCanvas: () =>
        canvasAccessCode
          ? context.canvasApi.setNewQuizAccessCode(
              courseId,
              parsed.assignmentId,
              canvasAccessCode,
              userId,
              ...canvasGrantArgs("account_admin")
            )
          : context.canvasApi.removeNewQuizAccessCode(
              courseId,
              parsed.assignmentId,
              userId,
              ...canvasGrantArgs("account_admin")
            )
    };
  }
  const quizId = assessment.canvas.quizId || extractClassicQuizId(assessment.id);
  const prior = assessmentToQuizSebSetting(assessment);
  if (!quizId || !prior) {
    throw new CourseResetAssessmentIdentityError();
  }
  assertPriorAccessCodeIsRecoverable(prior);
  const canvasAccessCode = await context.canvasApi.getQuizAccessCode(
    courseId,
    quizId,
    userId,
    ...canvasGrantArgs("account_admin")
  );
  operationLease.assertActive();
  return {
    assessment,
    priorAssessment,
    disableCanvas: () =>
      context.canvasApi.removeQuizAccessCode(courseId, quizId, userId, ...canvasGrantArgs("account_admin")),
    restoreCanvas: () =>
      canvasAccessCode
        ? context.canvasApi.setQuizAccessCode(
            courseId,
            quizId,
            canvasAccessCode,
            userId,
            ...canvasGrantArgs("account_admin")
          )
        : context.canvasApi.removeQuizAccessCode(courseId, quizId, userId, ...canvasGrantArgs("account_admin"))
  };
}

async function rollbackCourseReset(
  repositories: RepositoryProvider,
  mutations: CourseResetMutation[],
  cause: unknown
): Promise<void> {
  const compensationErrors: unknown[] = [];
  for (const mutation of mutations.slice().reverse()) {
    try {
      await mutation.restoreCanvas();
    } catch (error) {
      compensationErrors.push(error);
    }
    try {
      if (mutation.priorAssessment) {
        await repositories.value.assessments.save(mutation.assessment.id, mutation.priorAssessment);
      } else {
        await repositories.value.assessments.delete(mutation.assessment.id);
      }
    } catch (error) {
      compensationErrors.push(error);
    }
  }
  if (compensationErrors.length) {
    throw new CourseResetCompensationError(cause, compensationErrors);
  }
}
