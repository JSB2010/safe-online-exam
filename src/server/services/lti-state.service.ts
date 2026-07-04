import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app-config.js";

interface IssuedState {
  payload: Record<string, string>;
  expiresAt: number;
}

@Injectable()
export class LtiStateService {
  private readonly issued = new Map<string, IssuedState>();
  private readonly ttlMs = 600_000;

  constructor(private readonly config: AppConfig) {}

  createState(payload: Record<string, string>): string {
    const expiresAt = Date.now() + this.ttlMs;
    const encoded = encryptJson({ payload, expiresAt }, this.getKey());
    this.issued.set(encoded, { payload, expiresAt });
    this.cleanup();
    return encoded;
  }

  consumeState(state: string | undefined | null): Record<string, string> {
    if (!state) {
      throw new Error("Missing LTI state");
    }
    const issued = this.issued.get(state);
    if (!issued) {
      throw new Error("Invalid or already consumed LTI state");
    }
    this.issued.delete(state);
    const decrypted = decryptJson(state, this.getKey()) as { payload: Record<string, string>; expiresAt: number };
    const payload = issued.payload;
    const expiresAt = issued.expiresAt || decrypted.expiresAt;
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

  private cleanup(): void {
    const now = Date.now();
    for (const [state, issued] of this.issued.entries()) {
      if (issued.expiresAt < now) {
        this.issued.delete(state);
      }
    }
  }
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
  const leftBuffer = Buffer.from(JSON.stringify(left));
  const rightBuffer = Buffer.from(JSON.stringify(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
