import { describe, expect, it } from "vitest";
import plist from "plist";
import { AppConfig } from "../../src/server/config/app-config.js";
import { buildAllowlistRules, SebConfigurationService } from "../../src/server/services/seb-configuration.service.js";

describe("SebConfigurationService", () => {
  it("generates deterministic SEB config with Canvas start and quit URLs", () => {
    process.env.TOOL_URL = "https://app.example.com";
    process.env.CANVAS_BASE_URL = "https://canvas.example.com";
    const service = new SebConfigurationService(new AppConfig());
    const config = service.generateSebConfiguration({
      courseId: "course-1",
      contentId: "classicquiz_quiz-1",
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1/take",
      accessCode: "CODE123",
      allowedDomains: ["https://www.desmos.com/calculator", "https://www.desmos.com/assets/build/*"],
      quitPassword: "exit"
    });
    const parsed = plist.parse(config.toString("utf8")) as Record<string, any>;
    const expressions = parsed.URLFilterRules.map((rule: { expression: string }) => rule.expression);
    expect(parsed.startURL).toBe("https://canvas.example.com/courses/course-1/quizzes/quiz-1/take");
    expect(parsed.restartExamURL).toBe("https://canvas.example.com/courses/course-1/quizzes/quiz-1/take");
    expect(parsed.quitURL).toBe("https://app.example.com/seb/exit/quit/course-1/quiz-1");
    expect(parsed.hashedQuitPassword).toMatch(/^[a-f0-9]{64}$/u);
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
          expression: "^https://www\\.desmos\\.com/calculator(?:[?#].*)?$"
        }),
        expect.objectContaining({ regex: false, expression: "https://www.desmos.com/assets/build/*" })
      ])
    );
    expect(expressions).toContain("https://accounts.google.com/*");
    expect(expressions).not.toContain("https://*.google.com/*");
    expect(expressions).toContain("^https://www\\.google\\.com/accounts/(?:.*)$");
    expect(expressions).toContain("^https://accounts\\.youtube\\.com/accounts/(?:.*)$");
    expect(expressions).toContain("^https://fonts\\.googleapis\\.com/(?:.*)$");
    expect(expressions).toContain("^https://sso\\.canvaslms\\.com/(?:.*)$");
    expect(expressions).toContain("https://du11hjcvx0uqb.cloudfront.net/*");
    expect(expressions).toContain("https://d2l3jyjp24noqc.cloudfront.net/*");
    expect(expressions).toContain("https://canvas-static.s3.amazonaws.com/*");
    expect(expressions).toContain("https://canvas-network.s3.amazonaws.com/*");
    expect(expressions).toContain("https://instructure-uploads.s3.amazonaws.com/*");
    expect(expressions).toContain("https://instructure-uploads-prod.s3.amazonaws.com/*");
    expect(expressions).toContain("https://canvas-rce.instructure.com/*");
    expect(expressions).not.toContain("https://www.google.com/*");
    expect(expressions).not.toContain("https://*.youtube.com/*");
    expect(expressions).not.toContain("https://*.canvaslms.com/*");
    expect(expressions).not.toContain("https://*.instructure.com/*");
    expect(expressions).not.toContain("https://*.cloudfront.net/*");
    expect(expressions).not.toContain("https://canvas.example.com/*");
    expect(expressions).not.toContain("https://www.desmos.com/*");
    expect(expressions).not.toContain("https://canvas.example.com/courses/course-1/*");
    expect(parsed.urlFilterRules).toBeUndefined();
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

  it("supports structured exact, domain, and regex allowlist entries", () => {
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

    expect(expressions).toContain("^https://tool\\.example\\.edu/calculator(?:[?#].*)?$");
    expect(expressions).toContain("https://docs.example.edu/*");
    expect(expressions).toContain("^https://cdn\\.example\\.edu/assets/.*$");
  });
});
