export const SEB_PASSWORD_MIN_LENGTH = 8;
export const SEB_PASSWORD_MAX_LENGTH = 128;

export type SebPasswordPurpose = "exit" | "start";
export type SebPasswordPolicyViolation = "too-short" | "too-long" | "control-character" | "predictable";

export interface SebPasswordRequirementState {
  hasAllowedLength: boolean;
  hasNoControlCharacters: boolean;
  hasEnoughDistinctCharacters: boolean;
  avoidsPredictablePatterns: boolean;
  differsFromOtherPassword: boolean;
  valid: boolean;
}

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
  const input = value?.normalize("NFC");
  if (!input || hasProhibitedPasswordCharacter(input)) {
    return null;
  }
  const normalized = input.trim();
  return normalized ? normalized : null;
}

export function evaluateSebPasswordRequirements(
  value?: string | null,
  otherPassword?: string | null
): SebPasswordRequirementState {
  const input = value?.normalize("NFC") || "";
  const hasNoControlCharacters = !hasProhibitedPasswordCharacter(input);
  const password = hasNoControlCharacters ? input.trim() : "";
  const length = Array.from(password).length;
  const compact = password
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
  const hasEnoughDistinctCharacters = new Set(Array.from(compact)).size >= 5;
  const avoidsPredictablePatterns =
    !!compact &&
    !/(.)\1{4,}/u.test(compact) &&
    !/^(.{1,4})\1{2,}$/u.test(compact) &&
    !COMMON_SEQUENCES.some((sequence) => sequence.includes(compact) || compact.includes(sequence)) &&
    !COMMON_PASSWORD_STEMS.some(
      (stem) => compact === stem || new RegExp(`^${stem}(?:20)?\\d{1,8}$`, "u").test(compact)
    );
  const normalizedOther = normalizeSebPassword(otherPassword);
  const differsFromOtherPassword = !normalizedOther || password !== normalizedOther;
  const hasAllowedLength = length >= SEB_PASSWORD_MIN_LENGTH && length <= SEB_PASSWORD_MAX_LENGTH;
  return {
    hasAllowedLength,
    hasNoControlCharacters,
    hasEnoughDistinctCharacters,
    avoidsPredictablePatterns,
    differsFromOtherPassword,
    valid:
      hasAllowedLength &&
      hasNoControlCharacters &&
      hasEnoughDistinctCharacters &&
      avoidsPredictablePatterns &&
      differsFromOtherPassword
  };
}

export function sebPasswordPolicyViolation(value?: string | null): SebPasswordPolicyViolation | null {
  const input = value?.normalize("NFC");
  if (input && hasProhibitedPasswordCharacter(input)) {
    return "control-character";
  }
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
  const requirements = evaluateSebPasswordRequirements(password);
  if (!requirements.hasNoControlCharacters) {
    return "control-character";
  }
  if (!requirements.hasEnoughDistinctCharacters || !requirements.avoidsPredictablePatterns) {
    return "predictable";
  }
  return null;
}

function hasProhibitedPasswordCharacter(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
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
    return `${label} password cannot contain control, invisible formatting, or line-separator characters.`;
  }
  return `${label} password must use at least 5 different letters or numbers and avoid common words, sequences, or repeated patterns. Letters-only and numbers-only passwords are allowed.`;
}
