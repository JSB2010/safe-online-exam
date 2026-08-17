import type { CourseSebDefaults, ExternalToolAccessRule, ExternalToolConfig, SebUrlRule } from "../../shared/models.js";
import {
  legacyDomainsToUrlRules,
  normalizeCourseSebDefaults,
  normalizeUrlRules,
  YOUTUBE_VIDEO_TOOL_PRESET
} from "../../shared/models.js";
import { clientId } from "./id.js";

export function normalizeCourseDefaults(input: any, courseId: string): CourseSebDefaults {
  const normalized = normalizeCourseSebDefaults({
    ...input,
    id: input?.id || courseId,
    courseId: input?.courseId || courseId,
    externalToolsInitialized: true
  });
  return {
    ...normalized,
    quitPassword: normalized.quitPassword || "",
    startPassword: normalized.startPassword || "",
    hasQuitPassword: input?.hasQuitPassword === true,
    hasEffectiveQuitPassword: input?.hasEffectiveQuitPassword === true,
    hasStartPassword: input?.hasStartPassword === true
  };
}

export function rulesForSetting(setting: Record<string, any>, defaults: CourseSebDefaults): SebUrlRule[] {
  if (setting.usesCourseDefaults !== false) {
    return normalizeUrlRules(defaults.urlRules);
  }
  const explicit = normalizeUrlRules(setting.urlRules);
  if (explicit.length) {
    return explicit;
  }
  return legacyDomainsToUrlRules(setting.customDomains || []);
}

export function newCustomTool(): ExternalToolConfig {
  return {
    id: clientId("tool"),
    label: "",
    url: "",
    enabled: false,
    allowedRules: []
  };
}

export function newYoutubeVideoTool(id = clientId("youtube-video")): ExternalToolConfig {
  return {
    id,
    label: "YouTube video",
    url: "",
    enabled: false,
    preset: YOUTUBE_VIDEO_TOOL_PRESET,
    allowedRules: []
  };
}

export function newToolAccessRule(): ExternalToolAccessRule {
  return {
    id: clientId("tool-resource"),
    value: "",
    match: "path"
  };
}

export function newUrlRule(): SebUrlRule {
  return {
    id: clientId("url"),
    value: "",
    match: "domain"
  };
}
