import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import * as plist from "plist";
import { isUnsafeBroadUrlPattern } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import {
  assertSebEncryptionCertificateCurrent,
  encryptSebConfigWithPublicKey,
  loadSebEncryptionKeyMaterial,
  preparePasswordProtectedSebConfig,
  type SebEncryptionKeyMaterial
} from "./seb-config-encryption.js";
import { configKeySaltBuffer } from "./seb-start-password.js";
import { effectiveSebQuitPassword, SEB_QUIT_PASSWORD_REQUIRED_MESSAGE } from "./seb-quit-password.js";
import {
  normalizeSebPassword,
  requireDistinctSebPasswordsForConfiguration,
  requireSebPasswordForConfiguration
} from "./seb-password-policy.js";

export interface SebConfigurationInput {
  courseId: string;
  contentId: string;
  startUrl: string;
  accessCode: string;
  allowedDomains?: string[];
  quitPassword?: string | null;
  startPassword?: string | null;
  configKeySalt?: string | null;
}

export interface SebSetupCheckConfigurationInput {
  startUrl: string;
  quitUrl: string;
}

export interface SebConfigurationDownloadOptions {
  startPassword?: string | null;
  requireCertificateEncryption?: boolean;
}

interface UrlFilterRule {
  active: boolean;
  regex: boolean;
  expression: string;
  action: number;
}

export const DEFAULT_MACOS_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15";

function macOSBrowserUserAgentSettings(): Record<string, unknown> {
  // SEB appends its SEB/<version> marker to a configured macOS user agent.
  // Google Sheets uses this current-Safari identity when selecting its canvas
  // rendering path, while Windows keeps its native Chromium-based identity.
  return {
    browserUserAgentMac: 1,
    browserUserAgentMacCustom: DEFAULT_MACOS_BROWSER_USER_AGENT
  };
}

// macOS exam boundary: Apple's Automatic Assessment Configuration (AAC) is
// the OS-enforced assessment mode; SEB's classic macOS kiosk mode is only a
// user-space fallback. Released SEB macOS clients (3.2 through 3.6.x) read
// enableMacOSAAC ("Prefer Assessment Mode"), which defaults to off, and SEB
// 3.7+ replaces that key with lockdownModePolicy (2 = enforce AAC). SEB only
// enters AAC on macOS 11.x and 12.1 when aacDnsPrePinning works around the
// in-AAC DNS failure on those releases, and 3.7's enforce policy silently
// drops lockdown when the OS cannot run AAC, so the version floor rejects
// anything older than macOS 12.1: allowMacOSVersionNumber* on clients with
// the full three-part check, minMacOSVersion (10 = macOS 12) on older ones.
// Windows and iOS clients ignore all of these keys. The install-location keys
// make SEB refuse to run from user-writable locations (a student-modified
// copy in ~/Applications or ~/Downloads) instead of only from /Applications.
const MACOS_LOCKDOWN_SETTINGS: Readonly<Record<string, unknown>> = {
  aacDnsPrePinning: true,
  allowMacOSVersionNumberCheckFull: true,
  allowMacOSVersionNumberMajor: 12,
  allowMacOSVersionNumberMinor: 1,
  allowMacOSVersionNumberPatch: 0,
  allowUserAppFolderInstall: false,
  enableMacOSAAC: true,
  forceAppFolderInstall: true,
  lockdownModePolicy: 2,
  minMacOSVersion: 10
};

