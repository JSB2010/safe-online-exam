import {
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

function sebConfigFingerprint(setting: SebConfigSetting): string {
  return JSON.stringify({
    courseId: setting.courseId || null,
    contentId: setting.contentId || null,
    quizId: setting.quizId || null,
    assignmentId: setting.assignmentId || null,
    canvasId: setting.canvasId || null,
    canvasAssignmentId: setting.canvasAssignmentId || null,
    htmlUrl: setting.htmlUrl || null,
    canvasLaunchUrl: setting.canvasLaunchUrl || null,
    sebRequired: setting.sebRequired === true,
    enabled: setting.enabled === true,
    accessCode: setting.accessCode || null,
    quitPassword: setting.quitPassword || null,
    ssoDomains: setting.ssoDomains || [],
    educationalToolDomains: setting.educationalToolDomains || [],
    customDomains: setting.customDomains || [],
    urlRules: normalizeUrlRules(setting.urlRules),
    externalTools: normalizeExternalTools(setting.externalTools)
  });
}
