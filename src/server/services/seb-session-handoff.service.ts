import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { isExpired } from "../data/document-values.js";
import { RepositoryProvider } from "../data/repositories.js";
import type { TransientStateRecord } from "../data/repository-contracts.js";
import { SebConfigKeyService } from "./seb-config-key.service.js";

const HANDOFF_CONFIG_TTL_SECONDS = 12 * 60 * 60;

@Injectable()
export class SebSessionHandoffService {
  constructor(
    private readonly repositories: RepositoryProvider,
    private readonly configKey: SebConfigKeyService
  ) {}

  async registerConfig(
    courseId: string,
    contentId: string,
    settingsFingerprint: string,
    configKey: string,
    returnTo: string
  ): Promise<void> {
    const urls = configProofUrls(returnTo);
    const proofUrl = canonicalProofUrl(returnTo);
    if (
      !courseId ||
      !contentId ||
      !settingsFingerprint ||
      !/^[a-f0-9]{64}$/u.test(configKey) ||
      !urls.length ||
      !proofUrl
    ) {
      throw new Error("Invalid SEB session handoff configuration");
    }
    const expiresAt = new Date(Date.now() + HANDOFF_CONFIG_TTL_SECONDS * 1000);
    await Promise.all(
      urls.map(async (url) => {
        const configKeyHash = this.configKey.hashForUrl(url, configKey);
        const claimed = await this.repositories.value.transientStates.claim(documentId(configKeyHash), {
          kind: "seb-session-handoff-config",
          version: 1,
          audience: "seb-access-proof",
          action: "validate",
          courseId,
          contentId,
          settingsFingerprint,
          configKey,
          proofUrl,
          expiresAt
        });
        if (!claimed) {
          throw new Error("Unable to register SEB session handoff configuration");
        }
      })
    );
  }

  async revokeConfigs(courseId: string, contentId: string, settingsFingerprint: string): Promise<void> {
    const candidates = await this.repositories.value.transientStates.find([
      { field: "courseId", op: "==", value: courseId },
      { field: "contentId", op: "==", value: contentId }
    ]);
    await Promise.all(
      candidates
        .filter(
          (record) =>
            typeof record.id === "string" &&
            record.kind === "seb-session-handoff-config" &&
            record.settingsFingerprint === settingsFingerprint
        )
        .map((record) => this.repositories.value.transientStates.delete(String(record.id)))
    );
  }

  async resolveConfigKey(
    courseId: string,
    contentId: string,
    settingsFingerprint: string,
    configKeyHash: string | undefined | null,
    url: string | undefined | null
  ): Promise<string | null> {
    if (!configKeyHash || !url || !/^[a-f0-9]{64}$/u.test(configKeyHash)) {
      return null;
    }
    const directRecord = await this.repositories.value.transientStates.get(documentId(configKeyHash));
    const directConfigKey = resolveMatchingConfigKey(
      this.configKey,
      directRecord,
      courseId,
      contentId,
      settingsFingerprint,
      configKeyHash,
      url,
      false
    );
    if (directConfigKey) {
      return directConfigKey;
    }

    // New Quiz routes include a Canvas-generated attempt ID, so the Config Key
    // hash cannot be indexed until the browser reaches that route. Look up only
    // handoff configs for this content and still validate the supplied hash
    // against both the exact browser URL and the stored Config Key.
    const candidates = await this.repositories.value.transientStates.find([
      { field: "contentId", op: "==", value: contentId }
    ]);
    for (const record of candidates) {
      const configKey = resolveMatchingConfigKey(
        this.configKey,
        record,
        courseId,
        contentId,
        settingsFingerprint,
        configKeyHash,
        url,
        true
      );
      if (configKey) {
        return configKey;
      }
    }
    return null;
  }
}

function configProofUrls(returnTo: string): string[] {
  try {
    const url = new URL(returnTo);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return [];
    }
    const queryless = new URL(url.toString());
    queryless.search = "";
    return Array.from(new Set([url.toString(), queryless.toString()]));
  } catch {
    return [];
  }
}

function canonicalProofUrl(returnTo: string): string | null {
  try {
    const url = new URL(returnTo);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return null;
    }
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function resolveMatchingConfigKey(
  configKeyService: SebConfigKeyService,
  record: TransientStateRecord | null,
  courseId: string,
  contentId: string,
  settingsFingerprint: string,
  configKeyHash: string,
  url: string,
  requireCompatibleProofUrl: boolean
): string | null {
  if (
    !isSessionHandoffRecord(record) ||
    isExpired(record.expiresAt) ||
    record.courseId !== courseId ||
    record.contentId !== contentId ||
    record.settingsFingerprint !== settingsFingerprint ||
    (requireCompatibleProofUrl && !isCompatibleProofUrl(record.proofUrl, url)) ||
    !configKeyService.validateConfigKeyHashForUrl(configKeyHash, url, record.configKey)
  ) {
    return null;
  }
  return record.configKey;
}

function isCompatibleProofUrl(proofUrl: string | undefined, actualUrl: string): boolean {
  // Handoff records issued before this field was introduced expire within 12
  // hours. The controller has already bound those legacy records to Canvas's
  // exact course and assignment path before reaching this service.
  if (!proofUrl) {
    return true;
  }
  try {
    const expected = new URL(proofUrl);
    const actual = new URL(actualUrl);
    const expectedPath = expected.pathname.replace(/\/+$/u, "");
    const actualPath = actual.pathname.replace(/\/+$/u, "");
    return (
      expected.protocol === actual.protocol &&
      expected.host.toLowerCase() === actual.host.toLowerCase() &&
      (actualPath === expectedPath || actualPath.startsWith(`${expectedPath}/`))
    );
  } catch {
    return false;
  }
}

function documentId(configKeyHash: string): string {
  return createHash("sha256").update(`seb-session-handoff-config:${configKeyHash}`, "utf8").digest("hex");
}

function isSessionHandoffRecord(record: TransientStateRecord | null): record is TransientStateRecord & {
  courseId: string;
  contentId: string;
  settingsFingerprint: string;
  configKey: string;
  proofUrl?: string;
} {
  return (
    record?.kind === "seb-session-handoff-config" &&
    record.version === 1 &&
    record.audience === "seb-access-proof" &&
    record.action === "validate" &&
    typeof record.courseId === "string" &&
    typeof record.contentId === "string" &&
    typeof record.settingsFingerprint === "string" &&
    typeof record.configKey === "string" &&
    (record.proofUrl === undefined || typeof record.proofUrl === "string") &&
    /^[a-f0-9]{64}$/u.test(record.configKey)
  );
}
