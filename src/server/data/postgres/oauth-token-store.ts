import type { OAuthToken } from "../../../shared/models.js";
import type { PostgresDatabase } from "../postgres-client.js";
import type { CollectionStore, QueryFilter, QueryOptions } from "../repository-contracts.js";
import {
  OAuthTokenCipher,
  type OAuthTokenEncryptionSettings,
  type PersistedOAuthToken
} from "../../security/oauth-token-encryption.js";
import { DocumentMapping, PostgresCollectionStore } from "./collection-store.js";

const OAUTH_MAPPING: DocumentMapping<PersistedOAuthToken> = {
  table: "canvas_oauth_tokens",
  extracted: [{ field: "userId", column: "user_id" }]
};

export class PostgresOAuthTokenStore implements CollectionStore<OAuthToken> {
  private readonly rawStore: PostgresCollectionStore<PersistedOAuthToken>;
  private readonly cipher: OAuthTokenCipher;

  constructor(
    private readonly database: PostgresDatabase,
    settings: OAuthTokenEncryptionSettings
  ) {
    this.rawStore = new PostgresCollectionStore(database, OAUTH_MAPPING);
    this.cipher = new OAuthTokenCipher(settings);
  }

  async get(id: string): Promise<OAuthToken | null> {
    const persisted = await this.rawStore.get(id);
    return persisted ? this.cipher.decode(id, persisted as Record<string, unknown>) : null;
  }

  async save(id: string, value: OAuthToken): Promise<OAuthToken> {
    const persisted = await this.rawStore.save(id, this.cipher.encode(id, value) as PersistedOAuthToken);
    return this.cipher.decode(id, persisted as Record<string, unknown>);
  }

  async update(id: string, updater: (current: OAuthToken | null) => OAuthToken | null): Promise<OAuthToken | null> {
    const persisted = await this.rawStore.update(id, (current) => {
      const updated = updater(current ? this.cipher.decode(id, current as Record<string, unknown>) : null);
      return updated ? (this.cipher.encode(id, updated) as PersistedOAuthToken) : null;
    });
    return persisted ? this.cipher.decode(id, persisted as Record<string, unknown>) : null;
  }

  delete(id: string): Promise<void> {
    return this.rawStore.delete(id);
  }

  async find(filters: QueryFilter[] = [], options: QueryOptions = {}): Promise<OAuthToken[]> {
    const persisted = await this.rawStore.find(filters, options);
    return persisted.map((document) => this.cipher.decode(String(document.id), document as Record<string, unknown>));
  }

  async saveMany(values: Array<{ id: string; value: OAuthToken }>): Promise<OAuthToken[]> {
    const persisted = await this.rawStore.saveMany(
      values.map(({ id, value }) => ({ id, value: this.cipher.encode(id, value) as PersistedOAuthToken }))
    );
    return persisted.map((document) => this.cipher.decode(String(document.id), document as Record<string, unknown>));
  }

  async rewriteLegacyAndRotatedTokens(batchSize = 100): Promise<{ scanned: number; rewritten: number }> {
    if (!this.cipher.writesEncrypted) {
      throw new Error("OAuth token rewrite requires OAUTH_TOKEN_ENCRYPTION_MODE=enforce");
    }
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
      throw new Error("OAuth token rewrite batch size must be between 1 and 1000");
    }

    let cursor = "";
    let scanned = 0;
    let rewritten = 0;
    while (true) {
      const result = await this.database.query<{ id: string; document: Record<string, unknown> }>(
        "SELECT id, document FROM canvas_oauth_tokens WHERE id > $1 ORDER BY id LIMIT $2",
        [cursor, batchSize]
      );
      if (!result.rows.length) break;
      for (const row of result.rows) {
        scanned += 1;
        cursor = row.id;
        if (!this.cipher.needsRewrite(row.document)) continue;
        let didRewrite = false;
        await this.rawStore.update(row.id, (current) => {
          if (!current || !this.cipher.needsRewrite(current as Record<string, unknown>)) return current;
          didRewrite = true;
          const token = this.cipher.decode(row.id, current as Record<string, unknown>);
          return this.cipher.encode(row.id, token) as PersistedOAuthToken;
        });
        if (didRewrite) rewritten += 1;
      }
    }
    return { scanned, rewritten };
  }
}

export function localTestOAuthTokenEncryptionSettings(): OAuthTokenEncryptionSettings {
  return {
    mode: "enforce",
    activeKeyId: "postgres-test-v1",
    keyring: JSON.stringify({ "postgres-test-v1": Buffer.alloc(32, 19).toString("base64url") })
  };
}
