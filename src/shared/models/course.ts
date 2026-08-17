import { ExternalToolConfig, normalizeCourseExternalTools, seedCourseExternalTools } from "./external-tools.js";
import { normalizeOptionalText } from "./normalization.js";
import { SebUrlRule, normalizeUrlRules } from "./url-rules.js";

export interface CourseSebDefaults {
  id?: string | null;
  courseId: string;
  quitPassword?: string | null;
  startPassword?: string | null;
  urlRules: SebUrlRule[];
  externalTools: ExternalToolConfig[];
  /**
   * Internal persistence marker. A missing marker denotes a pre-catalog
   * course, which is seeded once; an explicit empty catalog means an
   * instructor intentionally removed every preloaded tool.
   */
  externalToolsInitialized?: boolean;
  setupCompleted: boolean;
  /** Secret-free response hint; never persisted as configuration. */
  hasQuitPassword?: boolean;
  /** Secret-free response hint; never persisted as configuration. */
  hasEffectiveQuitPassword?: boolean;
  /** Secret-free response hint; never persisted as configuration. */
  hasStartPassword?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CourseRecord {
  id?: string | null;
  courseId: string;
  setupCompleted: boolean;
  sebDefaults: {
    quitPassword?: string | null;
    startPassword?: string | null;
    urlRules: SebUrlRule[];
    externalTools: ExternalToolConfig[];
    externalToolsInitialized?: boolean;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export function defaultCourseSebDefaults(courseId: string): CourseSebDefaults {
  return {
    id: courseId,
    courseId,
    quitPassword: null,
    startPassword: null,
    urlRules: [],
    externalTools: [],
    externalToolsInitialized: true,
    setupCompleted: false
  };
}

export function courseRecordToDefaults(record: CourseRecord | null | undefined, courseId: string): CourseSebDefaults {
  return normalizeCourseSebDefaults({
    id: record?.id || courseId,
    courseId: record?.courseId || courseId,
    setupCompleted: !!record?.setupCompleted,
    quitPassword: record?.sebDefaults?.quitPassword || null,
    startPassword: record?.sebDefaults?.startPassword || null,
    urlRules: record?.sebDefaults?.urlRules || [],
    externalTools: record?.sebDefaults?.externalTools,
    externalToolsInitialized: record?.sebDefaults?.externalToolsInitialized === true,
    createdAt: record?.createdAt,
    updatedAt: record?.updatedAt
  });
}

export function courseDefaultsToRecord(
  courseId: string,
  defaults: Partial<CourseSebDefaults>,
  existing?: CourseRecord | null
): CourseRecord {
  const normalized = normalizeCourseSebDefaults({
    ...defaultCourseSebDefaults(courseId),
    ...defaults,
    id: courseId,
    courseId
  });
  return {
    ...existing,
    id: courseId,
    courseId,
    setupCompleted: normalized.setupCompleted,
    sebDefaults: {
      quitPassword: normalized.quitPassword,
      startPassword: normalized.startPassword,
      urlRules: normalized.urlRules,
      externalTools: normalized.externalTools,
      externalToolsInitialized: true
    },
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt
  };
}

export function normalizeCourseSebDefaults(input: Partial<CourseSebDefaults> | null | undefined): CourseSebDefaults {
  const courseId = input?.courseId?.trim() || input?.id?.trim() || "";
  return {
    ...defaultCourseSebDefaults(courseId),
    ...input,
    id: input?.id || courseId,
    courseId,
    quitPassword: normalizeOptionalText(input?.quitPassword),
    startPassword: normalizeOptionalText(input?.startPassword),
    urlRules: normalizeUrlRules(input?.urlRules),
    externalTools:
      input?.externalToolsInitialized === true
        ? normalizeCourseExternalTools(input?.externalTools)
        : seedCourseExternalTools(input?.externalTools),
    externalToolsInitialized: input?.externalToolsInitialized === true,
    setupCompleted: !!input?.setupCompleted
  };
}
