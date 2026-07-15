import { describe, expect, it } from "vitest";
import { migrateCourseExamTools } from "../../src/server/services/exam-tool-migration.js";
import {
  assessmentToQuizSebSetting,
  assessmentWithQuizSebSetting,
  courseDefaultsToRecord
} from "../../src/shared/models.js";

describe("exam tool migration", () => {
  it("seeds canonical presets, upgrades legacy Desmos, and preserves a quiz-only tool selection", () => {
    const course = courseDefaultsToRecord("course-1", {
      setupCompleted: true,
      externalTools: [
        {
          id: "desmos-calculator",
          label: "Legacy Desmos",
          url: "https://www.desmos.com/testing/digital-act/graphing",
          enabled: true,
          preset: "desmos-calculator"
        }
      ]
    });
    delete course.sebDefaults.externalToolsInitialized;
    const assessment = assessmentWithQuizSebSetting(null, {
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      usesCourseDefaults: false,
      configKey: "stale-config-key",
      ssoDomains: [],
      educationalToolDomains: [],
      customDomains: [],
      urlRules: [],
      externalTools: [
        {
          id: "formula-sheet",
          label: "Formula sheet",
          url: "https://reference.example.edu/exam",
          enabled: true,
          allowedRules: [{ id: "assets", match: "path", value: "https://reference.example.edu/assets/*" }]
        }
      ]
    });

    const migrated = migrateCourseExamTools("course-1", course, [assessment]);
    const migratedSetting = assessmentToQuizSebSetting(migrated.assessments[0]!);

    expect(migrated.courseChanged).toBe(true);
    expect(migrated.changedAssessmentIds).toEqual(["classicquiz_quiz-1"]);
    expect(migrated.course.sebDefaults.externalTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "desmos-graphing", url: "https://www.desmos.com/calculator", enabled: true }),
        expect.objectContaining({ id: "desmos-scientific", enabled: false }),
        expect.objectContaining({ id: "geogebra-graphing", enabled: false }),
        expect.objectContaining({ id: "geogebra-scientific", enabled: false }),
        expect.objectContaining({ id: "formula-sheet", enabled: false })
      ])
    );
    expect(migratedSetting).toMatchObject({ externalToolIds: ["formula-sheet"], configKey: null });
    expect(migratedSetting.externalTools.filter((tool) => tool.enabled).map((tool) => tool.id)).toEqual([
      "formula-sheet"
    ]);

    const rerun = migrateCourseExamTools("course-1", migrated.course, migrated.assessments);
    expect(rerun.courseChanged).toBe(false);
    expect(rerun.changedAssessmentIds).toEqual([]);
  });
});
