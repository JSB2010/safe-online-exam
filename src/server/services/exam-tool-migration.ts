import type {
  AssessmentRecord,
  ContentSebSetting,
  CourseRecord,
  ExternalToolConfig,
  QuizSebSetting
} from "../../shared/models.js";
import {
  applyCourseDefaultsToContentSetting,
  applyCourseDefaultsToQuizSetting,
  assessmentToContentSebSetting,
  assessmentToQuizSebSetting,
  assessmentWithContentSebSetting,
  assessmentWithQuizSebSetting,
  courseDefaultsToRecord,
  courseRecordToDefaults,
  normalizeExternalTools
} from "../../shared/models.js";

export interface CourseExamToolMigration {
  course: CourseRecord;
  assessments: AssessmentRecord[];
  courseChanged: boolean;
  changedAssessmentIds: string[];
}

/**
 * Converts one course's legacy quiz-owned external tools to the course catalog.
 * This is deliberately pure so dry runs cannot alter persisted records and the
 * result can be verified independently of the migration command.
 */
export function migrateCourseExamTools(
  courseId: string,
  existingCourse: CourseRecord | null | undefined,
  assessments: AssessmentRecord[]
): CourseExamToolMigration {
  const defaults = courseRecordToDefaults(existingCourse, courseId);
  const catalog = [...defaults.externalTools];
  const legacyToolsByAssessment = new Map<string, ExternalToolConfig[]>();

  for (const assessment of assessments) {
    const setting = toSebSetting(assessment);
    if (!setting) continue;
    const legacyTools = normalizeExternalTools(setting.externalTools);
    legacyToolsByAssessment.set(assessment.id, legacyTools);
    for (const legacyTool of legacyTools) {
      const existing = catalog.find((tool) => tool.id === legacyTool.id);
      if (!existing) {
        // Old quiz-only custom tools become course definitions, but remain
        // disabled by default. The originating quiz receives an explicit id.
        catalog.push({ ...legacyTool, enabled: false });
      } else if (existing.preset && setting.usesCourseDefaults !== false && legacyTool.enabled) {
        // A pre-catalog defaulted Desmos setting carried the course default in
        // every assessment. Retain that state while converting it to the new
        // canonical preset rather than silently disabling current exams.
        existing.enabled = true;
      }
    }
  }

  const course = courseDefaultsToRecord(courseId, { ...defaults, externalTools: catalog }, existingCourse || undefined);
  const nextDefaults = courseRecordToDefaults(course, courseId);
  const nextAssessments: AssessmentRecord[] = [];
  const changedAssessmentIds: string[] = [];

  for (const assessment of assessments) {
    const current = toSebSetting(assessment);
    if (!current) {
      nextAssessments.push(assessment);
      continue;
    }
    const legacyTools = legacyToolsByAssessment.get(assessment.id) || [];
    const legacyEnabledIds = legacyTools.filter((tool) => tool.enabled).map((tool) => tool.id);
    const hasQuizOnlyCustomSelection = legacyTools.some(
      (tool) =>
        tool.enabled && nextDefaults.externalTools.find((catalogTool) => catalogTool.id === tool.id)?.enabled !== true
    );
    const externalToolIds =
      current.externalToolIds === undefined
        ? current.usesCourseDefaults === false || hasQuizOnlyCustomSelection
          ? legacyEnabledIds
          : null
        : current.externalToolIds;
    const next =
      assessment.contentType === "CLASSIC_QUIZ"
        ? assessmentWithQuizSebSetting(assessment, {
            ...applyCourseDefaultsToQuizSetting({ ...(current as QuizSebSetting), externalToolIds }, nextDefaults),
            configKey: null
          })
        : assessmentWithContentSebSetting(assessment, {
            ...applyCourseDefaultsToContentSetting(
              { ...(current as ContentSebSetting), externalToolIds },
              nextDefaults
            ),
            configKey: null
          });
    nextAssessments.push(next);
    if (JSON.stringify(assessment.seb) !== JSON.stringify(next.seb)) {
      changedAssessmentIds.push(assessment.id);
    }
  }

  return {
    course,
    assessments: nextAssessments,
    courseChanged:
      existingCourse?.sebDefaults?.externalToolsInitialized !== true ||
      JSON.stringify(existingCourse?.sebDefaults?.externalTools || []) !==
        JSON.stringify(course.sebDefaults.externalTools),
    changedAssessmentIds
  };
}

function toSebSetting(assessment: AssessmentRecord) {
  return assessment.contentType === "CLASSIC_QUIZ"
    ? assessmentToQuizSebSetting(assessment)
    : assessmentToContentSebSetting(assessment);
}