// Do not rely on client-version defaults for controls that define the exam
// boundary. Unknown keys are ignored by clients on other platforms, while the
// overlapping legacy/current keys keep the policy fail-closed across supported
// Windows, macOS, and iOS releases.
const ASSESSMENT_LOCKDOWN_SETTINGS: Readonly<Record<string, unknown>> = {
  ...MACOS_LOCKDOWN_SETTINGS,

  // Browser and file-system escape surfaces.
  allowApplicationLog: false,
  allowBrowsingBackForward: false,
  allowCustomDownUploadLocation: false,
  allowDeveloperConsole: false,
  allowDownloads: false,
  allowDownUploads: false,
  allowFlashFullscreen: false,
  allowOpenAndSavePanel: false,
  allowPDFPlugIn: false,
  allowPDFReaderToolbar: false,
  allowPrint: false,
  allowShareSheet: false,
  allowUploads: false,
  allowUploadsiOS: false,
  browserWindowAllowAddressBar: false,
  browserWindowAllowReload: true,
  clipboardPolicy: 2,
  downloadPDFFiles: false,
  enableBrowserWindowToolbar: false,
  enableJava: false,
  enableJavaScript: true,
  enablePlugIns: false,
  enablePrivateClipboard: true,
  enablePrivateClipboardMacEnforce: true,
  newBrowserWindowAllowAddressBar: false,
  openDownloads: false,
  showMenuBar: false,

  // OS, display, capture, and application-switching controls. SEB macOS 3.7
  // removes allowAudioCapture/allowVideoCapture; the browserMediaCapture*
  // keys are their successors (getUserMedia/getDisplayMedia in the browser),
  // so both generations are set explicitly.
  allowAirPlay: false,
  allowAudioCapture: false,
  browserMediaCaptureCamera: false,
  browserMediaCaptureMicrophone: false,
  browserMediaCaptureScreen: false,
  allowDictation: false,
  allowDisplayMirroring: false,
  allowedDisplayBuiltin: true,
  allowedDisplayBuiltinEnforce: true,
  allowedDisplayBuiltinExceptDesktop: true,
  allowedDisplaysIgnoreFailure: false,
  allowedDisplaysMaxNumber: 1,
  allowScreenCapture: false,
  allowScreenSharing: false,
  allowSiri: false,
  allowSwitchToApplications: false,
  allowUserSwitching: false,
  allowVideoCapture: false,
  allowVirtualMachine: false,
  allowWindowCapture: false,
  createNewDesktop: true,
  detectStoppedProcess: true,
  displayAlwaysOn: true,
  enableAppSwitcherCheck: true,
  enableScreenProctoring: false,
  monitorProcesses: true,
  screenSharingMacEnforceBlocked: true,
  systemAlwaysOn: true,

  // Keyboard, mouse, and Windows security-screen escape controls.
  allowStickyKeys: false,
  enableAltEsc: false,
  enableAltF4: false,
  enableAltMouseWheel: false,
  enableAltTab: false,
  enableCtrlEsc: false,
  enableEsc: true,
  enableF1: false,
  enableF2: false,
  enableF3: false,
  enableF4: false,
  enableF5: true,
  enableF6: false,
  enableF7: false,
  enableF8: false,
  enableF9: false,
  enableF10: false,
  enableF11: false,
  enableF12: false,
  enableFindPrinter: false,
  enableInjected: false,
  enableMiddleMouse: false,
  enablePrintScreen: false,
  enableRightMouse: false,
  enableRightMouseMac: false,
  enableStartMenu: false,
  enableWindowsUpdate: false,
  hookKeys: true,
  insideSebEnableChangeAPassword: false,
  insideSebEnableEaseOfAccess: false,
  insideSebEnableLockThisComputer: false,
  insideSebEnableLogOff: false,
  insideSebEnableNetworkConnectionSelector: false,
  insideSebEnableShutDown: false,
  insideSebEnableStartTaskManager: false,
  insideSebEnableSwitchUser: false,
  insideSebEnableVmWareClientShade: false,

  // Session integrity and cleanup controls. Windows 3.6+ enforces the
  // built-in version floor; managed-device policy must reject older clients
  // because releases predating this key cannot enforce it themselves.
  disableSessionChangeLockScreen: false,
  enableChromeNotifications: false,
  enableCursorVerification: true,
  enableSessionVerification: true,
  // The Canvas session hand-off assumes each exam starts with a fresh SEB
  // cookie jar; clearing on start guarantees that even if a client default
  // ever changes.
  examSessionClearCookiesOnStart: true,
  examSessionClearCookiesOnEnd: true,
  ignoreExitKeys: true,
  removeBrowserProfile: true,
  restartExamPasswordProtected: true,
  sebAllowedVersions: ["win.3.6.min"],
  sebServiceIgnore: false,
  sebServicePolicy: 2
};

