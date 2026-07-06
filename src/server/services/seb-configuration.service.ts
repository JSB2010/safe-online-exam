import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import plist from "plist";
import { AppConfig } from "../config/app-config.js";

export interface SebConfigurationInput {
  courseId: string;
  contentId: string;
  startUrl: string;
  accessCode: string;
  allowedDomains?: string[];
  quitPassword?: string | null;
}

interface UrlFilterRule {
  active: boolean;
  regex: boolean;
  expression: string;
  action: number;
}

@Injectable()
export class SebConfigurationService {
  constructor(private readonly config: AppConfig) {}

  generateSebConfiguration(input: SebConfigurationInput): Buffer {
    const appBaseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!appBaseUrl) {
      throw new Error("Application base URL is required to generate SEB configuration");
    }
    const canvasBaseUrl = this.config.getCanvasDomain();
    const quitPassword = input.quitPassword || this.config.value.seb.defaultQuitPassword || null;
    const plistValue: Record<string, unknown> = {
      sebConfigPurpose: 0,
      originatorVersion: "3.7.0",
      startURL: input.startUrl,
      allowQuit: !!quitPassword,
      ignoreQuitPassword: !quitPassword,
      hashedQuitPassword: quitPassword ? sha256Hex(quitPassword) : "",
      restartExamURL: input.startUrl,
      quitURL: `${appBaseUrl.replace(/\/+$/u, "")}/seb/exit/quit/${input.courseId}/${quitPathId(input.contentId)}`,
      quitURLConfirm: false,
      URLFilterEnable: true,
      URLFilterEnableContentFilter: true,
      allowReloading: true,
      showReloadButton: true,
      sendBrowserExamKey: false,
      browserExamKey: browserExamKey(input.courseId, input.contentId, input.accessCode),
      hashedAdminPassword: "",
      allowWlan: false,
      allowPreferencesWindow: false,
      allowSpellCheck: false,
      allowDictionaryLookup: false,
      browserViewMode: 0,
      newBrowserWindowByLinkPolicy: 2,
      newBrowserWindowByScriptPolicy: 2,
      newBrowserWindowNavigation: true,
      newBrowserWindowAllowReload: true,
      newBrowserWindowShowReloadWarning: false,
      newBrowserWindowByLinkPositioning: 2,
      newBrowserWindowByLinkWidth: "1000",
      newBrowserWindowByLinkHeight: "100%",
      newBrowserWindowByScriptPositioning: 2,
      newBrowserWindowByScriptWidth: "1000",
      newBrowserWindowByScriptHeight: "100%",
      URLFilterRules: buildAllowlistRules({
        appBaseUrl,
        canvasBaseUrl,
        courseId: input.courseId,
        contentId: input.contentId,
        startUrl: input.startUrl,
        requiredDomains: this.config.value.seb.requiredDomains,
        additionalDomains: input.allowedDomains || []
      })
    };
    return Buffer.from(plist.build(plistValue as any), "utf8");
  }
}

export function buildAllowlistRules(input: {
  appBaseUrl: string;
  canvasBaseUrl: string;
  courseId: string;
  contentId: string;
  startUrl: string;
  requiredDomains: string[];
  additionalDomains: string[];
}): UrlFilterRule[] {
  const rules = new Map<string, UrlFilterRule>();
  const addRule = (rule: UrlFilterRule) => {
    rules.set(`${rule.regex ? "regex" : "simple"}:${rule.expression}`, rule);
  };
  const add = (entry: string) => {
    for (const rule of normalizeAllowedEntry(entry)) {
      addRule(rule);
    }
  };
  add(input.appBaseUrl);
  for (const expression of canvasResourceRules(input.canvasBaseUrl, input.courseId, input.contentId, input.startUrl)) {
    addRule({ active: true, regex: true, expression, action: 1 });
  }
  for (const expression of ssoHelperResourceRules()) {
    addRule({ active: true, regex: true, expression, action: 1 });
  }
  add("*.instructuremedia.com");
  add("*.canvas-user-content.com");
  add("*.inscloudgate.net");
  add("canvas-files-prod.s3.amazonaws.com");
  add("inst-fs-iad-prod.inscloudgate.net");
  add(input.appBaseUrl);
  for (const domain of input.requiredDomains) {
    add(domain);
  }
  for (const domain of input.additionalDomains) {
    add(domain);
  }
  return Array.from(rules.values()).sort((left, right) => left.expression.localeCompare(right.expression));
}

