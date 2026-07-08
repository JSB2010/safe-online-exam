import { describe, expect, it } from "vitest";
import {
  allowlistEntriesForExternalTools,
  classicQuizContentId,
  enabledExternalTools,
  extractClassicQuizId,
  isInstructor,
  isStudent,
  normalizeExternalTools,
  normalizeUrlRules,
  newQuizContentId,
  parseNewQuizContentId,
  quizToContentItem,
  urlRulesToAllowedEntries
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

  it("maps Canvas quizzes to canonical Classic Quiz content items", () => {
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

  it("normalizes structured URL rules for exact, domain, and regex allowlists", () => {
    const rules = normalizeUrlRules([
      { id: "exact", match: "exact", value: "https://example.edu/tool" },
      { id: "domain", match: "domain", value: "docs.example.edu/path-is-ignored" },
      { id: "regex", match: "regex", value: "^https://cdn\\.example\\.edu/assets/.*$" }
    ]);

    expect(urlRulesToAllowedEntries(rules)).toEqual([
      "exact:https://example.edu/tool",
      "domain:docs.example.edu",
      "regex:^https://cdn\\.example\\.edu/assets/.*$"
    ]);
  });

  it("rejects broad regex URL rules before they are saved", () => {
    const rules = normalizeUrlRules([
      { id: "allow-all", match: "regex", value: "^https://.*$" },
      { id: "allow-any", match: "regex", value: ".*" },
      { id: "cdn", match: "regex", value: "^https://cdn\\.example\\.edu/assets/.*$" }
    ]);

    expect(urlRulesToAllowedEntries(rules)).toEqual(["regex:^https://cdn\\.example\\.edu/assets/.*$"]);
  });
});

describe("LTI role helpers", () => {
  it("does not treat institution instructor roles as course instructor access", () => {
    const launchData = {
      roles: [
        "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor",
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"
      ]
    };

    expect(isInstructor(launchData)).toBe(false);
    expect(isStudent(launchData)).toBe(true);
  });

  it("prefers Canvas course membership custom fields when Canvas provides them", () => {
    expect(
      isInstructor({
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
        custom: { canvas_membership_roles: "TeacherEnrollment" }
      })
    ).toBe(true);
    expect(
      isInstructor({
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor"],
        custom: { canvas_membership_roles: "StudentEnrollment" }
      })
    ).toBe(false);
    expect(
      isStudent({
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor"],
        custom: { canvas_membership_roles: "StudentEnrollment" }
      })
    ).toBe(true);
  });
});
