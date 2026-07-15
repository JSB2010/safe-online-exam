import { AppConfig } from "../src/server/config/app-config.js";
import { createRepositories } from "../src/server/data/repositories.js";
import type { AssessmentRecord } from "../src/shared/models.js";
import { migrateCourseExamTools } from "../src/server/services/exam-tool-migration.js";

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log("Usage: npm run migrate:exam-tools -- [--dry-run|--apply]");
  console.log("Defaults to --dry-run. --apply writes the catalog and assessment selections.");
  process.exit(0);
}
if (args.has("--apply") && args.has("--dry-run")) {
  throw new Error("Choose either --dry-run or --apply, not both");
}
if ([...args].some((arg) => arg !== "--apply" && arg !== "--dry-run")) {
  throw new Error("Unknown argument. Use --help for supported options.");
}

const apply = args.has("--apply");
const repositories = createRepositories(new AppConfig());
const [courses, assessments] = await Promise.all([repositories.courses.find(), repositories.assessments.find()]);
const coursesById = new Map(courses.map((course) => [course.courseId || course.id || "", course]));
const assessmentsByCourse = new Map<string, AssessmentRecord[]>();
for (const assessment of assessments) {
  if (!assessment.courseId) continue;
  assessmentsByCourse.set(assessment.courseId, [...(assessmentsByCourse.get(assessment.courseId) || []), assessment]);
}
const courseIds = new Set([...coursesById.keys(), ...assessmentsByCourse.keys()].filter(Boolean));
let changedCourses = 0;
let changedAssessments = 0;

for (const courseId of courseIds) {
  const existingCourse = coursesById.get(courseId) || null;
  const courseAssessments = assessmentsByCourse.get(courseId) || [];
  const migration = migrateCourseExamTools(courseId, existingCourse, courseAssessments);
  if (migration.courseChanged) {
    changedCourses += 1;
    if (apply) await repositories.courses.save(courseId, migration.course);
  }
  changedAssessments += migration.changedAssessmentIds.length;
  if (apply) {
    for (const assessment of migration.assessments) {
      if (migration.changedAssessmentIds.includes(assessment.id)) {
        await repositories.assessments.save(assessment.id, assessment);
      }
    }
  }
}

console.log(
  `${apply ? "Applied" : "Dry run:"} ${changedCourses} course catalog update(s), ${changedAssessments} assessment selection update(s).`
);
