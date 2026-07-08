import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { RepositoryProvider } from "../data/repositories.js";

@Injectable()
export class SebAccessProofService {
  private readonly ttlSeconds = 120;

  constructor(private readonly repositories: RepositoryProvider) {}

  async mintProof(courseId: string, contentId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.repositories.value.transientStates.save(proofDocumentId(token), {
      kind: "seb-proof",
      courseId,
      contentId,
      expiresAt: new Date(Date.now() + this.ttlSeconds * 1000)
    });
    return token;
  }

  async consumeProof(token: string | undefined | null, courseId: string, contentId: string): Promise<boolean> {
    if (!token) {
      return false;
    }
    const record = await this.repositories.value.transientStates.consume(proofDocumentId(token));
    if (!record) {
      return false;
    }
    return (
      !!record.courseId &&
      !!record.contentId &&
      safeEqual(record.courseId, courseId) &&
      safeEqual(record.contentId, contentId)
    );
  }

  getTokenTtlSeconds(): number {
    return this.ttlSeconds;
  }
}

export function proofDocumentId(token: string): string {
  return createHash("sha256").update(`seb-proof:${token}`, "utf8").digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
