import { Firestore, type Query } from "@google-cloud/firestore";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type {
  CourseSebDefaults,
  ContentItem,
  ContentSebSetting,
  ModuleItemUpdate,
  OAuthToken,
  Quiz,
  QuizSebSetting
} from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";

export interface QueryFilter {
  field: string;
  op: FirebaseFirestore.WhereFilterOp;
  value: unknown;
}

export interface CollectionStore<T extends Record<string, any>> {
  get(id: string): Promise<T | null>;
  save(id: string, value: T): Promise<T>;
  delete(id: string): Promise<void>;
  find(filters?: QueryFilter[]): Promise<T[]>;
  saveMany(values: Array<{ id: string; value: T }>): Promise<T[]>;
}

export interface AppRepositories {
  quizzes: CollectionStore<Quiz>;
  quizSebSettings: CollectionStore<QuizSebSetting>;
  contentItems: CollectionStore<ContentItem>;
  contentSebSettings: CollectionStore<ContentSebSetting>;
  courseSebDefaults: CollectionStore<CourseSebDefaults>;
  oauthTokens: CollectionStore<OAuthToken>;
  moduleItemUpdates: CollectionStore<ModuleItemUpdate>;
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
    return createInMemoryRepositories();
  }

  const firestore = new Firestore({
    projectId: config.value.projectId,
    databaseId: config.value.firestoreDatabaseId
  });
  const collections = config.value.firestoreCollections;

  return {
    quizzes: new FirestoreCollectionStore<Quiz>(firestore, collections.quizzes),
    quizSebSettings: new FirestoreCollectionStore<QuizSebSetting>(firestore, collections.sebSettings),
    contentItems: new FirestoreCollectionStore<ContentItem>(firestore, collections.contentItems),
    contentSebSettings: new FirestoreCollectionStore<ContentSebSetting>(firestore, collections.contentSebSettings),
    courseSebDefaults: new FirestoreCollectionStore<CourseSebDefaults>(firestore, collections.courseSebDefaults),
    oauthTokens: new FirestoreCollectionStore<OAuthToken>(firestore, collections.oauthTokens),
    moduleItemUpdates: new FirestoreCollectionStore<ModuleItemUpdate>(firestore, collections.moduleItemUpdates)
  };
}

export function createInMemoryRepositories(
  seed?: Partial<Record<keyof AppRepositories, Record<string, any>>>
): AppRepositories {
  return {
    quizzes: new InMemoryCollectionStore<Quiz>(seed?.quizzes),
    quizSebSettings: new InMemoryCollectionStore<QuizSebSetting>(seed?.quizSebSettings),
    contentItems: new InMemoryCollectionStore<ContentItem>(seed?.contentItems),
    contentSebSettings: new InMemoryCollectionStore<ContentSebSetting>(seed?.contentSebSettings),
    courseSebDefaults: new InMemoryCollectionStore<CourseSebDefaults>(seed?.courseSebDefaults),
    oauthTokens: new InMemoryCollectionStore<OAuthToken>(seed?.oauthTokens),
    moduleItemUpdates: new InMemoryCollectionStore<ModuleItemUpdate>(seed?.moduleItemUpdates)
  };
}

export class InMemoryCollectionStore<T extends Record<string, any>> implements CollectionStore<T> {
  private readonly documents = new Map<string, T>();

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
    private readonly firestore: Firestore,
    private readonly collectionName: string
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
    ...structuredClone(value),
    id: typeof value.id === "string" && value.id.trim() ? value.id : id
  };
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
