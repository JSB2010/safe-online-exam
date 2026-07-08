import { describe, expect, it } from "vitest";
import {
  allowlistEntriesForExternalTools,
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  assessmentToContentItem,
  assessmentToContentSebSetting,
  assessmentToQuiz,
  assessmentToQuizSebSetting,
  assessmentWithContentSebSetting,
  assessmentWithQuizSebSetting,
  classicQuizContentId,
  courseDefaultsToRecord,
  courseRecordToDefaults,
  defaultCourseSebDefaults,
  defaultContentSebSetting,
  defaultQuizSebSetting,
  enabledExternalTools,
  extractClassicQuizId,
  isInstructor,
  isUnsafeBroadUrlPattern,
  isStudent,
  legacyDomainsToUrlRules,
  normalizeExternalTools,
  normalizeUrlRules,
  newQuizContentId,
  parseNewQuizContentId,
  quizToAssessmentRecord,
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

  it("round-trips Classic Quiz assessment records without losing SEB settings", () => {
    const record = quizToAssessmentRecord(
      {
        id: "42",
        courseId: "course-7",
        title: "Classic Quiz",
        htmlUrl: "https://canvas.example.com/courses/7/quizzes/42"
      },
      assessmentWithQuizSebSetting(null, {
        quizId: "42",
        courseId: "course-7",
        sebRequired: true,
        enabled: true,
        accessCode: "ACCESS",
        ssoDomains: ["login.example.edu"],
        educationalToolDomains: [],
        customDomains: ["domain:docs.example.edu"],
        urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
        externalTools: [{ id: "calc", label: "Calculator", url: "https://calc.example.edu", enabled: true }]
      }),
      "2026-01-01T00:00:00.000Z"
    );

    expect(assessmentToQuiz(record)).toMatchObject({
      id: "42",
      canvasQuizId: "42",
      contentType: "CLASSIC_QUIZ",
      quizTypeDisplay: "Classic Quiz"
    });
    expect(assessmentToContentItem(record)).toMatchObject({
      id: "classicquiz_42",
      contentType: "CLASSIC_QUIZ",
      canvasId: "42"
    });
    expect(assessmentToQuizSebSetting(record)).toMatchObject({
      quizId: "42",
      sebRequired: true,
      accessCode: "ACCESS",
      customDomains: ["domain:docs.example.edu"],
      externalTools: [expect.objectContaining({ id: "calc", url: "https://calc.example.edu/" })]
    });
  });

  it("builds default New Quiz content settings from canonical IDs", () => {
    const setting = defaultContentSebSetting("newquiz:course-7:99");
    const record = assessmentWithContentSebSetting(null, {
      ...setting,
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      externalTools: []
    });

    expect(setting).toMatchObject({
      courseId: "course-7",
      canvasId: "99",
      assignmentId: "99",
      contentType: "NEW_QUIZ"
    });
    expect(record).toMatchObject({
      id: "newquiz:course-7:99",
      courseId: "course-7",
      contentType: "NEW_QUIZ",
      canvas: expect.objectContaining({ assignmentId: "99", quizTypeDisplay: "New Quiz" })
    });
    expect(assessmentToContentSebSetting(record)).toMatchObject({
      contentId: "newquiz:course-7:99",
      assignmentId: "99",
      sebRequired: true
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

  it("normalizes legacy domain entries and rejects unsafe broad allowlists", () => {
    expect(legacyDomainsToUrlRules(["domain:Docs.Example.Edu/path", "exact:tool.example.edu/start"])).toEqual([
      { id: "domain-1", match: "domain", value: "docs.example.edu" },
      { id: "domain-2", match: "exact", value: "https://tool.example.edu/start" }
    ]);
    expect(isUnsafeBroadUrlPattern("*.edu")).toBe(true);
    expect(isUnsafeBroadUrlPattern("^https://cdn\\.example\\.edu/assets/.*$")).toBe(false);
  });

  it("rejects broad regex URL rules before they are saved", () => {
    const rules = normalizeUrlRules([
      { id: "allow-all", match: "regex", value: "^https://.*$" },
      { id: "allow-any", match: "regex", value: ".*" },
      { id: "cdn", match: "regex", value: "^https://cdn\\.example\\.edu/assets/.*$" }
    ]);

    expect(urlRulesToAllowedEntries(rules)).toEqual(["regex:^https://cdn\\.example\\.edu/assets/.*$"]);
  });

  it("applies course defaults while preserving explicit override passwords", () => {
    const defaults = {
      ...defaultCourseSebDefaults("course-1"),
      quitPassword: "default-exit",
      startPassword: "default-start",
      urlRules: [{ id: "docs", match: "domain" as const, value: "docs.example.edu" }],
      externalTools: [{ id: "calc", label: "Calculator", url: "calc.example.edu", enabled: true }],
      setupCompleted: true
    };

    expect(
      applyCourseDefaultsToQuizSetting(
        {
          ...defaultQuizSebSetting("quiz-1", "course-1"),
          sebRequired: true,
          enabled: true,
          quitPasswordOverride: true,
          quitPassword: "custom-exit"
        },
        defaults
      )
    ).toMatchObject({
      quitPassword: "custom-exit",
      startPassword: "default-start",
      customDomains: ["domain:docs.example.edu"],
      externalTools: [expect.objectContaining({ id: "calc" })],
      usesCourseDefaults: true
    });

    expect(
      applyCourseDefaultsToContentSetting(
        {
          ...defaultContentSebSetting("newquiz:course-1:99"),
          sebRequired: true,
          enabled: true,
          usesCourseDefaults: false,
          urlRules: [{ id: "custom", match: "domain", value: "custom.example.edu" }],
          externalTools: []
        },
        defaults
      )
    ).toMatchObject({
      startPassword: "default-start",
      customDomains: ["domain:custom.example.edu"],
      externalTools: [],
      usesCourseDefaults: false
    });
  });

  it("round-trips course defaults through stored course records", () => {
    const record = courseDefaultsToRecord("course-1", {
      quitPassword: " exit ",
      setupCompleted: true,
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: [{ id: "calc", label: "Calculator", url: "calc.example.edu", enabled: true }]
    });

    expect(courseRecordToDefaults(record, "course-1")).toMatchObject({
      courseId: "course-1",
      quitPassword: "exit",
      setupCompleted: true,
      urlRules: [{ id: "docs", match: "domain", value: "docs.example.edu" }],
      externalTools: [expect.objectContaining({ id: "calc", url: "https://calc.example.edu/" })]
    });
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

  it("parses JSON custom role lists and legacy LTI role URNs", () => {
    expect(
      isInstructor({
        roles: [],
        custom: {
          canvas_lis_membership_roles: JSON.stringify(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"])
        }
      })
    ).toBe(true);
    expect(isInstructor({ roles: ["urn:lti:role:ims/lis/Instructor"] })).toBe(true);
    expect(isStudent({ roles: ["urn:lti:ims/lis/Learner"] })).toBe(true);
    expect(isStudent({ roles: ["http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student"] })).toBe(true);
  });
});
