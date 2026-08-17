import { describe, expect, it } from "vitest";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { DistributedAdmissionService } from "../../src/server/security/distributed-admission.js";
import type { VerifiedLtiPrincipal } from "../../src/server/security/verified-lti-principal.js";
import {
  SebConfigGrantRateLimitError,
  SebConfigGrantService,
  sebConfigSettingsFingerprint
} from "../../src/server/services/seb-config-grant.service.js";

const FINGERPRINT_SECRET = "test-seb-config-fingerprint-secret";

describe("SebConfigGrantService", () => {
  it("mints one-time grants bound to the verified principal and canonical target", async () => {
    const service = grantService();
    const fingerprint = sebConfigSettingsFingerprint("course-1", "101", classicSetting(), FINGERPRINT_SECRET);
    const token = await service.mintGrant(requestDouble(), principal(), "course-1", "101", fingerprint);

    await expect(service.consumeGrant(token, "course-1", "classicquiz_101")).resolves.toMatchObject({
      issuer: "https://canvas.example.edu",
      deploymentId: "deployment-1",
      subject: "opaque-student-1",
      canvasUserId: "12345",
      courseId: "course-1",
      contentId: "classicquiz_101",
      settingsFingerprint: fingerprint,
      requiresSessionHandoff: true
    });
    await expect(service.consumeGrant(token, "course-1", "classicquiz_101")).resolves.toBeNull();
  });

  it("atomically burns a grant presented for a different course or content target", async () => {
    const service = grantService();
    const token = await service.mintGrant(
      requestDouble(),
      principal(),
      "course-1",
      "101",
      sebConfigSettingsFingerprint("course-1", "101", classicSetting(), FINGERPRINT_SECRET)
    );

    await expect(service.consumeGrant(token, "course-1", "classicquiz_102")).resolves.toBeNull();
    await expect(service.consumeGrant(token, "course-1", "classicquiz_101")).resolves.toBeNull();
  });

  it("revokes an issued grant when the course state changes before release", async () => {
    const service = grantService();
    const token = await service.mintGrant(
      requestDouble(),
      principal(),
      "course-1",
      "101",
      sebConfigSettingsFingerprint("course-1", "101", classicSetting(), FINGERPRINT_SECRET)
    );

    await service.revokeGrant(token);

    await expect(service.consumeGrant(token, "course-1", "classicquiz_101")).resolves.toBeNull();
  });

  it("validates a Windows HEAD probe without consuming the one-time grant", async () => {
    const service = grantService();
    const token = await service.mintGrant(
      requestDouble(),
      principal(),
      "course-1",
      "101",
      sebConfigSettingsFingerprint("course-1", "101", classicSetting(), FINGERPRINT_SECRET)
    );

    await expect(service.validateGrant(token, "course-1", "classicquiz_101")).resolves.toBe(true);
    await expect(service.consumeGrant(token, "course-1", "classicquiz_101")).resolves.toMatchObject({
      contentId: "classicquiz_101"
    });
    await expect(service.validateGrant(token, "course-1", "classicquiz_101")).resolves.toBe(false);
  });

  it("rejects minting for a course outside the validated LTI principal", async () => {
    const service = grantService();

    await expect(service.mintGrant(requestDouble(), principal(), "course-2", "101", "fingerprint")).rejects.toThrow(
      /principal does not match/u
    );
  });

  it("keys settings fingerprints with a server secret", () => {
    const setting = classicSetting();
    const fingerprint = sebConfigSettingsFingerprint("course-1", "101", setting, FINGERPRINT_SECRET);

    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(sebConfigSettingsFingerprint("course-1", "101", setting, FINGERPRINT_SECRET)).toBe(fingerprint);
    expect(sebConfigSettingsFingerprint("course-1", "101", setting, `${FINGERPRINT_SECRET}-rotated`)).not.toBe(
      fingerprint
    );
    expect(() => sebConfigSettingsFingerprint("course-1", "101", setting, "")).toThrow(/secret is required/u);
  });

  it.each([
    "quiz-1",
    "classicquiz_quiz-1",
    "classicquiz_12%2F34",
    "classicquiz_１２３",
    `classicquiz_${"1".repeat(21)}`,
    "classicquiz_12_extra"
  ])("rejects malformed public Classic Quiz identifier %s", async (contentId) => {
    await expect(
      grantService().mintGrant(requestDouble(), principal(), "course-1", contentId, "fingerprint")
    ).rejects.toThrow(/does not match/u);
  });

  it("uses a target-independent distributed principal budget", async () => {
    const service = grantService();
    for (let index = 0; index < 60; index += 1) {
      await expect(
        service.mintGrant(requestDouble(), principal(), "course-1", String(10_000 + index), `fingerprint-${index}`)
      ).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }

    await expect(
      service.mintGrant(requestDouble(), principal(), "course-1", "99999", "fingerprint-final")
    ).rejects.toBeInstanceOf(SebConfigGrantRateLimitError);
  });
});

function grantService(): SebConfigGrantService {
  const provider = { value: createInMemoryRepositories() } as RepositoryProvider;
  return new SebConfigGrantService(provider, new DistributedAdmissionService(provider));
}

function principal(): VerifiedLtiPrincipal {
  return {
    version: 1,
    issuer: "https://canvas.example.edu",
    deploymentId: "deployment-1",
    subject: "opaque-student-1",
    canvasUserId: "12345",
    courseId: "course-1",
    roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
    custom: {},
    authenticatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function requestDouble(): any {
  return { ip: "192.0.2.10", socket: { remoteAddress: "192.0.2.10" } };
}

function classicSetting(): any {
  return {
    quizId: "101",
    courseId: "course-1",
    sebRequired: true,
    enabled: true,
    accessCode: "ACCESS",
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    urlRules: [],
    externalTools: []
  };
}
