import type {
  AdminAccountSettingsRecord,
  AdminCourseConnectionRecord,
  AdminToolPresetRecord,
  AdminToolPresetAssignmentRecord,
  AssessmentRecord,
  CourseRecord,
  OAuthToken
} from "../../shared/models.js";
import { isExpired, prepareDocument, withDocumentId } from "./document-values.js";
import type {
  AppRepositories,
  AdminCourseConnectionListOptions,
  AdminCourseConnectionStore,
  AdminCourseConnectionSummary,
  CollectionStore,
  OperationLockRecord,
  OperationLockStore,
  QueryFilter,
  QueryOptions,
  SessionRecord,
  TransientStateRecord,
  TransientStateStore
} from "./repository-contracts.js";

export function createInMemoryRepositories(
  seed?: Partial<Record<keyof AppRepositories, Record<string, any>>>
): AppRepositories {
  return {
    adminAccountSettings: new InMemoryCollectionStore<AdminAccountSettingsRecord>(seed?.adminAccountSettings),
    adminCourseConnections: new InMemoryAdminCourseConnectionStore(seed?.adminCourseConnections),
    adminToolPresetAssignments: new InMemoryCollectionStore<AdminToolPresetAssignmentRecord>(
      seed?.adminToolPresetAssignments
    ),
    adminToolPresets: new InMemoryCollectionStore<AdminToolPresetRecord>(seed?.adminToolPresets),
    assessments: new InMemoryCollectionStore<AssessmentRecord>(seed?.assessments),
    courses: new InMemoryCollectionStore<CourseRecord>(seed?.courses),
    oauthTokens: new InMemoryCollectionStore<OAuthToken>(seed?.oauthTokens),
    sessions: new InMemoryCollectionStore<SessionRecord>(seed?.sessions),
    transientStates: new InMemoryTransientStateStore(seed?.transientStates),
    operationLocks: new InMemoryOperationLockStore(seed?.operationLocks)
  };
}

export class InMemoryCollectionStore<T extends Record<string, any>> implements CollectionStore<T> {
  protected readonly documents = new Map<string, T>();

  constructor(seed?: Record<string, T>) {
    if (seed) {
      for (const [id, value] of Object.entries(seed)) {
        this.documents.set(id, structuredClone(value));
      }
    }
  }

  async get(id: string): Promise<T | null> {
    const value = this.documents.get(id);
    return value ? withDocumentId(id, value) : null;
  }

