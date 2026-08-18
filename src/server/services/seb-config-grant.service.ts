import { createHash, createHmac, randomBytes } from "node:crypto";
import { constantTimeStringEqual as safeEqual } from "../security/constant-time.js";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { ContentSebSetting, QuizSebSetting } from "../../shared/models.js";
import { classicQuizContentId, extractClassicQuizId, parseNewQuizContentId } from "../../shared/models.js";
import { RepositoryProvider } from "../data/repositories.js";
import type { TransientStateRecord } from "../data/repository-contracts.js";
import { DistributedAdmissionService } from "../security/distributed-admission.js";
import {
  isVerifiedInstructor,
  isVerifiedStudent,
  type VerifiedLtiPrincipal
} from "../security/verified-lti-principal.js";
import { sebConfigFingerprint } from "./seb-setting-fingerprint.js";

const GRANT_TTL_SECONDS = 120;
const BROWSER_LAUNCH_HANDOFF_TTL_SECONDS = 120;
const PRINCIPAL_GRANT_LIMIT_PER_MINUTE = 60;
const IP_GRANT_LIMIT_PER_MINUTE = 1_200;

export type SebBrowserLaunchPurpose = "assessment" | "setup-check" | "student-list";

export interface SebBrowserLaunchHandoff extends Record<string, unknown> {
  sebLaunchUrl: string;
  browserReturnUrl: string;
  launchPurpose: SebBrowserLaunchPurpose;
}

export interface ConsumedSebConfigGrant {
  issuer: string;
  subject: string;
  deploymentId: string;
  canvasUserId: string;
  courseId: string;
  contentId: string;
  settingsFingerprint: string;
  requiresSessionHandoff: boolean;
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
        canvasUserId: principal.canvasUserId,
        courseId,
        contentId: canonicalContentId,
        settingsFingerprint,
        requiresSessionHandoff: isVerifiedStudent(principal) && !isVerifiedInstructor(principal),
        expiresAt: new Date(Date.now() + GRANT_TTL_SECONDS * 1000)
      });
      if (claimed) {
        return token;
      }
    }
    throw new Error("Unable to mint a unique SEB configuration grant");
  }

  async revokeGrant(token: string): Promise<void> {
    if (/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      await this.repositories.value.transientStates.delete(grantDocumentId(token));
    }
  }

  async mintBrowserLaunchHandoff(handoff: SebBrowserLaunchHandoff): Promise<string> {
    if (!isValidBrowserLaunchHandoff(handoff)) {
      throw new Error("Invalid SEB browser launch handoff");
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      const claimed = await this.repositories.value.transientStates.claim(browserLaunchHandoffDocumentId(token), {
        kind: "seb-browser-launch-handoff",
        version: 1,
        audience: "seb-browser-launch",
        action: "open",
        ...handoff,
        expiresAt: new Date(Date.now() + BROWSER_LAUNCH_HANDOFF_TTL_SECONDS * 1000)
      });
      if (claimed) {
        return token;
      }
    }
    throw new Error("Unable to mint a unique SEB browser launch handoff");
  }

  async consumeBrowserLaunchHandoff(token: string | undefined | null): Promise<SebBrowserLaunchHandoff | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return null;
    }
    const record = await this.repositories.value.transientStates.consume(browserLaunchHandoffDocumentId(token));
    if (!isBrowserLaunchHandoffRecord(record)) {
      return null;
    }
    return {
      sebLaunchUrl: record.sebLaunchUrl,
      browserReturnUrl: record.browserReturnUrl,
      launchPurpose: record.launchPurpose
    };
  }

  async getBrowserLaunchHandoffReturnUrl(token: string | undefined | null): Promise<string | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return null;
    }
    const record = await this.repositories.value.transientStates.get(browserLaunchHandoffDocumentId(token));
    return isBrowserLaunchHandoffRecord(record) ? record.browserReturnUrl : null;
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
      canvasUserId: record.canvasUserId,
      courseId: record.courseId,
      contentId: record.contentId,
      settingsFingerprint: record.settingsFingerprint,
      requiresSessionHandoff: record.requiresSessionHandoff
    };
  }

  /**
   * Validates a configuration-download grant without consuming it.
   *
   * SEB for Windows probes a remote configuration with HEAD before issuing the
   * GET which actually downloads it. Treating that probe as a download forces
   * clients that fall back to a GET probe to burn the one-time grant before
   * they receive the configuration bytes.
   */
  async validateGrant(token: string | undefined | null, courseId: string, contentId: string): Promise<boolean> {
    const canonicalContentId = canonicalSebConfigContentId(contentId);
    if (!canonicalContentId || !token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      return false;
    }
    const record = await this.repositories.value.transientStates.get(grantDocumentId(token));
    return (
      isConfigGrantRecord(record) &&
      !record.consumedAt &&
      !isExpired(record.expiresAt) &&
      safeEqual(record.courseId, courseId) &&
      safeEqual(record.contentId, canonicalContentId)
    );
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
  setting: QuizSebSetting | ContentSebSetting,
  secret: string
): string {
  const canonicalContentId = canonicalSebConfigContentId(contentId);
  if (!canonicalContentId) {
    throw new Error("Invalid SEB configuration content ID");
  }
  if (!secret) {
    throw new Error("SEB configuration fingerprint secret is required");
  }
  return createHmac("sha256", secret)
    .update(`seb-config-settings-v1\0${courseId}\0${canonicalContentId}\0${sebConfigFingerprint(setting)}`, "utf8")
    .digest("base64url");
}

