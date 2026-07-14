import { Firestore, type Query } from "@google-cloud/firestore";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { AssessmentRecord, CourseRecord, OAuthToken } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";

export interface QueryFilter {
  field: string;
  op: FirebaseFirestore.WhereFilterOp;
  value: unknown;
}

export interface CollectionStore<T extends Record<string, any>> {
  get(id: string): Promise<T | null>;
  save(id: string, value: T): Promise<T>;
  update(id: string, updater: (current: T | null) => T | null): Promise<T | null>;
  delete(id: string): Promise<void>;
  find(filters?: QueryFilter[]): Promise<T[]>;
  saveMany(values: Array<{ id: string; value: T }>): Promise<T[]>;
}

export interface SessionRecord extends Record<string, any> {
  id?: string | null;
  data: Record<string, unknown>;
  expiresAt: Date | string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TransientStateRecord extends Record<string, any> {
  id?: string | null;
  kind:
    | "lti-state"
    | "seb-proof"
    | "seb-proof-v2"
    | "seb-exit-grant"
    | "seb-config-grant"
    | "seb-session-handoff-config"
    | "admission-budget";
  payload?: Record<string, string>;
  courseId?: string | null;
  contentId?: string | null;
  expiresAt: Date | string;
  consumedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface OperationLockRecord extends Record<string, any> {
  id?: string | null;
  ownerId: string;
  expiresAt: Date | string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TransientStateStore extends CollectionStore<TransientStateRecord> {
  consume(id: string): Promise<TransientStateRecord | null>;
  claim(id: string, value: TransientStateRecord): Promise<boolean>;
  consumeBudget(id: string, limit: number, windowMs: number): Promise<boolean>;
}

export interface OperationLockStore extends CollectionStore<OperationLockRecord> {
  acquire(id: string, ownerId: string, ttlMs: number): Promise<boolean>;
  renew(id: string, ownerId: string, ttlMs: number): Promise<boolean>;
  release(id: string, ownerId: string): Promise<void>;
}

export interface AppRepositories {
  assessments: CollectionStore<AssessmentRecord>;
  courses: CollectionStore<CourseRecord>;
  oauthTokens: CollectionStore<OAuthToken>;
  sessions: CollectionStore<SessionRecord>;
  transientStates: TransientStateStore;
  operationLocks: OperationLockStore;
}

@Injectable()
export class RepositoryProvider implements OnModuleInit {
  private repositories?: AppRepositories;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    this.repositories = createRepositories(this.config);
  }

  get value(): AppRepositories {
    if (!this.repositories) {
      this.repositories = createRepositories(this.config);
    }
    return this.repositories;
  }
}

export function createRepositories(config: AppConfig): AppRepositories {
  if (process.env.USE_IN_MEMORY_STORE === "true" || config.profile === "test") {
    if (process.env.K_SERVICE) {
      throw new Error("USE_IN_MEMORY_STORE is local/test only and cannot be enabled on Cloud Run");
    }
    return createInMemoryRepositories();
  }

  const firestore = new Firestore({
    projectId: config.value.projectId,
    databaseId: config.value.firestoreDatabaseId
  });
  const collections = config.value.firestoreCollections;

  return {
    assessments: new FirestoreCollectionStore<AssessmentRecord>(firestore, collections.assessments),
    courses: new FirestoreCollectionStore<CourseRecord>(firestore, collections.courses),
    oauthTokens: new FirestoreCollectionStore<OAuthToken>(firestore, collections.oauthTokens),
    sessions: new FirestoreCollectionStore<SessionRecord>(firestore, collections.sessions),
    transientStates: new FirestoreTransientStateStore(firestore, collections.transientStates),
    operationLocks: new FirestoreOperationLockStore(firestore, collections.operationLocks)
  };
}

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
    const now = new Date().toISOString();
    const next = prepareDocument(id, value, now);
    this.documents.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async update(id: string, updater: (current: T | null) => T | null): Promise<T | null> {
    const current = await this.get(id);
    const updated = updater(current);
    if (!updated) {
      return null;
    }
    return this.save(id, updated);
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

export class FirestoreCollectionStore<T extends Record<string, any>> implements CollectionStore<T> {
  constructor(
    protected readonly firestore: Firestore,
    protected readonly collectionName: string
  ) {}

  async get(id: string): Promise<T | null> {
    const snapshot = await this.firestore.collection(this.collectionName).doc(id).get();
    if (!snapshot.exists) {
      return null;
    }
    return withDocumentId(snapshot.id, snapshot.data() as T);
  }

  async save(id: string, value: T): Promise<T> {
    const now = new Date().toISOString();
    const next = prepareDocument(id, value, now);
    await this.firestore.collection(this.collectionName).doc(id).set(next, { merge: true });
    return next;
  }

  async update(id: string, updater: (current: T | null) => T | null): Promise<T | null> {
    const now = new Date().toISOString();
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection(this.collectionName).doc(id);
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists ? withDocumentId(snapshot.id, snapshot.data() as T) : null;
      const updated = updater(current);
      if (!updated) {
        return null;
      }
      const next = prepareDocument(id, updated, now);
      transaction.set(reference, next, { merge: true });
      return next;
    });
  }

  async delete(id: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(id).delete();
  }

  async find(filters: QueryFilter[] = []): Promise<T[]> {
    let query: Query = this.firestore.collection(this.collectionName);
    for (const filter of filters) {
      query = query.where(filter.field, filter.op, filter.value);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => withDocumentId(doc.id, doc.data() as T));
  }

  async saveMany(values: Array<{ id: string; value: T }>): Promise<T[]> {
    const saved: T[] = [];
    const batch = this.firestore.batch();
    const now = new Date().toISOString();
    for (const entry of values) {
      const next = prepareDocument(entry.id, entry.value, now);
      batch.set(this.firestore.collection(this.collectionName).doc(entry.id), next, { merge: true });
      saved.push(next);
    }
    await batch.commit();
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

export class FirestoreTransientStateStore
  extends FirestoreCollectionStore<TransientStateRecord>
  implements TransientStateStore
{
  async consumeBudget(id: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection(this.collectionName).doc(id);
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists ? (snapshot.data() as TransientStateRecord) : null;
      const existingCount =
        existing?.kind === "admission-budget" && !isExpired(existing.expiresAt, now) ? Number(existing.count) || 0 : 0;
      if (existingCount >= limit) {
        return false;
      }
      transaction.set(
        reference,
        prepareDocument(
          id,
          {
            ...(existingCount ? existing : {}),
            kind: "admission-budget",
            count: existingCount + 1,
            expiresAt: existingCount ? existing!.expiresAt : new Date(now + windowMs)
          } as TransientStateRecord,
          nowIso
        )
      );
      return true;
    });
  }

  async claim(id: string, value: TransientStateRecord): Promise<boolean> {
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection(this.collectionName).doc(id);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists && !isExpired((snapshot.data() as TransientStateRecord).expiresAt)) {
        return false;
      }
      const now = new Date().toISOString();
      transaction.set(reference, prepareDocument(id, value, now));
      return true;
    });
  }

  async consume(id: string): Promise<TransientStateRecord | null> {
    const consumedAt = new Date().toISOString();
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection(this.collectionName).doc(id);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        return null;
      }
      const record = withDocumentId(snapshot.id, snapshot.data() as TransientStateRecord);
      if (record.consumedAt || isExpired(record.expiresAt)) {
        transaction.delete(reference);
        return null;
      }
      transaction.update(reference, { consumedAt, updatedAt: consumedAt });
      return { ...record, consumedAt, updatedAt: consumedAt };
    });
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

