import { createHash, timingSafeEqual } from "node:crypto";
import { BadRequestException } from "@nestjs/common";

export const SEB_PASSWORD_MIN_LENGTH = 8;
export const SEB_PASSWORD_MAX_LENGTH = 128;
export const SEB_PASSWORD_POLICY_ERROR_CODE = "SEB_PASSWORD_POLICY_VIOLATION";
export const SEB_PASSWORD_REUSE_ERROR_CODE = "SEB_PASSWORD_REUSE";
export const SEB_PASSWORD_REUSE_MESSAGE =
  "Start and exit passwords must be different unique values. Do not give students the password that authorizes quitting SEB.";

export type SebPasswordPurpose = "exit" | "start";
export type SebPasswordPolicyViolation = "too-short" | "too-long" | "control-character" | "predictable";

const COMMON_PASSWORD_STEMS = [
  "admin",
  "administrator",
  "canvas",
  "changeme",
  "default",
  "exam",
  "exit",
  "letmein",
  "password",
  "passw0rd",
  "proctor",
  "qwerty",
  "quiz",
  "quit",
  "safeexambrowser",
  "school",
  "seb",
  "secret",
  "start",
  "student",
  "teacher",
  "test",
  "testing",
  "trustno1",
  "welcome"
] as const;

const COMMON_SEQUENCES = [
  "0123456789",
  "1234567890",
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "qwertyuiop",
  "poiuytrewq",
  "asdfghjkl",
  "lkjhgfdsa",
  "zxcvbnm",
  "mnbvcxz"
] as const;

export function normalizeSebPassword(value?: string | null): string | null {
  const normalized = value?.normalize("NFC").trim();
  return normalized ? normalized : null;
}

export function resolveSebPasswordUpdate(
  existing: string | null | undefined,
  next: string | null | undefined
): string | null {
  if (next === null) {
    return null;
  }
  return normalizeSebPassword(next) || normalizeSebPassword(existing);
}

export function sebPasswordPolicyViolation(value?: string | null): SebPasswordPolicyViolation | null {
  const password = normalizeSebPassword(value);
  if (!password) {
    return "too-short";
  }
  const length = Array.from(password).length;
  if (length < SEB_PASSWORD_MIN_LENGTH) {
    return "too-short";
  }
  if (length > SEB_PASSWORD_MAX_LENGTH) {
    return "too-long";
  }
  if (
    Array.from(password).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  ) {
    return "control-character";
  }

  const comparable = password.normalize("NFKC").toLowerCase();
  const compact = comparable.replace(/[^\p{L}\p{N}]/gu, "");
  const distinctCharacters = new Set(Array.from(compact)).size;
  if (
    !compact ||
    distinctCharacters < 5 ||
    /(.)\1{4,}/u.test(compact) ||
    /^(.{1,4})\1{2,}$/u.test(compact) ||
    COMMON_SEQUENCES.some((sequence) => sequence.includes(compact) || compact.includes(sequence)) ||
    COMMON_PASSWORD_STEMS.some((stem) => compact === stem || new RegExp(`^${stem}(?:20)?\\d{1,8}$`, "u").test(compact))
  ) {
    return "predictable";
  }
  return null;
}

export function sebPasswordPolicyMessage(
  purpose: SebPasswordPurpose,
  violation: SebPasswordPolicyViolation | null = null
): string {
  const label = purpose === "exit" ? "Exit" : "Start";
  if (violation === "too-short") {
    return `${label} password must be at least ${SEB_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (violation === "too-long") {
    return `${label} password must be no more than ${SEB_PASSWORD_MAX_LENGTH} characters.`;
  }
  if (violation === "control-character") {
    return `${label} password cannot contain control characters or line breaks.`;
  }
  return `${label} password must use at least 5 different letters or numbers and avoid common words, sequences, or repeated patterns. Letters-only and numbers-only passwords are allowed.`;
}

export function assertNewSebPassword(
  existing: string | null | undefined,
  next: string | null | undefined,
  purpose: SebPasswordPurpose
): void {
  const normalizedNext = normalizeSebPassword(next);
  if (!normalizedNext || normalizedNext === normalizeSebPassword(existing)) {
    return;
  }
  assertSebPassword(normalizedNext, purpose);
}

export function assertSebPassword(value: string, purpose: SebPasswordPurpose): string {
  const normalized = normalizeSebPassword(value);
  const violation = sebPasswordPolicyViolation(normalized);
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
  const violation = sebPasswordPolicyViolation(normalized);
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
