import { createHash, timingSafeEqual } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import {
  normalizeSebPassword,
  sebPasswordPolicyMessage,
  sebPasswordPolicyViolation
} from "../../shared/seb-password-policy.js";
import type { SebPasswordPurpose } from "../../shared/seb-password-policy.js";

export {
  evaluateSebPasswordRequirements,
  normalizeSebPassword,
  SEB_PASSWORD_MAX_LENGTH,
  SEB_PASSWORD_MIN_LENGTH,
  sebPasswordPolicyMessage,
  sebPasswordPolicyViolation
} from "../../shared/seb-password-policy.js";
export type { SebPasswordPurpose, SebPasswordPolicyViolation } from "../../shared/seb-password-policy.js";

export const SEB_PASSWORD_POLICY_ERROR_CODE = "SEB_PASSWORD_POLICY_VIOLATION";
export const SEB_PASSWORD_REUSE_ERROR_CODE = "SEB_PASSWORD_REUSE";
export const SEB_PASSWORD_REUSE_MESSAGE =
  "Start and exit passwords must be different unique values. Do not give students the password that authorizes quitting SEB.";

export function resolveSebPasswordUpdate(
  existing: string | null | undefined,
  next: string | null | undefined
): string | null {
  if (next === null) {
    return null;
  }
  if (isBlankPasswordUpdate(next)) {
    return normalizeSebPassword(existing);
  }
  if (sebPasswordPolicyViolation(next) === "control-character") {
    return next?.normalize("NFC") || null;
  }
  return normalizeSebPassword(next) || normalizeSebPassword(existing);
}

export function assertNewSebPassword(
  existing: string | null | undefined,
  next: string | null | undefined,
  purpose: SebPasswordPurpose
): void {
  if (isBlankPasswordUpdate(next)) {
    return;
  }
  if (sebPasswordPolicyViolation(next) === "control-character") {
    assertSebPassword(next || "", purpose);
  }
  const normalizedNext = normalizeSebPassword(next);
  if (!normalizedNext || normalizedNext === normalizeSebPassword(existing)) {
    return;
  }
  assertSebPassword(normalizedNext, purpose);
}

export function assertSebPassword(value: string, purpose: SebPasswordPurpose): string {
  const normalized = normalizeSebPassword(value);
  const violation = sebPasswordPolicyViolation(value);
  if (!normalized || violation) {
    throw new BadRequestException({
      success: false,
      statusCode: 400,
      error_code: SEB_PASSWORD_POLICY_ERROR_CODE,
      message: sebPasswordPolicyMessage(purpose, violation || "too-short")
    });
  }
  return normalized;
}

export function sebPasswordsMatch(left?: string | null, right?: string | null): boolean {
  const normalizedLeft = normalizeSebPassword(left);
  const normalizedRight = normalizeSebPassword(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return timingSafeEqual(passwordComparisonDigest(normalizedLeft), passwordComparisonDigest(normalizedRight));
}

export function assertDistinctSebPasswords(startPassword?: string | null, quitPassword?: string | null): void {
  if (!sebPasswordsMatch(startPassword, quitPassword)) {
    return;
  }
  throw new BadRequestException({
    success: false,
    statusCode: 400,
    error_code: SEB_PASSWORD_REUSE_ERROR_CODE,
    message: SEB_PASSWORD_REUSE_MESSAGE
  });
}

export function requireSebPasswordForConfiguration(value: string, purpose: SebPasswordPurpose): string {
  const normalized = normalizeSebPassword(value);
  const violation = sebPasswordPolicyViolation(value);
  if (!normalized || violation) {
    throw new Error(sebPasswordPolicyMessage(purpose, violation || "too-short"));
  }
  return normalized;
}

export function requireDistinctSebPasswordsForConfiguration(
  startPassword?: string | null,
  quitPassword?: string | null
): void {
  if (sebPasswordsMatch(startPassword, quitPassword)) {
    throw new Error(SEB_PASSWORD_REUSE_MESSAGE);
  }
}

function passwordComparisonDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isBlankPasswordUpdate(value: string | null | undefined): boolean {
  return value == null || /^[ \t]*$/u.test(value);
}