export class FirestoreOperationLockStore
  extends FirestoreCollectionStore<OperationLockRecord>
  implements OperationLockStore
{
  async acquire(id: string, ownerId: string, ttlMs: number): Promise<boolean> {
    if (!isValidLockTtl(ttlMs)) {
      return false;
    }
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection(this.collectionName).doc(id);
      const snapshot = await transaction.get(reference);
      const now = Date.now();
      const expiresAt = new Date(now + ttlMs);
      const nowIso = new Date(now).toISOString();
      if (snapshot.exists) {
        const existing = withDocumentId(snapshot.id, snapshot.data() as OperationLockRecord);
        if (existing.ownerId !== ownerId && !isExpired(existing.expiresAt, now)) {
          return false;
        }
      }
      transaction.set(
        reference,
        stripUndefinedValues({
          id,
          ownerId,
          expiresAt,
          createdAt: snapshot.exists ? (snapshot.data() as OperationLockRecord).createdAt || nowIso : nowIso,
          updatedAt: nowIso
        }),
        { merge: true }
      );
      return true;
    });
  }

  async renew(id: string, ownerId: string, ttlMs: number): Promise<boolean> {
    if (!isValidLockTtl(ttlMs)) {
      return false;
    }
    return this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection(this.collectionName).doc(id);
      const snapshot = await transaction.get(reference);
      const now = Date.now();
      if (!snapshot.exists) {
        return false;
      }
      const existing = withDocumentId(snapshot.id, snapshot.data() as OperationLockRecord);
      if (existing.ownerId !== ownerId || isExpired(existing.expiresAt, now)) {
        return false;
      }
      const nowIso = new Date(now).toISOString();
      transaction.update(reference, { expiresAt: new Date(now + ttlMs), updatedAt: nowIso });
      return true;
    });
  }

  async release(id: string, ownerId: string): Promise<void> {
    await this.firestore.runTransaction(async (transaction) => {
      const reference = this.firestore.collection(this.collectionName).doc(id);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        return;
      }
      const existing = withDocumentId(snapshot.id, snapshot.data() as OperationLockRecord);
      if (existing.ownerId === ownerId || isExpired(existing.expiresAt)) {
        transaction.delete(reference);
      }
    });
  }
}

