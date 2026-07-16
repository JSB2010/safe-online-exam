import type { AssessmentRecord, CourseRecord, OAuthToken } from "../../shared/models.js";
import { isExpired, prepareDocument, withDocumentId } from "./document-values.js";
import type {
  AppRepositories,
  CollectionStore,
  OperationLockRecord,
  OperationLockStore,
  QueryFilter,
  SessionRecord,
  TransientStateRecord,
  TransientStateStore
} from "./repository-contracts.js";

export function createInMemoryRepositories(
  seed?: Partial<Record<keyof AppRepositories, Record<string, any>>>
): AppRepositories {
  return {
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

  async find(filters: QueryFilter[] = []): Promise<T[]> {
    return Array.from(this.documents.entries())
      .filter(([, value]) => filters.every((filter) => matchesFilter(value, filter)))
      .map(([id, value]) => withDocumentId(id, value));
  }

  async saveMany(values: Array<{ id: string; value: T }>): Promise<T[]> {
    const saved: T[] = [];
    for (const entry of values) {
      saved.push(await this.save(entry.id, entry.value));
    }
    return saved;
  }
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
      if (existing) {
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
