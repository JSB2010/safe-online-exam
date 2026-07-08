import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
    const encoded = encryptJson({ payload, expiresAt }, this.getKey());
    await this.repositories.value.transientStates.save(stateDocumentId(encoded), {
      kind: "lti-state",
      payload,
      expiresAt: new Date(expiresAt)
    });
    return encoded;
  }

  async consumeState(state: string | undefined | null): Promise<Record<string, string>> {
    if (!state) {
      throw new Error("Missing LTI state");
    }
    const issued = await this.repositories.value.transientStates.consume(stateDocumentId(state));
    if (!issued) {
      throw new Error("Invalid or already consumed LTI state");
    }
    const decrypted = decryptJson(state, this.getKey()) as { payload: Record<string, string>; expiresAt: number };
    const payload = issued.payload || {};
    const expiresAt = Date.parse(String(issued.expiresAt)) || decrypted.expiresAt;
    if (!expiresAt || expiresAt < Date.now()) {
      throw new Error("Expired LTI state");
    }
    if (!constantJsonEqual(payload, decrypted.payload)) {
      throw new Error("Invalid LTI state");
    }
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

function constantJsonEqual(left: unknown, right: unknown): boolean {
  const leftBuffer = Buffer.from(stableJson(left));
  const rightBuffer = Buffer.from(stableJson(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
