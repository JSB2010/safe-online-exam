import { describe, expect, it, vi } from "vitest";
import * as plist from "plist";
import { AppConfig } from "../../src/server/config/app-config.js";
import {
  buildAllowlistRules,
  buildSetupCheckAllowlistRules,
  SebConfigurationService
} from "../../src/server/services/seb-configuration.service.js";

describe("SebConfigurationService", () => {
  it("loads and validates the SEB encryption certificate during hardened-runtime startup", () => {
    const service = new SebConfigurationService(startupConfig(true, "configured-certificate"));
    const certificateCheck = vi.spyOn(service, "getEncryptionCertificate").mockReturnValue({
      pem: "configured-certificate",
      der: Buffer.from("certificate"),
      publicKeyHash: Buffer.alloc(20, 1)
    });

    expect(() => service.onModuleInit()).not.toThrow();
    expect(certificateCheck).toHaveBeenCalledOnce();
  });

  it("fails hardened-runtime startup when the configured certificate is malformed or absent", () => {
    const malformed = new SebConfigurationService(startupConfig(true, "not-a-certificate"));
    expect(() => malformed.onModuleInit()).toThrow();

    const absent = new SebConfigurationService(startupConfig(true));
    expect(() => absent.onModuleInit()).toThrow(
      "A valid X.509 SEB config encryption certificate is required in hardened runtimes"
    );
  });

  it("keeps certificate loading lazy for local development", () => {
    const service = new SebConfigurationService(startupConfig(false, "not-a-certificate"));
    const certificateCheck = vi.spyOn(service, "getEncryptionCertificate");

    expect(() => service.onModuleInit()).not.toThrow();
    expect(certificateCheck).not.toHaveBeenCalled();
  });

  it("generates a deterministic, unguessable assessment Quit Link and capability-gated exit routes", () => {
    process.env.TOOL_URL = "https://app.example.com";
    process.env.CANVAS_BASE_URL = "https://canvas.example.com";
    const service = new SebConfigurationService(new AppConfig());
    const config = service.generateSebConfiguration({
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      accessCode: "CODE123",
      allowedDomains: ["https://www.desmos.com/calculator", "https://www.desmos.com/assets/build/*"],
      quitPassword: "unique-exit-passphrase"
    });
    const parsed = plist.parse(config.toString("utf8")) as Record<string, any>;
    const expressions = parsed.URLFilterRules.map((rule: { expression: string }) => rule.expression);
    expect(parsed.startURL).toBe("https://canvas.example.com/courses/course-1/quizzes/quiz-1/take");
    expect(parsed.restartExamURL).toBe("https://canvas.example.com/courses/course-1/quizzes/quiz-1/take");
    expect(parsed.quitURL).toMatch(
      /^https:\/\/app\.example\.com\/seb\/exit\/complete\/course-1\/classicquiz_quiz-1\/[A-Za-z0-9_-]{43}$/u
    );
    expect(parsed.examSessionReconfigureAllow).toBe(false);
    expect(parsed.examSessionReconfigureConfigURL).toBe("");
    expect(parsed.downloadAndOpenSebConfig).toBe(false);
    expect(parsed.hashedQuitPassword).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.quitURLConfirm).toBe(false);
    expect(parsed.newBrowserWindowByLinkPolicy).toBe(2);
    expect(parsed.newBrowserWindowByScriptPolicy).toBe(2);
    expect(parsed.sendBrowserExamKey).toBe(false);
    expect(parsed.browserWindowWebView).toBe(3);
    expect(parsed.browserWindowWebViewClassicHideDeprecationNote).toBe(false);
    expect(parsed.browserViewMode).toBeUndefined();
    expect(parsed.URLFilterEnable).toBe(true);
    expect(parsed.URLFilterEnableContentFilter).toBe(false);
    expect(parsed.URLFilterRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regex: true,
          expression: "^https://canvas\\.example\\.com/?(?:[?#].*)?$"
        }),
        expect.objectContaining({
          regex: true,
          expression: "^https://canvas\\.example\\.com/courses/course-1/quizzes/quiz-1(?:/.*)?(?:[?#].*)?$"
        }),
        expect.objectContaining({
          regex: true,
          expression: "^https://www\\.desmos\\.com/calculator$"
        }),
        expect.objectContaining({ regex: false, expression: "https://www.desmos.com/assets/build/*" })
      ])
    );
    expect(expressions).not.toContain("https://accounts.google.com/*");
    expect(expressions).not.toContain("https://*.google.com/*");
    expect(expressions).not.toContain("^https://accounts\\.google\\.com/(?:.*)$");
    expect(expressions).not.toContain("^https://www\\.google\\.com/accounts/(?:.*)$");
    expect(expressions).not.toContain("^https://accounts\\.youtube\\.com/accounts/(?:.*)$");
    expect(expressions).not.toContain("^https://fonts\\.googleapis\\.com/(?:.*)$");
    expect(expressions).not.toContain("^https://sso\\.canvaslms\\.com/(?:.*)$");
    expect(expressions).not.toContain("https://du11hjcvx0uqb.cloudfront.net/*");
    expect(expressions).not.toContain("https://d2l3jyjp24noqc.cloudfront.net/*");
    expect(expressions).not.toContain("https://canvas-static.s3.amazonaws.com/*");
    expect(expressions).not.toContain("https://canvas-network.s3.amazonaws.com/*");
    expect(expressions).not.toContain("https://instructure-uploads.s3.amazonaws.com/*");
    expect(expressions).not.toContain("https://instructure-uploads-prod.s3.amazonaws.com/*");
    expect(expressions).not.toContain("https://canvas-rce.instructure.com/*");
    expect(expressions).not.toContain("https://www.google.com/*");
    expect(expressions).not.toContain("https://*.youtube.com/*");
    expect(expressions).not.toContain("https://*.canvaslms.com/*");
    expect(expressions).not.toContain("https://*.instructure.com/*");
    expect(expressions).not.toContain("https://*.cloudfront.net/*");
    expect(expressions).not.toContain("https://canvas.example.com/*");
    expect(expressions).not.toContain("https://app.example.com/*");
    expect(expressions).toContain("^https://app\\.example\\.com/seb/exit/course-1/(?:classicquiz_quiz-1|quiz-1)$");
    expect(expressions).toContain(
      "^https://app\\.example\\.com/seb/exit/session/course-1/(?:classicquiz_quiz-1|quiz-1)/[A-Za-z0-9_-]{43}$"
    );
    expect(expressions).toContain(
      "^https://app\\.example\\.com/seb/exit/quit/course-1/(?:classicquiz_quiz-1|quiz-1)/[A-Za-z0-9_-]{43}$"
    );
    expect(
      expressions.some((expression: string) => expression.includes("/seb/exit/complete/course-1/classicquiz_quiz-1/"))
    ).toBe(true);
    expect(expressions).not.toContain("https://www.desmos.com/*");
    expect(expressions).not.toContain("https://canvas.example.com/courses/course-1/*");
    expect(expressions).toContain(
      "^https://canvas\\.example\\.com/(dist|assets|images|fonts|javascripts|stylesheets)(?:/.*)?(?:[?#].*)?$"
    );
    expect(expressions).not.toContain("^https://canvas\\.example\\.com/courses/course-1/files(?:/.*)?(?:[?#].*)?$");
    expect(parsed.urlFilterRules).toBeUndefined();
  });

  it("emits explicit cross-platform exam lockdown controls", () => {
    process.env.TOOL_URL = "https://app.example.com";
    process.env.CANVAS_BASE_URL = "https://canvas.example.com";
    const service = new SebConfigurationService(new AppConfig());
    const config = service.generateSebConfiguration({
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      accessCode: "CODE123",
      quitPassword: "unique-exit-passphrase"
    });
    const parsed = plist.parse(config.toString("utf8")) as Record<string, any>;

    expect(parsed).toMatchObject({
      allowApplicationLog: false,
      allowBrowsingBackForward: false,
      allowDeveloperConsole: false,
      allowDownloads: false,
      allowDownUploads: false,
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
      enableJava: false,
      enableJavaScript: true,
      enablePlugIns: false,
      enablePrivateClipboard: true,
      enablePrivateClipboardMacEnforce: true,
      newBrowserWindowAllowAddressBar: false,
      openDownloads: false,
      allowAirPlay: false,
      allowAudioCapture: false,
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
      allowStickyKeys: false,
      enableAltEsc: false,
      enableAltF4: false,
      enableAltMouseWheel: false,
      enableAltTab: false,
      enableCtrlEsc: false,
      enableEsc: true,
      enableF5: true,
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
      disableSessionChangeLockScreen: false,
      enableChromeNotifications: false,
      enableCursorVerification: true,
      enableSessionVerification: true,
      examSessionClearCookiesOnEnd: true,
      ignoreExitKeys: true,
      removeBrowserProfile: true,
      restartExamPasswordProtected: true,
      sebAllowedVersions: ["win.3.6.min"],
      sebServiceIgnore: false,
      sebServicePolicy: 2
    });
    for (const disabledFunctionKey of [
      "enableF1",
      "enableF2",
      "enableF3",
      "enableF4",
      "enableF6",
      "enableF7",
      "enableF8",
      "enableF9",
      "enableF10",
      "enableF11",
      "enableF12"
    ]) {
      expect(parsed[disabledFunctionKey]).toBe(false);
    }
    expect(parsed.allowReloading).toBe(true);
    expect(parsed.showReloadButton).toBe(true);
    expect(parsed.newBrowserWindowByLinkPolicy).toBe(2);
    expect(parsed.newBrowserWindowByScriptPolicy).toBe(2);
    expect(parsed.newBrowserWindowNavigation).toBe(true);
    expect(parsed.newBrowserWindowAllowReload).toBe(true);
    expect(parsed.permittedProcesses).toBeUndefined();
    expect(parsed.prohibitedProcesses).toBeUndefined();
  });

  it("permits both literal and percent-encoded New Quiz exit URLs through the SEB URL filter", () => {
    const rules = buildAllowlistRules({
      appBaseUrl: "https://app.example.com",
      canvasBaseUrl: "https://canvas.example.com",
      courseId: "11825",
      contentId: "newquiz:11825:437577",
      startUrl: "https://canvas.example.com/courses/11825/assignments/437577",
      requiredDomains: [],
      additionalDomains: []
    });
    const exitRules = rules.filter((rule) => rule.regex && rule.expression.includes("/seb/exit/"));
    const grant = "g".repeat(43);
    const matchesSomeRule = (url: string) => exitRules.some((rule) => new RegExp(rule.expression).test(url));

    // The detector navigates to percent-encoded exit URLs; SEB filters on the
    // literal URL string, so both encodings must pass.
    expect(matchesSomeRule(`https://app.example.com/seb/exit/session/11825/newquiz%3A11825%3A437577/${grant}`)).toBe(
      true
    );
    expect(matchesSomeRule(`https://app.example.com/seb/exit/session/11825/newquiz:11825:437577/${grant}`)).toBe(true);
    expect(matchesSomeRule(`https://app.example.com/seb/exit/quit/11825/newquiz%3A11825%3A437577/${grant}`)).toBe(true);
    expect(matchesSomeRule("https://app.example.com/seb/exit/11825/newquiz%3A11825%3A437577")).toBe(true);
    expect(matchesSomeRule(`https://app.example.com/seb/exit/session/11825/newquiz%3A11825%3A999999/${grant}`)).toBe(
      false
    );
  });

  it("rejects unsafe broad allowlist patterns", () => {
    const rules = buildAllowlistRules({
      appBaseUrl: "https://app.example.com",
      canvasBaseUrl: "https://canvas.example.com",
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      requiredDomains: [],
      additionalDomains: [
        "https://*/*",
        "https://*.com/*",
        "*.amazonaws.com",
        "regex:^https://.*$",
        "regex:.*",
        "docs.google.com"
      ]
    });
    const expressions = rules.map((rule) => rule.expression);
    expect(expressions).toContain("https://docs.google.com/*");
    expect(expressions).not.toContain("https://*/*");
    expect(expressions).not.toContain("https://*.com/*");
    expect(expressions).not.toContain("https://*.amazonaws.com/*");
    expect(expressions).not.toContain("^https://.*$");
    expect(expressions).not.toContain(".*");
  });

  it("does not grant top-level navigation to shared Canvas content infrastructure", () => {
    const rules = buildAllowlistRules({
      appBaseUrl: "https://app.example.com",
      canvasBaseUrl: "https://canvas.example.com",
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      requiredDomains: [],
      additionalDomains: []
    });
    const serialized = JSON.stringify(rules);

    for (const sharedHost of [
      "amazonaws.com",
      "cloudfront.net",
      "inscloudgate.net",
      "instructuremedia.com",
      "canvas-media.instructure.com",
      "canvas-rce.instructure.com",
      "quiz-lti.instructure.com"
    ]) {
      expect(serialized).not.toContain(sharedHost);
    }
    expect(serialized).not.toContain("/courses/course-1/files");
  });

  it("includes native Config Key salt data when an exam start password is set", () => {
    process.env.TOOL_URL = "https://app.example.com";
    process.env.CANVAS_BASE_URL = "https://canvas.example.com";
    const service = new SebConfigurationService(new AppConfig());
    const configKeySalt = Buffer.alloc(32, 7).toString("base64");

    const config = service.generateSebConfiguration({
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      accessCode: "CODE123",
      quitPassword: "unique-exit-passphrase",
      startPassword: "unique-start-passphrase",
      configKeySalt
    });
    const parsed = plist.parse(config.toString("utf8")) as Record<string, any>;

    expect(parsed.configKeySalt).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(parsed.configKeySalt)).toEqual(Buffer.alloc(32, 7));
  });

  it("refuses to generate a passwordless assessment config but keeps setup-check generation separate", () => {
    const config = {
      toolUrl: "https://app.example.com",
      getApplicationBaseUrl: () => "https://app.example.com",
      getCanvasDomain: () => "https://canvas.example.com",
      value: {
        seb: {
          defaultQuitPassword: undefined,
          requiredDomains: [],
          configEncryption: { enabled: false }
        }
      }
    };
    const service = new SebConfigurationService(config as AppConfig);

    expect(() =>
      service.generateSebConfiguration({
        courseId: "course-1",
        contentId: "classicquiz_quiz-1",
        startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
        accessCode: "CODE123",
        quitPassword: "   "
      })
    ).toThrow("Assessment configurations require a password-protected native quit path");

    expect(() =>
      service.generateSebSetupCheckConfiguration({
        startUrl: "https://app.example.com/seb/check",
        quitUrl: "https://app.example.com/seb/check/quit"
      })
    ).not.toThrow();
  });

  it("fails closed before generating an assessment config from legacy weak start or exit passwords", () => {
    const config = {
      toolUrl: "https://app.example.com",
      getApplicationBaseUrl: () => "https://app.example.com",
      getCanvasDomain: () => "https://canvas.example.com",
      value: {
        seb: {
          defaultQuitPassword: undefined,
          requiredDomains: [],
          configEncryption: { enabled: false }
        }
      }
    };
    const service = new SebConfigurationService(config as AppConfig);
    const input = {
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      accessCode: "CODE123"
    };

    expect(() => service.generateSebConfiguration({ ...input, quitPassword: "exit" })).toThrow(
      "Exit password must be at least 8 characters"
    );
    expect(() =>
      service.generateSebConfiguration({
        ...input,
        quitPassword: "unique-exit-passphrase",
        startPassword: "password1"
      })
    ).toThrow("Start password must use at least 5 different letters or numbers");
    expect(() =>
      service.generateSebConfiguration({
        ...input,
        quitPassword: "shared-configuration-passphrase",
        startPassword: "shared-configuration-passphrase"
      })
    ).toThrow("Start and exit passwords must be different unique values");
  });

  it("supports structured exact and domain entries while rejecting caller-authored regex", () => {
    const rules = buildAllowlistRules({
      appBaseUrl: "https://app.example.com",
      canvasBaseUrl: "https://canvas.example.com",
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      requiredDomains: [],
      additionalDomains: [
        "exact:https://tool.example.edu/calculator",
        "domain:docs.example.edu",
        "regex:^https://cdn\\.example\\.edu/assets/.*$"
      ]
    });
    const expressions = rules.map((rule) => rule.expression);

    expect(expressions).toContain("^https://tool\\.example\\.edu/calculator$");
    expect(expressions).toContain("https://docs.example.edu/*");
    expect(expressions).not.toContain("^https://cdn\\.example\\.edu/assets/.*$");
  });

  it("pins exact external-tool queries and rejects query or fragment smuggling", () => {
    const rules = buildAllowlistRules({
      appBaseUrl: "https://app.example.com",
      canvasBaseUrl: "https://canvas.example.com",
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      requiredDomains: [],
      additionalDomains: [
        "exact:https://tool.example.edu/launch?mode=exam&return=https%3A%2F%2Fcanvas.example.com%2Fdone",
        "https://plain.example.edu/calculator",
        "https://trailing.example.edu/launch?return=https://canvas.example.com/done/"
      ]
    });
    const queryRule = rules.find((rule) => rule.expression.includes("tool\\.example\\.edu/launch"));
    const plainRule = rules.find((rule) => rule.expression.includes("plain\\.example\\.edu/calculator"));
    const trailingRule = rules.find((rule) => rule.expression.includes("trailing\\.example\\.edu/launch"));
    const canvasRule = rules.find((rule) => rule.expression.includes("/quizzes/quiz-1(?:/.*)?"));

    expect(queryRule?.regex).toBe(true);
    expect(plainRule?.regex).toBe(true);
    expect(trailingRule?.regex).toBe(true);
    expect(canvasRule?.regex).toBe(true);

    const queryPattern = new RegExp(queryRule!.expression);
    expect(
      queryPattern.test("https://tool.example.edu/launch?mode=exam&return=https%3A%2F%2Fcanvas.example.com%2Fdone")
    ).toBe(true);
    expect(
      queryPattern.test("https://tool.example.edu/launch?mode=exam&return=https%3A%2F%2Fevil.example%2Fsteal")
    ).toBe(false);
    expect(
      queryPattern.test(
        "https://tool.example.edu/launch?mode=exam&return=https%3A%2F%2Fcanvas.example.com%2Fdone&next=https://evil.example"
      )
    ).toBe(false);

    const plainPattern = new RegExp(plainRule!.expression);
    expect(plainPattern.test("https://plain.example.edu/calculator")).toBe(true);
    expect(plainPattern.test("https://plain.example.edu/calculator?next=https://evil.example")).toBe(false);
    expect(plainPattern.test("https://plain.example.edu/calculator#https://evil.example")).toBe(false);
    expect(plainPattern.test("https://plain.example.edu/calculator/redirect")).toBe(false);

    const trailingPattern = new RegExp(trailingRule!.expression);
    expect(trailingPattern.test("https://trailing.example.edu/launch?return=https://canvas.example.com/done/")).toBe(
      true
    );
    expect(trailingPattern.test("https://trailing.example.edu/launch?return=https://canvas.example.com/done")).toBe(
      false
    );

    const canvasPattern = new RegExp(canvasRule!.expression);
    expect(canvasPattern.test("https://canvas.example.com/courses/course-1/quizzes/quiz-1/take?module_item_id=7")).toBe(
      true
    );
  });

  it("allows the complete Canvas New Quiz assignment route family and tenant platform services", () => {
    const rules = buildAllowlistRules({
      appBaseUrl: "https://app.example.com",
      canvasBaseUrl: "https://kentdenver.instructure.com",
      courseId: "11825",
      contentId: "newquiz:11825:437577",
      startUrl: "https://kentdenver.instructure.com/courses/11825/assignments/437577",
      requiredDomains: [],
      additionalDomains: []
    });
    const expressions = rules.map((rule) => rule.expression);

    expect(expressions).toContain(
      "^https://kentdenver\\.instructure\\.com/courses/11825/assignments/437577(?:/.*)?(?:[?#].*)?$"
    );
    expect(expressions).toContain("^https://kentdenver\\.quiz-(?:lti|api)-[a-z0-9-]+\\.instructure\\.com/(?:.*)$");
    expect(expressions).not.toContain("https://kentdenver.instructure.com/*");

    const assignmentRule = rules.find((rule) => rule.expression.includes("/assignments/437577(?:/.*)?"));
    expect(assignmentRule?.regex).toBe(true);
    const assignmentPattern = new RegExp(assignmentRule!.expression);
    expect(assignmentPattern.test("https://kentdenver.instructure.com/courses/11825/assignments/437577/launch")).toBe(
      true
    );
    expect(
      assignmentPattern.test("https://kentdenver.instructure.com/courses/11825/assignments/437577/taking/31299/take")
    ).toBe(true);
    expect(assignmentPattern.test("https://kentdenver.instructure.com/courses/11825/assignments/999999")).toBe(false);
  });

  it("generates a locked-down setup check configuration for the app host", () => {
    process.env.TOOL_URL = "https://app.example.com";
    process.env.CANVAS_BASE_URL = "https://canvas.example.com";
    const service = new SebConfigurationService(new AppConfig());
    const config = service.generateSebSetupCheckConfiguration({
      startUrl: "https://app.example.com/seb/check",
      quitUrl: "https://app.example.com/seb/check/quit"
    });
    const parsed = plist.parse(config.toString("utf8")) as Record<string, any>;
    const expressions = parsed.URLFilterRules.map((rule: { expression: string }) => rule.expression);

    expect(parsed.startURL).toBe("https://app.example.com/seb/check");
    expect(parsed.restartExamURL).toBe("https://app.example.com/seb/check");
    expect(parsed.quitURL).toBe("https://app.example.com/seb/check/quit");
    expect(parsed.allowQuit).toBe(true);
    expect(parsed.ignoreQuitPassword).toBe(true);
    expect(parsed.browserWindowWebView).toBe(3);
    expect(parsed.URLFilterEnable).toBe(true);
    expect(expressions).not.toContain("https://app.example.com/*");
    expect(expressions).toContain("^https://app\\.example\\.com/seb/check$");
    expect(expressions).toContain("^https://app\\.example\\.com/seb/check/quit$");
    expect(expressions.some((expression: string) => expression.includes("canvas.example.com"))).toBe(false);
    expect(expressions.some((expression: string) => expression.includes("google"))).toBe(false);
  });

  it("keeps setup check allowlist scoped to generated app URLs", () => {
    const expressions = buildSetupCheckAllowlistRules({
      appBaseUrl: "https://tool.example.edu",
      startUrl: "https://tool.example.edu/seb/check",
      quitUrl: "https://tool.example.edu/seb/check/quit"
    }).map((rule) => rule.expression);

    expect(expressions).toEqual([
      "^https://tool\\.example\\.edu/seb/check/quit$",
      "^https://tool\\.example\\.edu/seb/check$"
    ]);
  });
});

function startupConfig(hardened: boolean, certificatePem?: string): AppConfig {
  return {
    isHardenedRuntime: () => hardened,
    value: {
      seb: {
        requiredDomains: [],
        configEncryption: {
          enabled: true,
          certificatePem
        }
      }
    }
  } as AppConfig;
}