@Injectable()
export class SebConfigurationService implements OnModuleInit {
  private encryptionKeyMaterial?: SebEncryptionKeyMaterial;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    if (!this.config.isHardenedRuntime() || !this.config.value.seb.configEncryption.enabled) {
      return;
    }
    if (!this.getEncryptionCertificate()) {
      throw new Error("A valid X.509 SEB config encryption certificate is required in hardened runtimes");
    }
  }

  generateSebConfiguration(input: SebConfigurationInput): Buffer {
    const appBaseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!appBaseUrl) {
      throw new Error("Application base URL is required to generate SEB configuration");
    }
    const canvasBaseUrl = this.config.getCanvasDomain();
    const quitPassword = effectiveSebQuitPassword(input.quitPassword, this.config.value.seb.defaultQuitPassword);
    if (!quitPassword) {
      throw new Error(SEB_QUIT_PASSWORD_REQUIRED_MESSAGE);
    }
    const validatedQuitPassword = requireSebPasswordForConfiguration(quitPassword, "exit");
    const startPassword = normalizeSebPassword(input.startPassword);
    if (startPassword) {
      requireSebPasswordForConfiguration(startPassword, "start");
    }
    requireDistinctSebPasswordsForConfiguration(startPassword, validatedQuitPassword);
    const configKeySalt = startPassword ? configKeySaltBuffer(input.configKeySalt) : null;
    const quitUrl = this.assessmentQuitUrl(input.courseId, input.contentId, input.accessCode);
    const plistValue: Record<string, unknown> = {
      sebConfigPurpose: 0,
      originatorVersion: "3.7.0",
      startURL: input.startUrl,
      ...(configKeySalt ? { configKeySalt } : {}),
      ...ASSESSMENT_LOCKDOWN_SETTINGS,
      allowQuit: true,
      ignoreQuitPassword: false,
      hashedQuitPassword: sha256Hex(validatedQuitPassword),
      restartExamURL: input.startUrl,
      quitURL: quitUrl,
      quitURLConfirm: false,
      examSessionReconfigureAllow: false,
      examSessionReconfigureConfigURL: "",
      downloadAndOpenSebConfig: false,
      URLFilterEnable: true,
      URLFilterEnableContentFilter: false,
      allowReloading: true,
      showReloadButton: true,
      sendBrowserExamKey: false,
      browserExamKey: browserExamKey(input.courseId, input.contentId, input.accessCode),
      hashedAdminPassword: "",
      allowWlan: false,
      allowPreferencesWindow: false,
      allowSpellCheck: false,
      allowDictionaryLookup: false,
      browserWindowWebView: 3,
      browserWindowWebViewClassicHideDeprecationNote: false,
      ...macOSBrowserUserAgentSettings(),
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
        quitUrl,
        requiredDomains: this.config.value.seb.requiredDomains,
        additionalDomains: input.allowedDomains || []
      })
    };
    return Buffer.from(plist.build(plistValue as any), "utf8");
  }

  assessmentQuitUrl(courseId: string, contentId: string, accessCode: string): string {
    const appBaseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!appBaseUrl) {
      throw new Error("Application base URL is required to generate an SEB quit URL");
    }
    const token = this.assessmentQuitToken(courseId, contentId, accessCode);
    return new URL(
      `/seb/exit/complete/${encodeURIComponent(courseId)}/${encodeURIComponent(contentId)}/${token}`,
      appBaseUrl
    ).toString();
  }

  matchesAssessmentQuitToken(courseId: string, contentId: string, accessCode: string, token: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return false;
    }
    const expected = Buffer.from(this.assessmentQuitToken(courseId, contentId, accessCode));
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  generateSebSetupCheckConfiguration(input: SebSetupCheckConfigurationInput): Buffer {
    const appBaseUrl = this.config.getApplicationBaseUrl() || this.config.toolUrl;
    if (!appBaseUrl) {
      throw new Error("Application base URL is required to generate SEB configuration");
    }
    const plistValue: Record<string, unknown> = {
      sebConfigPurpose: 0,
      originatorVersion: "3.7.0",
      startURL: input.startUrl,
      // The setup check must exercise the same macOS AAC entry path and
      // install-location checks as a real assessment so an unsupported Mac
      // fails here instead of on exam day.
      ...MACOS_LOCKDOWN_SETTINGS,
      allowQuit: true,
      ignoreQuitPassword: true,
      hashedQuitPassword: "",
      restartExamURL: input.startUrl,
      quitURL: input.quitUrl,
      quitURLConfirm: false,
      URLFilterEnable: true,
      URLFilterEnableContentFilter: false,
      allowReloading: true,
      showReloadButton: true,
      sendBrowserExamKey: false,
      browserExamKey: browserExamKey("seb-check", "setup-check", "setup-check"),
      hashedAdminPassword: "",
      allowWlan: false,
      allowPreferencesWindow: false,
      allowSpellCheck: false,
      allowDictionaryLookup: false,
      browserWindowWebView: 3,
      browserWindowWebViewClassicHideDeprecationNote: false,
      newBrowserWindowByLinkPolicy: 2,
      newBrowserWindowByScriptPolicy: 2,
      newBrowserWindowNavigation: true,
      newBrowserWindowAllowReload: true,
      newBrowserWindowShowReloadWarning: false,
      URLFilterRules: buildSetupCheckAllowlistRules({ appBaseUrl, startUrl: input.startUrl, quitUrl: input.quitUrl })
    };
    return Buffer.from(plist.build(plistValue as any), "utf8");
  }

  prepareSebConfigurationDownload(plainConfig: Buffer, options: SebConfigurationDownloadOptions = {}): Buffer {
    const startPassword = normalizeSebPassword(options.startPassword);
    if (startPassword) {
      requireSebPasswordForConfiguration(startPassword, "start");
    }
    const keyMaterial = this.currentEncryptionKeyMaterialForDownload();
    if (!keyMaterial) {
      if (options.requireCertificateEncryption) {
        throw new Error("Certificate encryption is required for assessment configuration downloads");
      }
      if (startPassword) {
        return preparePasswordProtectedSebConfig(plainConfig, startPassword);
      }
      return plainConfig;
    }
    return encryptSebConfigWithPublicKey(plainConfig, keyMaterial, {
      startPassword
    });
  }

  assertConfigurationDownloadReady(
    options: Pick<SebConfigurationDownloadOptions, "requireCertificateEncryption"> = {}
  ): void {
    const keyMaterial = this.currentEncryptionKeyMaterialForDownload();
    if (!keyMaterial && options.requireCertificateEncryption) {
      throw new Error("Certificate encryption is required for assessment configuration downloads");
    }
  }

  getEncryptionCertificate(): { pem: string; der: Buffer; publicKeyHash: Buffer } | null {
    const settings = this.config.value.seb.configEncryption;
    if (!settings.enabled || (!settings.certificatePem && !settings.certificatePath)) {
      return null;
    }
    const keyMaterial = this.getEncryptionKeyMaterial();
    if (!keyMaterial.certificatePem || !keyMaterial.certificateDer) {
      return null;
    }
    return {
      pem: keyMaterial.certificatePem,
      der: keyMaterial.certificateDer,
      publicKeyHash: keyMaterial.publicKeyHash
    };
  }

  private getEncryptionKeyMaterial(): SebEncryptionKeyMaterial {
    this.encryptionKeyMaterial ||= loadSebEncryptionKeyMaterial(this.config.value.seb.configEncryption);
    return this.encryptionKeyMaterial;
  }

  private currentEncryptionKeyMaterialForDownload(): SebEncryptionKeyMaterial | null {
    if (!this.config.value.seb.configEncryption.enabled) {
      return null;
    }
    const keyMaterial = this.getEncryptionKeyMaterial();
    assertSebEncryptionCertificateCurrent(keyMaterial);
    return keyMaterial;
  }

  private assessmentQuitToken(courseId: string, contentId: string, accessCode: string): string {
    const secret = this.config.value.security.stateEncryptionKey || this.config.value.security.sessionSecret;
    return createHmac("sha256", secret)
      .update("seb-assessment-quit-v1\0", "utf8")
      .update(courseId, "utf8")
      .update("\0", "utf8")
      .update(contentId, "utf8")
      .update("\0", "utf8")
      .update(accessCode, "utf8")
      .digest("base64url");
  }
}