export function sameSebConfigSettingsFingerprint(left: string, right: string): boolean {
  return safeEqual(left, right);
}

function grantDocumentId(token: string): string {
  return createHash("sha256").update(`seb-config-grant:${token}`, "utf8").digest("hex");
}

function browserLaunchHandoffDocumentId(token: string): string {
  return createHash("sha256").update(`seb-browser-launch-handoff:${token}`, "utf8").digest("hex");
}

function isExpired(expiresAt: Date | string): boolean {
  const timestamp = new Date(expiresAt).getTime();
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function isConfigGrantRecord(record: TransientStateRecord | null): record is TransientStateRecord & {
  issuer: string;
  deploymentId: string;
  subject: string;
  canvasUserId: string;
  courseId: string;
  contentId: string;
  settingsFingerprint: string;
  requiresSessionHandoff: boolean;
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
    typeof record.canvasUserId === "string" &&
    /^[0-9]+$/u.test(record.canvasUserId) &&
    typeof record.courseId === "string" &&
    !!record.courseId &&
    typeof record.contentId === "string" &&
    !!record.contentId &&
    typeof record.settingsFingerprint === "string" &&
    !!record.settingsFingerprint &&
    typeof record.requiresSessionHandoff === "boolean"
  );
}

function isBrowserLaunchHandoffRecord(record: TransientStateRecord | null): record is TransientStateRecord & {
  sebLaunchUrl: string;
  browserReturnUrl: string;
  launchPurpose: SebBrowserLaunchPurpose;
} {
  return (
    record?.kind === "seb-browser-launch-handoff" &&
    record.version === 1 &&
    record.audience === "seb-browser-launch" &&
    record.action === "open" &&
    isValidBrowserLaunchHandoff(record)
  );
}

function isValidBrowserLaunchHandoff(value: Record<string, unknown>): value is SebBrowserLaunchHandoff {
  return (
    isSafeSebLaunchUrl(value.sebLaunchUrl) &&
    isSafeBrowserReturnUrl(value.browserReturnUrl) &&
    (value.launchPurpose === "assessment" ||
      value.launchPurpose === "setup-check" ||
      value.launchPurpose === "student-list")
  );
}

function isSafeSebLaunchUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "seb:" || url.protocol === "sebs:") && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function isSafeBrowserReturnUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}
