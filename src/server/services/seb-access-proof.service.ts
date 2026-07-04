import { randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

interface ProofRecord {
  token: string;
  courseId: string;
  contentId: string;
  expiresAt: number;
}

@Injectable()
export class SebAccessProofService {
  private readonly proofs = new Map<string, ProofRecord>();
  private readonly ttlSeconds = 120;

  mintProof(courseId: string, contentId: string): string {
    this.cleanup();
    const token = randomBytes(32).toString("base64url");
    this.proofs.set(token, {
      token,
      courseId,
      contentId,
      expiresAt: Date.now() + this.ttlSeconds * 1000
    });
    return token;
  }

  consumeProof(token: string | undefined | null, courseId: string, contentId: string): boolean {
    this.cleanup();
    if (!token) {
      return false;
    }
    const record = this.proofs.get(token);
    this.proofs.delete(token);
    if (!record || record.expiresAt < Date.now()) {
      return false;
    }
    return safeEqual(record.courseId, courseId) && safeEqual(record.contentId, contentId);
  }

  getTokenTtlSeconds(): number {
    return this.ttlSeconds;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [token, record] of this.proofs.entries()) {
      if (record.expiresAt < now) {
        this.proofs.delete(token);
      }
    }
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
