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
      enableURLFilter: true,
      enableURLContentFilter: true,
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
      newBrowserWindowByLinkPolicy: 0,
      newBrowserWindowByScriptPolicy: 0,
      urlFilterRules: buildAllowlistRules({
        appBaseUrl,
        canvasBaseUrl,
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
  requiredDomains: string[];
  additionalDomains: string[];
}): UrlFilterRule[] {
  const rules = new Map<string, UrlFilterRule>();
  const add = (domain: string) => {
    for (const expression of normalizeAllowedDomain(domain)) {
      rules.set(expression, { active: true, regex: false, expression, action: 1 });
    }
  };
  add(input.canvasBaseUrl);
  add("*.instructure.com");
  add("*.canvaslms.com");
  add("*.instructuremedia.com");
  add("*.canvas-user-content.com");
  add("*.inscloudgate.net");
  add("*.insops.net");
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
  const value = raw.trim();
  if (!value || isUnsafeBroadPattern(value)) {
    return [];
  }
  const withoutPath = value.replace(/\/+$/u, "");
  if (withoutPath.includes("://")) {
    return [`${withoutPath}/*`];
  }
  return [`https://${withoutPath}/*`];
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
