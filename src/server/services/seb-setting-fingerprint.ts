import {
  enabledExternalTools,
  normalizeExternalTools,
  normalizeUrlRules,
  type ContentSebSetting,
  type QuizSebSetting
} from "../../shared/models.js";

type SebConfigSetting = Partial<QuizSebSetting & ContentSebSetting>;

export function invalidateConfigKeyIfSebConfigChanged<T extends SebConfigSetting>(existing: T | null, next: T): T {
  if (!existing?.configKey || next.configKey !== existing.configKey) {
    return next;
  }
  return sebConfigFingerprint(existing) === sebConfigFingerprint(next) ? next : { ...next, configKey: null };
}

export function hasSameSebConfigFingerprint(left: SebConfigSetting, right: SebConfigSetting): boolean {
  return sebConfigFingerprint(left) === sebConfigFingerprint(right);
}

export function sebConfigFingerprint(setting: SebConfigSetting): string {
  return JSON.stringify({
    courseId: setting.courseId || null,
    contentId: setting.contentId || null,
    quizId: setting.quizId || null,
    assignmentId: setting.assignmentId || null,
    canvasId: setting.canvasId || null,
    htmlUrl: setting.htmlUrl || null,
    canvasLaunchUrl: setting.canvasLaunchUrl || null,
    sebRequired: setting.sebRequired === true,
    enabled: setting.enabled === true,
    accessCode: setting.accessCode || null,
    quitPassword: setting.quitPassword || null,
    startPassword: setting.startPassword || null,
    configKeySalt: setting.configKeySalt || null,
    ssoDomains: setting.ssoDomains || [],
    educationalToolDomains: setting.educationalToolDomains || [],
    customDomains: setting.customDomains || [],
    urlRules: normalizeUrlRules(setting.urlRules),
    // Disabled course catalog entries are not part of a particular exam's
    // policy. Only resolved, selected tools bind the configuration/proof.
    externalTools: enabledExternalTools(normalizeExternalTools(setting.externalTools))
  });
}
