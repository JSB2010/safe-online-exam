import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import { classicQuizContentId, extractClassicQuizId, parseNewQuizContentId } from "../../shared/models.js";
import { RepositoryProvider, type TransientStateRecord } from "../data/repositories.js";
import { DistributedAdmissionService } from "../security/distributed-admission.js";
import type { VerifiedLtiPrincipal } from "../security/verified-lti-principal.js";
import { sebConfigFingerprint } from "./seb-setting-fingerprint.js";

const GRANT_TTL_SECONDS = 120;
const PRINCIPAL_GRANT_LIMIT_PER_MINUTE = 60;
const IP_GRANT_LIMIT_PER_MINUTE = 1_200;

export interface ConsumedSebConfigGrant {
  issuer: string;
  subject: string;
  deploymentId: string;
  courseId: string;
  contentId: string;
  settingsFingerprint: string;
}

export class SebConfigGrantRateLimitError extends Error {
  constructor() {
    super("Too many SEB configuration grant requests");
    this.name = "SebConfigGrantRateLimitError";
  }
}

@Injectable()
export class SebConfigGrantService {
  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly admission: DistributedAdmissionService
  ) {}

  async mintGrant(
    request: Request,
    principal: VerifiedLtiPrincipal,
    courseId: string,
    contentId: string,
    settingsFingerprint: string
  ): Promise<string> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (
      !canonicalContentId ||
      principal.courseId !== courseId ||
      !principal.issuer ||
      !principal.deploymentId ||
      !principal.subject ||
      !settingsFingerprint
    ) {
      throw new Error("Verified LTI principal does not match this SEB configuration");
    }
    const principalIdentity = `${principal.issuer}\0${principal.deploymentId}\0${principal.subject}`;
    const [principalAllowed, ipAllowed] = await Promise.all([
      this.admission.consume("seb-config-grant-principal", principalIdentity, PRINCIPAL_GRANT_LIMIT_PER_MINUTE),
      this.admission.consumeRequestIp(request, "seb-config-grant-ip", IP_GRANT_LIMIT_PER_MINUTE)
    ]);
    if (!principalAllowed || !ipAllowed) {
      throw new SebConfigGrantRateLimitError();
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      const claimed = await this.repositories.value.transientStates.claim(grantDocumentId(token), {
        kind: "seb-config-grant",
        version: 1,
        audience: "seb-config-download",
        action: "download",
        issuer: principal.issuer,
        deploymentId: principal.deploymentId,
        subject: principal.subject,
        courseId,
        contentId: canonicalContentId,
        settingsFingerprint,
        expiresAt: new Date(Date.now() + GRANT_TTL_SECONDS * 1000)
      });
      if (claimed) {
        return token;
      }
    }
    throw new Error("Unable to mint a unique SEB configuration grant");
  }

  async consumeGrant(
    token: string | undefined | null,
    courseId: string,
    contentId: string
  ): Promise<ConsumedSebConfigGrant | null> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId || !token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return null;
    }
    const record = await this.repositories.value.transientStates.consume(grantDocumentId(token));
    if (!isConfigGrantRecord(record)) {
      return null;
    }
    if (!safeEqual(record.courseId, courseId) || !safeEqual(record.contentId, canonicalContentId)) {
      return null;
    }
    return {
      issuer: record.issuer,
      subject: record.subject,
      deploymentId: record.deploymentId,
      courseId: record.courseId,
      contentId: record.contentId,
      settingsFingerprint: record.settingsFingerprint
    };
  }

  getTokenTtlSeconds(): number {
    return GRANT_TTL_SECONDS;
  }
}

export function canonicalSebConfigContentId(contentId: string | undefined | null): string | null {
  const parsed = parseNewQuizContentId(contentId);
  if (parsed) {
    return contentId!;
  }
  const classicId = extractClassicQuizId(contentId);
  return classicId && /^[0-9]{1,20}$/u.test(classicId) ? classicQuizContentId(classicId) : null;
}

export function sebConfigSettingsFingerprint(
  courseId: string,
  contentId: string,
  setting: QuizSebSetting | ContentSebSetting
): string {
  const canonicalContentId = canonicalSebConfigContentId(contentId);
  if (!canonicalContentId) {
    throw new Error("Invalid SEB configuration content ID");
  }
  return createHash("sha256")
    .update(`seb-config-settings-v1\0${courseId}\0${canonicalContentId}\0${sebConfigFingerprint(setting)}`, "utf8")
    .digest("base64url");
}

export function sameSebConfigSettingsFingerprint(left: string, right: string): boolean {
  return safeEqual(left, right);
}

function grantDocumentId(token: string): string {
  return createHash("sha256").update(`seb-config-grant:${token}`, "utf8").digest("hex");
}

function isConfigGrantRecord(record: TransientStateRecord | null): record is TransientStateRecord & {
  issuer: string;
  deploymentId: string;
  subject: string;
  courseId: string;
  contentId: string;
  settingsFingerprint: string;
} {
  return (
    record?.kind === "seb-config-grant" &&
    record.version === 1 &&
    record.audience === "seb-config-download" &&
    record.action === "download" &&
    typeof record.issuer === "string" &&
    !!record.issuer &&
    typeof record.deploymentId === "string" &&
    !!record.deploymentId &&
    typeof record.subject === "string" &&
    !!record.subject &&
    typeof record.courseId === "string" &&
    !!record.courseId &&
    typeof record.contentId === "string" &&
    !!record.contentId &&
    typeof record.settingsFingerprint === "string" &&
    !!record.settingsFingerprint
  );
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
