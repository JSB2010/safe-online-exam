import { randomInt } from "node:crypto";
import type { AssessmentRecord, CanvasOAuthGrantType, ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import { isCanvasApiAuthorizationError, isCanvasApiPermissionError } from "./canvas-api.service.js";
import { AssessmentAccessCodeConsistencyError } from "./assessment-errors.js";

export const ASSESSMENT_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ASSESSMENT_VERIFICATION_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type AssessmentReadinessStatus =
  | "ready"
  | "configured_unpublished"
  | "not_yet_open"
  | "closed"
  | "publication_conflict"
  | "publication_unknown"
  | "canvas_stale"
  | "canvas_missing"
  | "settings_incomplete";

export interface AssessmentReadiness {
  status: AssessmentReadinessStatus;
  configured: boolean;
  globallyReady: boolean;
  studentLaunchAuthorized: boolean | null;
  publicationStatus: "published" | "unpublished" | "conflict" | "unknown";
  publicationConfidence: "complete" | "single_source" | "unavailable";
  verifiedAt: string | null;
  unlockAt: string | null;
  lockAt: string | null;
}

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
  return evaluateAssessmentReadiness(record).globallyReady;
}

export function evaluateAssessmentReadiness(
  record: AssessmentRecord,
  options: { hasEffectiveQuitPassword?: boolean } = {}
): AssessmentReadiness {
  const configured =
    record.seb.required === true &&
    record.seb.enabled === true &&
    !!record.seb.accessCode &&
    (!record.seb.startPassword || !!record.seb.configKeySalt) &&
    options.hasEffectiveQuitPassword !== false;
  // Boolean-only legacy rows cannot tell whether Canvas returned an explicit
  // value or the old normalizer collapsed missing/malformed data to false.
  // Keep them unknown until the next complete Canvas refresh records evidence.
  const publicationStatus = record.canvas.publication?.status || "unknown";
  const result = (status: AssessmentReadinessStatus, globallyReady = false): AssessmentReadiness => ({
    status: !configured && status === "ready" ? "settings_incomplete" : status,
    configured,
    globallyReady,
    studentLaunchAuthorized: null,
    publicationStatus,
    publicationConfidence: record.canvas.publication?.confidence || "unavailable",
    verifiedAt: record.canvasVerification?.lastVerifiedAt || record.canvasVerification?.checkedAt || null,
    unlockAt: record.canvas.unlockAt || null,
    lockAt: record.canvas.lockAt || null
  });
  if (record.canvasVerification?.status === "missing") {
    return result("canvas_missing");
  }
  if (record.canvasVerification?.status !== "verified" || !isFreshCanvasVerification(record)) {
    return result("canvas_stale");
  }
  if (publicationStatus === "conflict") {
    return result("publication_conflict");
  }
  if (publicationStatus === "unknown") {
    return result("publication_unknown");
  }
  if (publicationStatus === "unpublished" || record.canvas.published !== true) {
    return result("configured_unpublished");
  }
  const now = Date.now();
  if (record.canvas.unlockAt) {
    const unlockAt = Date.parse(record.canvas.unlockAt);
    if (!Number.isFinite(unlockAt) || now < unlockAt) {
      return result(Number.isFinite(unlockAt) ? "not_yet_open" : "publication_unknown");
    }
  }
  if (record.canvas.lockAt) {
    const lockAt = Date.parse(record.canvas.lockAt);
    if (!Number.isFinite(lockAt) || now >= lockAt) {
      return result(Number.isFinite(lockAt) ? "closed" : "publication_unknown");
    }
  }
  return result("ready", true);
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