  async save(id: string, value: T): Promise<T> {
    const next = prepareDocument(id, value, new Date().toISOString());
    this.documents.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async update(id: string, updater: (current: T | null) => T | null): Promise<T | null> {
    const updated = updater(await this.get(id));
    return updated ? this.save(id, updated) : null;
  }

  async delete(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async find(filters: QueryFilter[] = [], options: QueryOptions = {}): Promise<T[]> {
    const values = Array.from(this.documents.entries())
      .filter(([, value]) => filters.every((filter) => matchesFilter(value, filter)))
      .map(([id, value]) => withDocumentId(id, value));
    const orderBy = options.orderBy || "id";
    const direction = options.direction === "desc" ? -1 : 1;
    values.sort((left, right) => String(left[orderBy] || "").localeCompare(String(right[orderBy] || "")) * direction);
    return values.slice(0, normalizedQueryLimit(options.limit, values.length));
  }

  async saveMany(values: Array<{ id: string; value: T }>): Promise<T[]> {
    const saved: T[] = [];
    for (const entry of values) {
      saved.push(await this.save(entry.id, entry.value));
    }
    return saved;
  }
}

class InMemoryAdminCourseConnectionStore
  extends InMemoryCollectionStore<AdminCourseConnectionRecord>
  implements AdminCourseConnectionStore
{
  async listForRoot(
    rootAccountId: string,
    options: AdminCourseConnectionListOptions
  ): Promise<AdminCourseConnectionRecord[]> {
    const search = options.search?.trim().toLocaleLowerCase() || "";
    return Array.from(this.documents.entries())
      .map(([id, value]) => withDocumentId(id, value))
      .filter((course) => course.rootAccountId === rootAccountId)
      .filter((course) =>
        options.includePast ? true : course.concluded !== true && (!options.termId || course.termId === options.termId)
      )
      .filter(
        (course) =>
          !search ||
          [course.name, course.courseCode, course.courseId, course.termName, ...course.teacherNames]
            .filter(Boolean)
            .some((value) => String(value).toLocaleLowerCase().includes(search))
      )
      .sort(compareCourseConnections)
      .filter(
        (course) =>
          !options.afterName || compareCourseCursor(course, options.afterName, options.afterCourseId || "") > 0
      )
      .slice(0, Math.min(Math.max(options.limit, 1), 100));
  }

  async summarizeForRoot(
    rootAccountId: string,
    options: Pick<AdminCourseConnectionListOptions, "termId" | "includePast"> = {}
  ): Promise<AdminCourseConnectionSummary> {
    const courses = Array.from(this.documents.values())
      .filter((course) => course.rootAccountId === rootAccountId)
      .filter((course) =>
        options.includePast ? true : course.concluded !== true && (!options.termId || course.termId === options.termId)
      );
    return courses.reduce(
      (summary, course) => ({
        courseCount: summary.courseCount + 1,
        assessmentCount: summary.assessmentCount + course.assessmentCount,
        enabledAssessmentCount: summary.enabledAssessmentCount + course.enabledAssessmentCount,
        issueCount: summary.issueCount + course.issueCount
      }),
      { courseCount: 0, assessmentCount: 0, enabledAssessmentCount: 0, issueCount: 0 }
    );
  }
}

function compareCourseConnections(left: AdminCourseConnectionRecord, right: AdminCourseConnectionRecord): number {
  return compareCourseCursor(left, right.name, right.courseId);
}

function compareCourseCursor(course: AdminCourseConnectionRecord, name: string, courseId: string): number {
  const byName = course.name.localeCompare(name, undefined, { sensitivity: "base" });
  return byName || course.courseId.localeCompare(courseId);
}

function normalizedQueryLimit(limit: number | undefined, fallback: number): number {
  return Number.isSafeInteger(limit) && Number(limit) > 0 ? Math.min(Number(limit), 10_000) : fallback;
}

export class InMemoryTransientStateStore
  extends InMemoryCollectionStore<TransientStateRecord>
  implements TransientStateStore
{
  async consumeBudget(id: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.documents.get(id);
    const existingCount =
      existing?.kind === "admission-budget" && !isExpired(existing.expiresAt, now) ? Number(existing.count) || 0 : 0;
    if (existingCount >= limit) {
      return false;
    }
    const nowIso = new Date(now).toISOString();
    const next = prepareDocument(
      id,
      {
        ...(existingCount ? existing : {}),
        kind: "admission-budget",
        count: existingCount + 1,
        expiresAt: existingCount ? existing!.expiresAt : new Date(now + windowMs)
      } as TransientStateRecord,
      nowIso
    );
    this.documents.set(id, structuredClone(next));
    return true;
  }

  async claim(id: string, value: TransientStateRecord): Promise<boolean> {
    const existing = await this.get(id);
    if (existing && !isExpired(existing.expiresAt)) {
      return false;
    }
    await this.save(id, value);
    return true;
  }

  async consume(id: string): Promise<TransientStateRecord | null> {
    const existing = await this.get(id);
    if (!existing || existing.consumedAt || isExpired(existing.expiresAt)) {
      if (existing && isExpired(existing.expiresAt)) {
        await this.delete(id);
      }
      return null;
    }
    const consumedAt = new Date().toISOString();
    await this.save(id, { ...existing, consumedAt });
    return { ...existing, consumedAt };
  }
}

export class InMemoryOperationLockStore
  extends InMemoryCollectionStore<OperationLockRecord>
  implements OperationLockStore
{
  async acquire(id: string, ownerId: string, ttlMs: number): Promise<boolean> {
    if (!isValidLockTtl(ttlMs)) {
      return false;
    }
    const now = Date.now();
    const existing = this.documents.get(id);
    if (existing && existing.ownerId !== ownerId && !isExpired(existing.expiresAt, now)) {
      return false;
    }
    const nowIso = new Date(now).toISOString();
    this.documents.set(
      id,
      structuredClone(
        prepareDocument(
          id,
          {
            id,
            ownerId,
            expiresAt: new Date(now + ttlMs),
            createdAt: existing?.createdAt || nowIso
          },
          nowIso
        )
      )
    );
    return true;
  }

  async renew(id: string, ownerId: string, ttlMs: number): Promise<boolean> {
    if (!isValidLockTtl(ttlMs)) {
      return false;
    }
    const now = Date.now();
    const existing = this.documents.get(id);
    if (!existing || existing.ownerId !== ownerId || isExpired(existing.expiresAt, now)) {
      return false;
    }
    const nowIso = new Date(now).toISOString();
    this.documents.set(
      id,
      structuredClone(prepareDocument(id, { ...existing, expiresAt: new Date(now + ttlMs), updatedAt: nowIso }, nowIso))
    );
    return true;
  }

  async release(id: string, ownerId: string): Promise<void> {
    const existing = this.documents.get(id);
    if (!existing || existing.ownerId === ownerId || isExpired(existing.expiresAt)) {
      this.documents.delete(id);
    }
  }
}

function matchesFilter(value: Record<string, any>, filter: QueryFilter): boolean {
  const candidate = value[filter.field];
  switch (filter.op) {
    case "==":
      return candidate === filter.value;
    case "!=":
      return candidate !== filter.value;
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(candidate);
    default:
      throw new Error(`Unsupported in-memory query operator: ${String(filter.op)}`);
  }
}

function isValidLockTtl(ttlMs: number): boolean {
  return Number.isSafeInteger(ttlMs) && ttlMs > 0;
}
