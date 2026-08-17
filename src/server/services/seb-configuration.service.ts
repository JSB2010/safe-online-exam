import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable, type OnModuleInit } from "@nestjs/common";

import * as plist from "plist";

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

import {
  ASSESSMENT_LOCKDOWN_SETTINGS,
  browserExamKey,
  buildAllowlistRules,
  buildSetupCheckAllowlistRules,
  macOSBrowserUserAgentSettings,
  MACOS_LOCKDOWN_SETTINGS,
  sha256Hex
} from "./seb-configuration-policy.js";

export {
  buildAllowlistRules,
  buildSetupCheckAllowlistRules,
  DEFAULT_MACOS_BROWSER_USER_AGENT
} from "./seb-configuration-policy.js";

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

  prepareSebConfigurationDownload(plainConfig: Buffer, options: { startPassword?: string | null } = {}): Buffer {
    const startPassword = normalizeSebPassword(options.startPassword);
    if (startPassword) {
      requireSebPasswordForConfiguration(startPassword, "start");
    }
    const keyMaterial = this.currentEncryptionKeyMaterialForDownload();
    if (!keyMaterial) {
      if (startPassword) {
        return preparePasswordProtectedSebConfig(plainConfig, startPassword);
      }
      return plainConfig;
    }
    return encryptSebConfigWithPublicKey(plainConfig, keyMaterial, {
      startPassword
    });
  }

  assertConfigurationDownloadReady(): void {
    this.currentEncryptionKeyMaterialForDownload();
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
