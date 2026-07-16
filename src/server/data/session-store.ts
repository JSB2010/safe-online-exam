import { createHash } from "node:crypto";
import session from "express-session";
import { isExpired } from "./document-values.js";
import type { CollectionStore, SessionRecord } from "./repository-contracts.js";

export class RepositorySessionStore extends session.Store {
  constructor(
    private readonly sessions: CollectionStore<SessionRecord>,
    private readonly ttlMs: number
  ) {
    super();
  }

  override get(sid: string, callback: (err?: unknown, session?: session.SessionData | null) => void): void {
    this.sessions
      .get(sessionDocumentId(sid))
      .then(async (record) => {
        if (!record || isExpired(record.expiresAt)) {
          if (record) {
            await this.sessions.delete(sessionDocumentId(sid));
          }
          callback(null, null);
          return;
        }
        callback(null, record.data as unknown as session.SessionData);
      })
      .catch((error: unknown) => callback(error));
  }

  override set(sid: string, value: session.SessionData, callback?: (err?: unknown) => void): void {
    const expiresAt = sessionExpiresAt(value, this.ttlMs);
    this.sessions
      .save(sessionDocumentId(sid), {
        data: serializeSession(value),
        expiresAt
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  override touch(sid: string, value: session.SessionData, callback?: (err?: unknown) => void): void {
    this.set(sid, value, callback);
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.sessions
      .delete(sessionDocumentId(sid))
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }
}

export function sessionDocumentId(sid: string): string {
  return createHash("sha256").update(sid, "utf8").digest("hex");
}

function sessionExpiresAt(value: session.SessionData, ttlMs: number): Date {
  const expires = value.cookie?.expires;
  if (expires instanceof Date && Number.isFinite(expires.getTime())) {
    return expires;
  }
  if (typeof expires === "string") {
    const parsed = Date.parse(expires);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }
  return new Date(Date.now() + ttlMs);
}

function serializeSession(value: session.SessionData): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
