import { BadRequestException } from "@nestjs/common";
import {
  normalizeSebPassword,
  requireSebPasswordForConfiguration,
  sebPasswordPolicyMessage
} from "./seb-password-policy.js";

export const SEB_QUIT_PASSWORD_REQUIRED = "SEB_QUIT_PASSWORD_REQUIRED";
export const SEB_QUIT_PASSWORD_REQUIRED_MESSAGE =
  "Set a course or quiz exit password before enabling SEB. Assessment configurations require a password-protected native quit path.";
export const SEB_QUIT_PASSWORD_WEAK = "SEB_QUIT_PASSWORD_WEAK";

export interface SebQuitProtectedSetting {
  sebRequired: boolean;
  enabled: boolean;
  quitPassword?: string | null;
}

export function effectiveSebQuitPassword(
  assessmentPassword?: string | null,
  serverDefaultPassword?: string | null
): string | null {
  return normalizedPassword(assessmentPassword) || normalizedPassword(serverDefaultPassword);
}

export function hasEffectiveSebQuitPassword(
  assessmentPassword?: string | null,
  serverDefaultPassword?: string | null
): boolean {
  const password = effectiveSebQuitPassword(assessmentPassword, serverDefaultPassword);
  if (!password) {
    return false;
  }
  try {
    requireSebPasswordForConfiguration(password, "exit");
    return true;
  } catch {
    return false;
  }
}

export function requireSebQuitPassword(setting: SebQuitProtectedSetting, serverDefaultPassword?: string | null): void {
  if (!(setting.sebRequired || setting.enabled)) {
    return;
  }
  const effectivePassword = effectiveSebQuitPassword(setting.quitPassword, serverDefaultPassword);
  if (!effectivePassword) {
    throw new BadRequestException({
      success: false,
      statusCode: 400,
      error_code: SEB_QUIT_PASSWORD_REQUIRED,
      message: SEB_QUIT_PASSWORD_REQUIRED_MESSAGE
    });
  }
  if (!hasEffectiveSebQuitPassword(setting.quitPassword, serverDefaultPassword)) {
    throw new BadRequestException({
      success: false,
      statusCode: 400,
      error_code: SEB_QUIT_PASSWORD_WEAK,
      message: sebPasswordPolicyMessage("exit")
    });
  }
}

function normalizedPassword(value?: string | null): string | null {
  return normalizeSebPassword(value);
}
