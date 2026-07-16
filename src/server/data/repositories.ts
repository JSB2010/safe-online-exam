import { Injectable, OnModuleInit } from "@nestjs/common";
import { AppConfig } from "../config/app-config.js";
import { createInMemoryRepositories } from "./in-memory-repositories.js";
import { PostgresDatabase } from "./postgres-client.js";
import { createPostgresRepositories } from "./postgres-repositories.js";
import type { AppRepositories } from "./repository-contracts.js";
import { assertSchemaReady } from "./schema.js";

@Injectable()
export class RepositoryProvider implements OnModuleInit {
  private repositories?: AppRepositories;

  constructor(
    private readonly config: AppConfig,
    private readonly database: PostgresDatabase
  ) {}

  onModuleInit(): void {
    this.repositories = createRepositories(this.config, this.database);
  }

  get value(): AppRepositories {
    if (!this.repositories) {
      this.repositories = createRepositories(this.config, this.database);
    }
    return this.repositories;
  }

  async assertReady(): Promise<void> {
    void this.value;
    if (usesInMemoryRepositories(this.config)) {
      return;
    }
    await this.database.checkConnection();
    await assertSchemaReady(this.database);
  }
}

export function createRepositories(config: AppConfig, database: PostgresDatabase): AppRepositories {
  if (usesInMemoryRepositories(config)) {
    if (config.isHardenedRuntime()) {
      throw new Error("USE_IN_MEMORY_STORE is local/test only and cannot be enabled in a hardened runtime");
    }
    return createInMemoryRepositories();
  }
  return createPostgresRepositories(database);
}

export function usesInMemoryRepositories(config: Pick<AppConfig, "profile">): boolean {
  return config.profile === "test" || process.env.USE_IN_MEMORY_STORE === "true";
}

export { createInMemoryRepositories } from "./in-memory-repositories.js";
export { isExpired, stripUndefinedValues } from "./document-values.js";
export type {
  AppRepositories,
  CollectionStore,
  OperationLockRecord,
  OperationLockStore,
  QueryFilter,
  QueryOperator,
  SessionRecord,
  TransientStateRecord,
  TransientStateStore
} from "./repository-contracts.js";
