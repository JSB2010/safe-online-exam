import { createHash, randomBytes } from "node:crypto";
import { constantTimeStringEqual as safeEqual } from "../security/constant-time.js";
import { Injectable } from "@nestjs/common";
import { isExpired } from "../data/document-values.js";
import { RepositoryProvider } from "../data/repositories.js";
import { isCurrentLaunchAdmission, type SebLaunchAdmission } from "./seb-config-grant.service.js";

export interface ConsumedSebAccessProof {
  generationDigest: string;
  attemptId: string | null;
  launchAdmission: SebLaunchAdmission | null;
}

@Injectable()
export class SebAccessProofService {
  private readonly ttlSeconds = 120;
  private readonly exitGrantTtlSeconds = 12 * 60 * 60;

  constructor(private readonly repositories: RepositoryProvider) {}

  async mintProof(
    courseId: string,
    contentId: string,
    generationDigest: string,
    settingsFingerprint: string,
    launchAdmission?: SebLaunchAdmission | null
  ): Promise<string> {
    if (launchAdmission && !isCurrentLaunchAdmission(launchAdmission)) {
      throw new Error("Canvas learner availability admission has expired");
    }
    const token = randomBytes(32).toString("base64url");
    const proofExpiresAt = Date.now() + this.ttlSeconds * 1000;
    const expiresAt = launchAdmission
      ? Math.min(proofExpiresAt, Date.parse(launchAdmission.expiresAt))
      : proofExpiresAt;
    await this.repositories.value.transientStates.save(proofDocumentId(token), {
      kind: "seb-proof-v2",
      version: 2,
      audience: "seb-access-code",
      action: "release",
      courseId,
      contentId,
      generationDigest,
      settingsFingerprint,
      launchAdmissionRequired: !!launchAdmission,
      ...(launchAdmission ? { launchAdmission } : {}),
      expiresAt: new Date(expiresAt)
    });
    return token;
  }

  async revokeProof(token: string): Promise<void> {
    if (/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      await this.repositories.value.transientStates.delete(proofDocumentId(token));
    }
  }

  async consumeProof(
    token: string | undefined | null,
    courseId: string,
    contentId: string,
    settingsFingerprint: string
  ): Promise<string | null> {
    return (await this.consumeProofContext(token, courseId, contentId, settingsFingerprint))?.generationDigest || null;
  }

  async consumeProofContext(
    token: string | undefined | null,
    courseId: string,
    contentId: string,
    settingsFingerprint: string
  ): Promise<ConsumedSebAccessProof | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return null;
    }
    const record = await this.repositories.value.transientStates.consume(proofDocumentId(token));
    if (!record) {
      return null;
    }
    const launchAdmission = isCurrentLaunchAdmission(record.launchAdmission) ? record.launchAdmission : null;
    const valid =
      record.kind === "seb-proof-v2" &&
      record.version === 2 &&
      record.audience === "seb-access-code" &&
      record.action === "release" &&
      !!record.courseId &&
      !!record.contentId &&
      !!record.generationDigest &&
      !!record.settingsFingerprint &&
      safeEqual(record.courseId, courseId) &&
      safeEqual(record.contentId, contentId) &&
      safeEqual(record.settingsFingerprint, settingsFingerprint) &&
      (record.launchAdmissionRequired !== true || launchAdmission !== null);
    return valid
      ? {
          generationDigest: record.generationDigest,
          attemptId: launchAdmission?.attemptId || (typeof record.attemptId === "string" ? record.attemptId : null),
          launchAdmission
        }
      : null;
  }

  getTokenTtlSeconds(launchAdmission?: SebLaunchAdmission | null): number {
    if (!launchAdmission) return this.ttlSeconds;
    return Math.max(
      0,
      Math.min(this.ttlSeconds, Math.ceil((Date.parse(launchAdmission.expiresAt) - Date.now()) / 1000))
    );
  }

  async mintExitGrant(courseId: string, contentId: string, generationDigest: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.repositories.value.transientStates.save(exitGrantDocumentId(token), {
      kind: "seb-exit-grant",
      version: 1,
      audience: "seb-exit",
      action: "show-quit-link",
      courseId,
      contentId,
      generationDigest,
      expiresAt: new Date(Date.now() + this.exitGrantTtlSeconds * 1000)
    });
    return token;
  }

  async revokeExitGrant(token: string): Promise<void> {
    if (/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      await this.repositories.value.transientStates.delete(exitGrantDocumentId(token));
    }
  }

  async validateExitGrant(
    token: string | undefined | null,
    courseId: string,
    contentId: string,
    generationDigest: string
  ): Promise<boolean> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return false;
    }
    const record = await this.repositories.value.transientStates.get(exitGrantDocumentId(token));
    if (!record || isExpired(record.expiresAt)) {
      return false;
    }
    return (
      record.kind === "seb-exit-grant" &&
      record.version === 1 &&
      record.audience === "seb-exit" &&
      record.action === "show-quit-link" &&
      !!record.courseId &&
      !!record.contentId &&
      !!record.generationDigest &&
      safeEqual(record.courseId, courseId) &&
      safeEqual(record.contentId, contentId) &&
      safeEqual(record.generationDigest, generationDigest)
    );
  }

  async getExitGrant(token: string | undefined | null, courseId: string, contentId: string): Promise<string | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return null;
    }
    const record = await this.repositories.value.transientStates.get(exitGrantDocumentId(token));
    if (!record || isExpired(record.expiresAt)) {
      return null;
    }
    return record.kind === "seb-exit-grant" &&
      record.version === 1 &&
      record.audience === "seb-exit" &&
      record.action === "show-quit-link" &&
      typeof record.courseId === "string" &&
      typeof record.contentId === "string" &&
      typeof record.generationDigest === "string" &&
      safeEqual(record.courseId, courseId) &&
      safeEqual(record.contentId, contentId)
      ? record.generationDigest
      : null;
  }

  getExitGrantTtlSeconds(): number {
    return this.exitGrantTtlSeconds;
  }
}

export function proofDocumentId(token: string): string {
  return createHash("sha256").update(`seb-proof:${token}`, "utf8").digest("hex");
}

export function exitGrantDocumentId(token: string): string {
  return createHash("sha256").update(`seb-exit-grant:${token}`, "utf8").digest("hex");
}
