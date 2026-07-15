import { randomBytes } from "node:crypto";
import type { ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import { assertNewSebPassword, normalizeSebPassword, resolveSebPasswordUpdate } from "./seb-password-policy.js";

type SebStartPasswordSetting = Partial<QuizSebSetting & ContentSebSetting>;

const CONFIG_KEY_SALT_BYTES = 32;

export function normalizeSebStartPasswordState<T extends SebStartPasswordSetting>(existing: T | null, next: T): T {
  assertNewSebPassword(existing?.startPassword, next.startPassword, "start");
  const startPassword = resolveSebPasswordUpdate(existing?.startPassword, next.startPassword);
  if (!startPassword) {
    return {
      ...next,
      startPassword: null,
      configKeySalt: null
    };
  }

  const existingPassword = normalizeBlank(existing?.startPassword);
  const existingSalt = normalizeSalt(existing?.configKeySalt);
  const nextSalt = normalizeSalt(next.configKeySalt);
  const passwordChanged = startPassword !== existingPassword;
  const needsNewSalt = passwordChanged || (!nextSalt && !existingSalt);
  const configKeySalt =
    !passwordChanged && nextSalt ? nextSalt : !passwordChanged && existingSalt ? existingSalt : newConfigKeySalt();

  return {
    ...next,
    startPassword,
    configKeySalt,
    ...(needsNewSalt ? { configKey: null } : {})
  };
}

export function configKeySaltBuffer(value?: string | null): Buffer | null {
  const normalized = normalizeSalt(value);
  return normalized ? Buffer.from(normalized, "base64") : null;
}

export function newConfigKeySalt(): string {
  return randomBytes(CONFIG_KEY_SALT_BYTES).toString("base64");
}

function normalizeBlank(value?: string | null): string | null {
  return normalizeSebPassword(value);
}

function normalizeSalt(value?: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }
  try {
    const decoded = Buffer.from(value.trim(), "base64");
    return decoded.length === CONFIG_KEY_SALT_BYTES ? decoded.toString("base64") : null;
  } catch {
    return null;
  }
}
