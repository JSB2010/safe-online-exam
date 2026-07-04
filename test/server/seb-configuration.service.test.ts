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
      startUrl: "https://canvas.example.com/courses/course-1/quizzes/quiz-1",
      accessCode: "CODE123",
      allowedDomains: ["www.desmos.com"],
      quitPassword: "exit"
    });
    const parsed = plist.parse(config.toString("utf8")) as Record<string, any>;
    expect(parsed.startURL).toBe("https://canvas.example.com/courses/course-1/quizzes/quiz-1");
    expect(parsed.quitURL).toBe("https://app.example.com/seb/exit/quit/course-1/quiz-1");
    expect(parsed.hashedQuitPassword).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.urlFilterRules).toEqual(
      expect.arrayContaining([expect.objectContaining({ expression: "https://www.desmos.com/*" })])
    );
  });

  it("rejects unsafe broad allowlist patterns", () => {
    const rules = buildAllowlistRules({
      appBaseUrl: "https://app.example.com",
      canvasBaseUrl: "https://canvas.example.com",
      requiredDomains: [],
      additionalDomains: ["https://*/*", "*.amazonaws.com", "docs.google.com"]
    });
    expect(rules.map((rule) => rule.expression)).toContain("https://docs.google.com/*");
    expect(rules.map((rule) => rule.expression)).not.toContain("https://*/*");
    expect(rules.map((rule) => rule.expression)).not.toContain("https://*.amazonaws.com/*");
  });
});
