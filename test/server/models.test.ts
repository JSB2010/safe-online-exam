import { describe, expect, it } from "vitest";
import type { AssessmentRecord } from "../../src/shared/models.js";
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
  canEnableSebAssessment,
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

describe("secret-free SEB client policy", () => {
  it("lets the client enable SEB only from a secret-free effective-password signal", () => {
    expect(canEnableSebAssessment({ hasEffectiveQuitPassword: true }, null)).toBe(true);
    expect(canEnableSebAssessment(null, { hasEffectiveQuitPassword: true })).toBe(true);
    expect(canEnableSebAssessment({ hasEffectiveQuitPassword: false }, { hasEffectiveQuitPassword: false })).toBe(
      false
    );
    expect(canEnableSebAssessment(undefined, undefined)).toBe(false);
  });
});

describe("content id helpers", () => {
  it("preserves classic quiz and New Quiz id conventions", () => {
    expect(classicQuizContentId("42")).toBe("classicquiz_42");
    expect(newQuizContentId("course-7", "99")).toBe("newquiz:course-7:99");
    expect(parseNewQuizContentId("newquiz:course-7:99")).toEqual({ courseId: "course-7", assignmentId: "99" });
    expect(extractClassicQuizId("classicquiz_42")).toBe("42");
    expect(extractClassicQuizId("42")).toBe("42");
    expect(extractClassicQuizId("assignment_42")).toBeNull();
  });

  it("rejects malformed and ambiguous New Quiz content IDs", () => {
    for (const contentId of [
      "newquiz:course-7:99:extra",
      "newquiz:course-7:../99",
      "newquiz:course-7:%2f",
      "newquiz:*.*:99",
      "newquiz:course 7:99",
      "newquiz::99",
      "newquiz:course-7:"
    ]) {
      expect(parseNewQuizContentId(contentId), contentId).toBeNull();
    }
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

  it("drops legacy raw Canvas metadata before returning or rewriting New Quiz records", () => {
    const record: AssessmentRecord = {
      id: "newquiz:course-7:99",
      courseId: "course-7",
      contentType: "NEW_QUIZ",
      canvas: {
        id: "99",
        assignmentId: "99",
        title: "New Quiz",
        metadata: {
          quiz_settings: { student_access_code: "CANVAS-ACCESS-SECRET" },
          config_key: "CANVAS-CONFIG-SECRET"
        }
      },
      seb: {
        required: true,
        enabled: true,
        accessCode: "INTERNAL-ACCESS-CODE",
        usesCourseDefaults: true,
        quitPasswordOverride: false,
        startPasswordOverride: false,
        ssoDomains: [],
        educationalToolDomains: [],
        customDomains: [],
        urlRules: [],
        externalTools: []
      }
    };

    const content = assessmentToContentItem(record);
    const setting = assessmentToContentSebSetting(record);
    const rewritten = assessmentWithContentSebSetting(record, setting);

    expect(JSON.stringify(content)).not.toContain("CANVAS-ACCESS-SECRET");
    expect(JSON.stringify(content)).not.toContain("CANVAS-CONFIG-SECRET");
    expect(content).not.toHaveProperty("metadata");
    expect(JSON.stringify(setting)).not.toContain("CANVAS-ACCESS-SECRET");
    expect(JSON.stringify(setting)).not.toContain("CANVAS-CONFIG-SECRET");
    expect(setting).not.toHaveProperty("metadata");
    expect(rewritten.canvas.metadata).toBeNull();
  });

  it("normalizes enabled external exam tools and derives allowlist domains", () => {
    const tools = normalizeExternalTools([
      {
        id: "Desmos Calculator",
        label: "Attacker-controlled label",
        url: "https://evil.example.edu/cheat",
        enabled: true,
        preset: "desmos-calculator",
        allowedDomains: ["regex:^https://.+$", "domain:evil.example.edu"],
        matchType: "regex",
        allowedPattern: "^https://.+$"
      },
      { id: "bad", label: "Bad", url: "http://example.com", enabled: true }
    ]);

    expect(tools).toEqual([
      {
        id: "desmos-calculator",
        label: "Desmos Test Mode",
        url: "https://www.desmos.com/testing/digital-act/graphing",
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
      "https://www.desmos.com/testing/digital-act/graphing",
      "https://www.desmos.com/assets/build/*",
      "https://www.desmos.com/assets/img/apps/graphing/*",
      "https://www.desmos.com/assets/pwa/*"
    ]);
  });

  it("normalizes only canonical exact and domain URL rules", () => {
    const rules = normalizeUrlRules([
      { id: "exact", match: "exact", value: "https://example.edu/tool" },
      { id: "domain", match: "domain", value: "Docs.Example.Edu" },
      { id: "domain-with-path", match: "domain", value: "docs.example.edu/path" },
      { id: "wildcard-domain", match: "domain", value: "*.example.edu" },
      { id: "insecure-exact", match: "exact", value: "http://example.edu/tool" },
      { id: "regex", match: "regex", value: "^https://cdn\\.example\\.edu/assets/.*$" }
    ]);

    expect(urlRulesToAllowedEntries(rules)).toEqual(["exact:https://example.edu/tool", "domain:docs.example.edu"]);
  });

  it("normalizes legacy domain entries and rejects unsafe broad allowlists", () => {
    expect(
      legacyDomainsToUrlRules([
        "domain:Docs.Example.Edu",
        "exact:tool.example.edu/start",
        "domain:docs.example.edu/path",
        "regex:^https://cdn\\.example\\.edu/assets/.*$",
        "domain:*.*"
      ])
    ).toEqual([
      { id: "domain-1", match: "domain", value: "docs.example.edu" },
      { id: "domain-2", match: "exact", value: "https://tool.example.edu/start" }
    ]);
    expect(isUnsafeBroadUrlPattern("*.edu")).toBe(true);
    expect(isUnsafeBroadUrlPattern("^https://cdn\\.example\\.edu/assets/.*$")).toBe(false);
  });

  it("rejects all caller-authored regex and wildcard URL rules before they are saved", () => {
    const rules = normalizeUrlRules([
      { id: "allow-all", match: "regex", value: "^https://.*$" },
      { id: "allow-any", match: "regex", value: ".*" },
      { id: "allow-nonempty", match: "regex", value: "^https://.+$" },
      { id: "allow-any-character", match: "regex", value: "^https://[\\s\\S]+$" },
      { id: "cdn", match: "regex", value: "^https://cdn\\.example\\.edu/assets/.*$" },
      { id: "wildcard", match: "domain", value: "*.*" }
    ]);

    expect(rules).toEqual([]);
    expect(urlRulesToAllowedEntries(rules)).toEqual([]);
  });

  it("fails closed when normalizing unsafe persisted course policy", () => {
    const defaults = courseRecordToDefaults(
      {
        id: "course-1",
        courseId: "course-1",
        setupCompleted: true,
        sebDefaults: {
          urlRules: [
            { id: "regex", match: "regex", value: "^https://.+$" },
            { id: "wildcard", match: "domain", value: "*.*" },
            { id: "docs", match: "domain", value: "Docs.Example.Edu" }
          ],
          externalTools: [
            {
              id: "desmos-calculator",
              label: "Changed",
              url: "https://evil.example.edu/",
              enabled: true,
              preset: "desmos-calculator",
              allowedDomains: ["regex:^https://.+$"]
            }
          ]
        }
      },
      "course-1"
    );

    expect(defaults.urlRules).toEqual([{ id: "docs", match: "domain", value: "docs.example.edu" }]);
    expect(defaults.externalTools).toEqual([
      {
        id: "desmos-calculator",
        label: "Desmos Test Mode",
        url: "https://www.desmos.com/testing/digital-act/graphing",
        enabled: true,
        preset: "desmos-calculator",
        allowedDomains: [
          "https://www.desmos.com/assets/build/*",
          "https://www.desmos.com/assets/img/apps/graphing/*",
          "https://www.desmos.com/assets/pwa/*"
        ]
      }
    ]);
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

  it("keeps standard LTI roles authoritative over custom Canvas substitutions", () => {
    expect(
      isInstructor({
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
        custom: { canvas_membership_roles: "TeacherEnrollment" }
      })
    ).toBe(false);
    expect(
      isInstructor({
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
        custom: { canvas_membership_roles: "StudentEnrollment" }
      })
    ).toBe(true);
    expect(
      isStudent({
        roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
        custom: { canvas_membership_roles: "StudentEnrollment" }
      })
    ).toBe(false);
  });

  it("does not elevate JSON custom role lists and still supports legacy standard LTI role URNs", () => {
    expect(
      isInstructor({
        roles: [],
        custom: {
          canvas_lis_membership_roles: JSON.stringify(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"])
        }
      })
    ).toBe(false);
    expect(isInstructor({ roles: ["urn:lti:role:ims/lis/Instructor"] })).toBe(true);
    expect(isStudent({ roles: ["urn:lti:ims/lis/Learner"] })).toBe(true);
    expect(isStudent({ roles: ["http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student"] })).toBe(true);
  });
});
