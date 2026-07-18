import type { ContentSebSetting, CourseSebDefaults, QuizSebSetting } from "../../shared/models.js";
import { normalizeCourseExternalTools, normalizeExternalTools, normalizeUrlRules } from "../../shared/models.js";
import { hasEffectiveSebQuitPassword } from "../services/seb-quit-password.js";

type SebSetting = QuizSebSetting | ContentSebSetting;

export function toSebSettingView(
  setting: SebSetting,
  serverDefaultQuitPassword?: string | null
): Record<string, unknown> {
  const isContent = "contentId" in setting;
  return {
    id: setting.id || null,
    ...(isContent
      ? {
          contentId: setting.contentId,
          canvasId: setting.canvasId || null,
          assignmentId: setting.assignmentId || null,
          contentType: setting.contentType || "NEW_QUIZ",
          htmlUrl: setting.htmlUrl || null,
          canvasLaunchUrl: setting.canvasLaunchUrl || null
        }
      : { quizId: setting.quizId }),
    courseId: setting.courseId || null,
    sebRequired: setting.sebRequired === true,
    enabled: setting.enabled === true,
    externalToolUrl: setting.externalToolUrl || null,
    ssoDomains: [...(setting.ssoDomains || [])],
    educationalToolDomains: [...(setting.educationalToolDomains || [])],
    customDomains: [...(setting.customDomains || [])],
    urlRules: normalizeUrlRules(setting.urlRules),
    externalTools: normalizeExternalTools(setting.externalTools),
    quizOnlyExternalTools: normalizeExternalTools(setting.quizOnlyExternalTools),
    externalToolIds: setting.externalToolIds === undefined ? null : setting.externalToolIds,
    canvasDomain: "canvasDomain" in setting ? setting.canvasDomain || null : null,
    usesCourseDefaults: setting.usesCourseDefaults === true,
    quitPasswordOverride: setting.quitPasswordOverride === true,
    startPasswordOverride: setting.startPasswordOverride === true,
    hasAccessCode: !!setting.accessCode,
    hasConfigKey: !!setting.configKey,
    hasQuitPassword: !!setting.quitPassword,
    hasEffectiveQuitPassword: hasEffectiveSebQuitPassword(setting.quitPassword, serverDefaultQuitPassword),
    hasStartPassword: !!setting.startPassword,
    createdAt: setting.createdAt || null,
    updatedAt: setting.updatedAt || null
  };
}

export function toCourseDefaultsView(
  defaults: CourseSebDefaults,
  serverDefaultQuitPassword?: string | null
): Record<string, unknown> {
  return {
    id: defaults.id || null,
    courseId: defaults.courseId,
    setupCompleted: defaults.setupCompleted === true,
    urlRules: normalizeUrlRules(defaults.urlRules),
    externalTools: normalizeCourseExternalTools(defaults.externalTools),
    hasQuitPassword: !!defaults.quitPassword,
    hasEffectiveQuitPassword: hasEffectiveSebQuitPassword(defaults.quitPassword, serverDefaultQuitPassword),
    hasStartPassword: !!defaults.startPassword,
    createdAt: defaults.createdAt || null,
    updatedAt: defaults.updatedAt || null
  };
}