export function buildAllowlistRules(input: {
  appBaseUrl: string;
  canvasBaseUrl: string;
  courseId: string;
  contentId: string;
  startUrl: string;
  quitUrl?: string;
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
  for (const expression of assessmentAppRules(input.appBaseUrl, input.courseId, input.contentId)) {
    addRule({ active: true, regex: true, expression, action: 1 });
  }
  if (input.quitUrl) {
    try {
      addRule({ active: true, regex: true, expression: exactUrlRegex(new URL(input.quitUrl)), action: 1 });
    } catch {
      // The quit URL is generated by this service; skip an invalid value defensively.
    }
  }
  for (const expression of canvasResourceRules(input.canvasBaseUrl, input.courseId, input.contentId, input.startUrl)) {
    addRule({ active: true, regex: true, expression, action: 1 });
  }
  for (const domain of input.requiredDomains) {
    add(domain);
  }
  for (const domain of input.additionalDomains) {
    add(domain);
    for (const rule of externalToolBridgeRules(input.appBaseUrl, domain)) {
      addRule(rule);
    }
  }
  return Array.from(rules.values()).sort((left, right) => left.expression.localeCompare(right.expression));
}

export function buildSetupCheckAllowlistRules(input: {
  appBaseUrl: string;
  startUrl: string;
  quitUrl: string;
}): UrlFilterRule[] {
  const rules = new Map<string, UrlFilterRule>();
  const addRule = (rule: UrlFilterRule) => {
    rules.set(`${rule.regex ? "regex" : "simple"}:${rule.expression}`, rule);
  };
  for (const url of [input.startUrl, input.quitUrl]) {
    try {
      addRule({ active: true, regex: true, expression: exactUrlRegex(new URL(url)), action: 1 });
    } catch {
      // The start and quit URLs are generated by the server; skip invalid values defensively.
    }
  }
  return Array.from(rules.values()).sort((left, right) => left.expression.localeCompare(right.expression));
}

function assessmentAppRules(appBaseUrl: string, courseId: string, contentId: string): string[] {
  const app = new URL(appBaseUrl);
  const host = escapeRegex(app.host);
  const course = escapeRegex(courseId);
  const canonicalContent = escapeRegex(contentId);
  const contentVariants = [canonicalContent];
  if (contentId.startsWith("classicquiz_")) {
    contentVariants.push(escapeRegex(contentId.slice("classicquiz_".length)));
  }
  // The detector navigates to percent-encoded exit URLs (e.g. newquiz%3A...),
  // while SEB's URL filter matches the literal URL string, so both encodings
  // must be permitted or SEB silently blocks the exit navigation.
  const encodedContentId = encodeURIComponent(contentId);
  if (encodedContentId !== contentId) {
    contentVariants.push(escapeRegex(encodedContentId));
  }
  const content = `(?:${Array.from(new Set(contentVariants)).join("|")})`;
  const capability = "[A-Za-z0-9_-]{43}";
  return [
    `^https://${host}/seb/exit/${course}/${content}$`,
    `^https://${host}/seb/exit/session/${course}/${content}/${capability}$`,
    `^https://${host}/seb/exit/quit/${course}/${content}/${capability}$`
  ];
}

export function normalizeAllowedDomain(raw: string): string[] {
  return normalizeAllowedEntry(raw).map((rule) => rule.expression);
}

function normalizeAllowedEntry(raw: string): UrlFilterRule[] {
  const value = raw.trim();
  if (!value || value.length > 2048 || isUnsafeBroadPattern(value)) {
    return [];
  }
  if (value.startsWith("youtube-video:")) {
    const videoId = value.slice("youtube-video:".length);
    return /^[A-Za-z0-9_-]{11}$/u.test(videoId) ? youtubeVideoRules(videoId) : [];
  }
  if (value.startsWith("regex:")) {
    return [];
  }
  if (value.startsWith("exact:")) {
    try {
      const url = new URL(value.slice("exact:".length));
      if (!isSafeHttpsUrl(url) || isBlockedIdentityProviderUrl(url)) {
        return [];
      }
      return [{ active: true, regex: true, expression: exactUrlRegex(url), action: 1 }];
    } catch {
      return [];
    }
  }
  if (value.startsWith("domain:")) {
    const domain = normalizeConcreteHostname(value.slice("domain:".length));
    return domain && !isBlockedIdentityProviderHostname(domain)
      ? [{ active: true, regex: false, expression: `https://${domain}/*`, action: 1 }]
      : [];
  }
  if (value.includes("://")) {
    try {
      return [urlAllowRule(value)];
    } catch {
      return [];
    }
  }
  const withoutPath = value.replace(/\/+$/u, "");
  const domain = normalizeConcreteHostname(withoutPath);
  return domain && !isBlockedIdentityProviderHostname(domain)
    ? [{ active: true, regex: false, expression: `https://${domain}/*`, action: 1 }]
    : [];
}

/**
 * These launch pages are server-owned and carry no user-controlled redirect
 * destination. Their exact URL is also included in the assessment's SEB URL
 * filter, so they cannot become a general-purpose navigation escape hatch.
 */
function externalToolBridgeRules(appBaseUrl: string, entry: string): UrlFilterRule[] {
  try {
    if (entry.startsWith("youtube-video:")) {
      const videoId = entry.slice("youtube-video:".length);
      if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
        return [];
      }
      return [
        {
          active: true,
          regex: true,
          expression: exactUrlRegex(new URL(`/seb/tool/youtube/${videoId}`, appBaseUrl)),
          action: 1
        }
      ];
    }
  } catch {
    // The source entries are validated before they are persisted. Keep config
    // generation fail-closed if a malformed historical record slips through.
  }
  return [];
}