function isValidLockTtl(ttlMs: number): boolean {
  return Number.isSafeInteger(ttlMs) && ttlMs > 0;
}

function prepareDocument<T extends Record<string, any>>(id: string, value: T, now: string): T {
  return stripUndefinedValues({
    ...value,
    id: (value.id as string | undefined) || id,
    updatedAt: now,
    createdAt: value.createdAt || now
  } as T);
}

export function stripUndefinedValues<T>(value: T): T {
  if (value === undefined) {
    return undefined as T;
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined).map((entry) => stripUndefinedValues(entry)) as T;
  }
  if (isPlainRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        next[key] = stripUndefinedValues(entry);
      }
    }
    return next as T;
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function withDocumentId<T extends Record<string, any>>(id: string, value: T): T {
  return {
    ...cloneDocumentValue(value),
    id: typeof value.id === "string" && value.id.trim() ? value.id : id
  };
}

function cloneDocumentValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDocumentValue(entry)) as T;
  }
  if (value && typeof value === "object") {
    if (typeof (value as { toDate?: unknown }).toDate === "function") {
      return value;
    }
    if (!isPlainRecord(value)) {
      return value;
    }
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = cloneDocumentValue(entry);
    }
    return next as T;
  }
  return value;
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
      throw new Error(`Unsupported in-memory query operator: ${filter.op}`);
  }
}

export function isExpired(expiresAt: unknown, now = Date.now()): boolean {
  const expiresAtMs = toMillis(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now;
}

function toMillis(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string" || typeof value === "number") {
    return Date.parse(String(value));
  }
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (value && typeof value === "object") {
    const timestamp = value as { seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown };
    const seconds = typeof timestamp.seconds === "number" ? timestamp.seconds : timestamp._seconds;
    const nanos = typeof timestamp.nanoseconds === "number" ? timestamp.nanoseconds : timestamp._nanoseconds;
    if (typeof seconds === "number") {
      return seconds * 1000 + (typeof nanos === "number" ? Math.floor(nanos / 1_000_000) : 0);
    }
  }
  return Number.NaN;
}