export function normalizeAllowedDomain(raw: string): string[] {
  return normalizeAllowedEntry(raw).map((rule) => rule.expression);
}

function normalizeAllowedEntry(raw: string): UrlFilterRule[] {
  const value = raw.trim();
  if (!value || isUnsafeBroadPattern(value)) {
    return [];
  }
  const withoutPath = value.replace(/\/+$/u, "");
  if (withoutPath.includes("://")) {
    try {
      return [urlAllowRule(withoutPath)];
    } catch {
      return [];
    }
  }
  return [{ active: true, regex: false, expression: `https://${withoutPath}/*`, action: 1 }];
}

function urlAllowRule(value: string): UrlFilterRule {
  if (value.includes("*")) {
    return { active: true, regex: false, expression: value, action: 1 };
  }
  const parsed = new URL(value);
  if (parsed.pathname && parsed.pathname !== "/") {
    return {
      active: true,
      regex: true,
      expression: exactUrlPathRegex(parsed),
      action: 1
    };
  }
  return { active: true, regex: false, expression: `${parsed.origin}/*`, action: 1 };
}

function canvasResourceRules(canvasBaseUrl: string, courseId: string, contentId: string, startUrl: string): string[] {
  const canvas = new URL(canvasBaseUrl);
  const host = escapeRegex(canvas.host);
  const course = escapeRegex(courseId);
  const classicQuizId = contentId.startsWith("classicquiz_") ? contentId.slice("classicquiz_".length) : contentId;
  const newQuizParts = contentId.startsWith("newquiz:") ? contentId.split(":", 3) : [];
  const assignmentId = newQuizParts.length === 3 ? newQuizParts[2] : null;
  const staticPaths = ["dist", "assets", "images", "fonts", "javascripts", "stylesheets", "login"];
  const rules = [
    `^https://${host}/?(?:[?#].*)?$`,
    exactUrlPathRegex(new URL(startUrl)),
    `^https://${host}/(${staticPaths.join("|")})(?:/.*)?(?:[?#].*)?$`,
    `^https://${host}/courses/${course}/files(?:/.*)?(?:[?#].*)?$`
  ];

  if (!contentId.startsWith("newquiz:")) {
    const quiz = escapeRegex(classicQuizId);
    rules.push(`^https://${host}/courses/${course}/quizzes/${quiz}(?:/.*)?(?:[?#].*)?$`);
  }
  if (assignmentId) {
    const assignment = escapeRegex(assignmentId);
    rules.push(`^https://${host}/courses/${course}/assignments/${assignment}(?:/.*)?(?:[?#].*)?$`);
  }
  return rules;
}

function ssoHelperResourceRules(): string[] {
  return [
    "^https://www\\.google\\.com/accounts/(?:.*)$",
    "^https://accounts\\.youtube\\.com/accounts/(?:.*)$",
    "^https://www\\.youtube\\.com/accounts/(?:.*)$",
    "^https://www\\.google\\.com/recaptcha/(?:.*)$",
    "^https://www\\.gstatic\\.com/recaptcha/(?:.*)$",
    "^https://fonts\\.googleapis\\.com/(?:.*)$",
    "^https://clients[0-9]\\.google\\.com/generate_204(?:[?#].*)?$",
    "^https://play\\.google\\.com/log(?:[?#].*)?$",
    "^https://www\\.googleapis\\.com/oauth2/(?:.*)$",
    "^https://sso\\.canvaslms\\.com/(?:.*)$"
  ];
}

function exactUrlPathRegex(url: URL): string {
  const origin = `${escapeRegex(url.protocol)}//${escapeRegex(url.host)}`;
  const path = escapeRegex(url.pathname.replace(/\/+$/u, "") || "/");
  return `^${origin}${path}(?:[?#].*)?$`;
}

function isUnsafeBroadPattern(value: string): boolean {
  const lower = value.toLowerCase();
  return [
    "*",
    "*/*",
    "https://*/*",
    "http://*/*",
    "*.com",
    "*.org",
    "*.net",
    "*.edu",
    "*.amazonaws.com",
    "*.s3.amazonaws.com"
  ].includes(lower);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function browserExamKey(courseId: string, contentId: string, accessCode: string): string {
  return createHash("sha256")
    .update(`SEB_BROWSER_EXAM_KEY|${courseId}|${contentId}|${accessCode}`, "utf8")
    .digest("base64");
}

function quitPathId(contentId: string): string {
  return contentId.startsWith("classicquiz_") ? contentId.slice("classicquiz_".length) : contentId;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