function urlAllowRule(value: string): UrlFilterRule {
  if (value.includes("*")) {
    if (!value.endsWith("/*") || value.slice(0, -2).includes("*")) {
      throw new Error("Unsafe URL wildcard");
    }
    const base = new URL(value.slice(0, -1));
    if (!isSafeHttpsUrl(base) || isBlockedIdentityProviderUrl(base)) {
      throw new Error("Unsafe URL");
    }
    return { active: true, regex: false, expression: `${base.toString()}*`, action: 1 };
  }
  const parsed = new URL(value);
  if (!isSafeServerUrl(parsed) || isBlockedIdentityProviderUrl(parsed)) {
    throw new Error("Unsafe URL");
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    return {
      active: true,
      regex: true,
      expression: exactUrlRegex(parsed),
      action: 1
    };
  }
  return { active: true, regex: false, expression: `${parsed.origin}/*`, action: 1 };
}

function isSafeHttpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    !!normalizeConcreteHostname(url.hostname)
  );
}

function isSafeServerUrl(url: URL): boolean {
  if (isSafeHttpsUrl(url)) {
    return true;
  }
  return (
    url.protocol === "http:" &&
    !url.username &&
    !url.password &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")
  );
}

function normalizeConcreteHostname(raw: string): string | null {
  const hostname = raw.trim().toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.includes("*") || !hostname.includes(".")) {
    return null;
  }
  if (
    !hostname
      .split(".")
      .every((label) => !!label && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))
  ) {
    return null;
  }
  try {
    return new URL(`https://${hostname}`).hostname === hostname ? hostname : null;
  } catch {
    return null;
  }
}

