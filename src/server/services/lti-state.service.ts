import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";

@Injectable()
export class LtiStateService {
  private readonly ttlMs = 600_000;

  constructor(
    private readonly config: AppConfig,
    private readonly repositories: RepositoryProvider
  ) {}

  async createState(payload: Record<string, string>): Promise<string> {
    const expiresAt = Date.now() + this.ttlMs;
    return encryptJson({ payload, expiresAt }, this.getKey());
  }

  peekState(state: string | undefined | null): Record<string, string> {
    if (!state) {
      throw new Error("Missing LTI state");
    }
    const decrypted = decryptJson(state, this.getKey()) as { payload: Record<string, string>; expiresAt: number };
    if (!decrypted.expiresAt || decrypted.expiresAt < Date.now()) {
      throw new Error("Expired LTI state");
    }
    if (!decrypted.payload || typeof decrypted.payload !== "object" || Array.isArray(decrypted.payload)) {
      throw new Error("Invalid LTI state");
    }
    return decrypted.payload;
  }

  async claimState(state: string | undefined | null): Promise<void> {
    if (!state) {
      throw new Error("Missing LTI state");
    }
    const payload = this.peekState(state);
    const claimed = await this.repositories.value.transientStates.claim(stateDocumentId(state), {
      kind: "lti-state",
      payload,
      expiresAt: new Date(Date.now() + this.ttlMs),
      consumedAt: new Date().toISOString()
    });
    if (!claimed) {
      throw new Error("Invalid or already consumed LTI state");
    }
  }

  async consumeState(state: string | undefined | null): Promise<Record<string, string>> {
    const payload = this.peekState(state);
    await this.claimState(state);
    return payload;
  }

  private getKey(): Buffer {
    const configuredKey = this.config.value.security.stateEncryptionKey;
    if (!configuredKey && this.config.profile === "prod") {
      throw new Error("STATE_ENCRYPTION_KEY is required in prod");
    }
    return createHash("sha256")
      .update(configuredKey || "seb-canvas-dev-state-key")
      .digest();
  }
}

export function stateDocumentId(state: string): string {
  return createHash("sha256").update(`lti-state:${state}`, "utf8").digest("hex");
}

function encryptJson(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function decryptJson(state: string, key: Buffer): unknown {
  const buffer = Buffer.from(state, "base64url");
  if (buffer.length < 29) {
    throw new Error("Invalid LTI state");
  }
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as unknown;
}
