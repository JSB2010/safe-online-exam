import { describe, expect, it } from "vitest";
import {
  allowlistEntriesForExternalTools,
  classicQuizContentId,
  enabledExternalTools,
  extractClassicQuizId,
  normalizeExternalTools,
  newQuizContentId,
  parseNewQuizContentId,
  quizToContentItem
} from "../../src/shared/models.js";

describe("content id helpers", () => {
  it("preserves classic quiz and New Quiz id conventions", () => {
    expect(classicQuizContentId("42")).toBe("classicquiz_42");
    expect(newQuizContentId("course-7", "99")).toBe("newquiz:course-7:99");
    expect(parseNewQuizContentId("newquiz:course-7:99")).toEqual({ courseId: "course-7", assignmentId: "99" });
    expect(extractClassicQuizId("classicquiz_42")).toBe("42");
    expect(extractClassicQuizId("42")).toBe("42");
    expect(extractClassicQuizId("assignment_42")).toBeNull();
  });

  it("maps Canvas quizzes to content items for module launch routes", () => {
    expect(
      quizToContentItem({
        id: "42",
        canvasQuizId: "42",
        courseId: "course-7",
        title: "Classic Quiz",
        htmlUrl: "https://canvas.example.com/courses/7/quizzes/42"
      })
    ).toMatchObject({
      id: "classicquiz_42",
      canvasId: "42",
      contentType: "CLASSIC_QUIZ",
      quizTypeDisplay: "Classic Quiz"
    });
  });

  it("normalizes enabled external exam tools and derives allowlist domains", () => {
    const tools = normalizeExternalTools([
      {
        id: "Desmos Calculator",
        label: "Desmos",
        url: "www.desmos.com/calculator",
        enabled: true,
        preset: "desmos-calculator",
        allowedDomains: ["www.desmos.com", "desmos.com", "*.desmos.com", "www.desmos.com"]
      },
      { id: "bad", label: "Bad", url: "http://example.com", enabled: true }
    ]);

    expect(tools).toEqual([
      {
        id: "desmos-calculator",
        label: "Desmos",
        url: "https://www.desmos.com/calculator",
        enabled: true,
        preset: "desmos-calculator",
        allowedDomains: [
          "https://www.desmos.com/assets/build/*",
          "https://www.desmos.com/assets/img/apps/graphing/*",
          "https://www.desmos.com/assets/pwa/*"
        ]
      }
    ]);
    expect(enabledExternalTools(tools)).toHaveLength(1);
    expect(allowlistEntriesForExternalTools(tools)).toEqual([
      "https://www.desmos.com/calculator",
      "https://www.desmos.com/assets/build/*",
      "https://www.desmos.com/assets/img/apps/graphing/*",
      "https://www.desmos.com/assets/pwa/*"
    ]);
  });
});