function canvasResourceRules(canvasBaseUrl: string, courseId: string, contentId: string, startUrl: string): string[] {
  const canvas = new URL(canvasBaseUrl);
  const host = escapeRegex(canvas.host);
  const course = escapeRegex(courseId);
  const classicQuizId = contentId.startsWith("classicquiz_") ? contentId.slice("classicquiz_".length) : contentId;
  const newQuizParts = contentId.startsWith("newquiz:") ? contentId.split(":", 3) : [];
  const assignmentId = newQuizParts.length === 3 ? newQuizParts[2] : null;
  const staticPaths = ["dist", "assets", "images", "fonts", "javascripts", "stylesheets"];
  const rules = [
    `^https://${host}/?(?:[?#].*)?$`,
    dynamicUrlPathRegex(new URL(startUrl)),
    `^https://${host}/(${staticPaths.join("|")})(?:/.*)?(?:[?#].*)?$`
  ];

  if (!contentId.startsWith("newquiz:")) {
    const quiz = escapeRegex(classicQuizId);
    rules.push(`^https://${host}/courses/${course}/quizzes/${quiz}(?:/.*)?(?:[?#].*)?$`);
  }
  if (assignmentId) {
    const assignment = escapeRegex(assignmentId);
    rules.push(`^https://${host}/courses/${course}/assignments/${assignment}(?:/.*)?(?:[?#].*)?$`);
    const tenant = canvasTenant(canvas.hostname);
    if (tenant) {
      rules.push(`^https://${escapeRegex(tenant)}\\.quiz-(?:lti|api)-[a-z0-9-]+\\.instructure\\.com/(?:.*)$`);
    }
  }
  return rules;
}

