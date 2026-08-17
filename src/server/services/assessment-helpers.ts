import { randomInt } from "node:crypto";
import type { AssessmentRecord, CanvasOAuthGrantType, ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import { isCanvasApiAuthorizationError, isCanvasApiPermissionError } from "./canvas-api.service.js";
import { AssessmentAccessCodeConsistencyError } from "./assessment-errors.js";

export const ASSESSMENT_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type AccessCodeSetting = Pick<
  QuizSebSetting | ContentSebSetting,
  "sebRequired" | "enabled" | "accessCode" | "configKey"
>;

export interface OperationLease {
  assertActive(): void;
}

export function assertPriorAccessCodeIsRecoverable(setting: AccessCodeSetting | null | undefined): void {
  if ((setting?.sebRequired || setting?.enabled) && !setting.accessCode) {
    throw new AssessmentAccessCodeConsistencyError(
      "The stored enabled assessment has no recoverable Canvas access code. Reconcile it before changing SEB state."
    );
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

export function compareAssessmentRecords(left: AssessmentRecord, right: AssessmentRecord): number {
  return (
    String(left.canvas.title || "").localeCompare(String(right.canvas.title || "")) || left.id.localeCompare(right.id)
  );
}

export function courseResetLockId(courseId: string): string {
  return `course-reset:${courseId}`;
}

export function courseWriteLockId(courseId: string): string {
  return `course-write:${courseId}`;
}

export function isCanvasAssessmentCurrentlyAvailable(record: AssessmentRecord): boolean {
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

export function isFreshCanvasVerification(record: AssessmentRecord): boolean {
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

export function combineOperationLeases(...leases: readonly OperationLease[]): OperationLease {
  return {
    assertActive() {
      for (const lease of leases) {
        lease.assertActive();
      }
    }
  };
}

export function hasNewerCanvasVerification(record: AssessmentRecord | null, candidateCheckedAt: string): boolean {
  const currentCheckedAt = Date.parse(record?.canvasVerification?.checkedAt || "");
  const candidate = Date.parse(candidateCheckedAt);
  return (
    Number.isFinite(currentCheckedAt) &&
    Number.isFinite(candidate) &&
    currentCheckedAt > candidate &&
    currentCheckedAt <= Date.now() + ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS
  );
}

export async function mapInBatches<T, R>(
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

export function isDefinitiveCanvasRejection(error: unknown): boolean {
  return isCanvasApiAuthorizationError(error) || isCanvasApiPermissionError(error);
}

export function hasSameAccessCodeState(
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

export function hasSameCanvasAccessState(
  left: AccessCodeSetting | null | undefined,
  right: AccessCodeSetting | null | undefined
): boolean {
  const leftEnabled = !!(left?.sebRequired || left?.enabled);
  const rightEnabled = !!(right?.sebRequired || right?.enabled);
  return leftEnabled === rightEnabled && (!leftEnabled || (left?.accessCode || null) === (right?.accessCode || null));
}

export function canvasGrantArgs(grantType: CanvasOAuthGrantType): [] | [CanvasOAuthGrantType] {
  return grantType === "instructor" ? [] : [grantType];
}