function canvasTenant(hostname: string): string | null {
  const normalized = hostname.toLowerCase();
  if (!normalized.endsWith(".instructure.com")) {
    return null;
  }
  const [tenant] = normalized.split(".");
  return tenant && tenant !== "canvas" ? tenant : null;
}

function isBlockedIdentityProviderHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "accounts.google.com" ||
    normalized === "accounts.youtube.com" ||
    normalized === "sso.canvaslms.com" ||
    normalized === "www.google.com" ||
    normalized === "www.youtube.com" ||
    normalized === "www.googleapis.com" ||
    normalized === "login.microsoftonline.com" ||
    normalized === "login.live.com" ||
    normalized === "login.okta.com" ||
    normalized === "login.salesforce.com" ||
    normalized === "appleid.apple.com" ||
    normalized === "auth0.com" ||
    normalized.endsWith(".auth0.com") ||
    normalized.endsWith(".okta.com") ||
    normalized.endsWith(".onelogin.com")
  );
}

function isBlockedIdentityProviderUrl(url: URL): boolean {
  return isBlockedIdentityProviderHostname(url.hostname);
}

/**
 * YouTube embeds are a deliberately bounded exception to the general
 * identity-provider blocklist. The teacher supplies one public video, while
 * this server-owned policy permits only the player code, its thumbnails, and
 * its media-stream endpoints. It does not permit accounts.google.com, search,
 * watch pages, or arbitrary YouTube navigation.
 */
function youtubeVideoRules(videoId: string): UrlFilterRule[] {
  const video = escapeRegex(videoId);
  return [
    { active: true, regex: true, expression: `^https://www\\.youtube\\.com/embed/${video}(?:[?#].*)?$`, action: 1 },
    {
      active: true,
      regex: true,
      expression:
        "^https://www\\.youtube\\.com/(?:s/player|youtubei/v1/player|api/stats|ptracking|generate_204)(?:/.*)?(?:[?#].*)?$",
      action: 1
    },
    { active: true, regex: true, expression: "^https://i\\.ytimg\\.com/(?:.*)$", action: 1 },
    { active: true, regex: true, expression: "^https://yt3\\.ggpht\\.com/(?:.*)$", action: 1 },
    {
      active: true,
      regex: true,
      expression: "^https://[a-z0-9-]+\\.googlevideo\\.com/(?:videoplayback|initplayback)(?:[?#].*)?$",
      action: 1
    }
  ];
}

function exactUrlRegex(url: URL): string {
  return `^${escapeRegex(url.toString())}$`;
}

function dynamicUrlPathRegex(url: URL): string {
  const origin = `${escapeRegex(url.protocol)}//${escapeRegex(url.host)}`;
  const path = escapeRegex(url.pathname.replace(/\/+$/u, "") || "/");
  return `^${origin}${path}(?:[?#].*)?$`;
}

function isUnsafeBroadPattern(value: string): boolean {
  return isUnsafeBroadUrlPattern(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function browserExamKey(courseId: string, contentId: string, accessCode: string): string {
  return createHash("sha256")
    .update(`SEB_BROWSER_EXAM_KEY|${courseId}|${contentId}|${accessCode}`, "utf8")
    .digest("base64");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
