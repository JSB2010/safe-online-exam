import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config/app-config.js";
import {
  createActionToken,
  createAdminActionToken,
  createSebConfigGrantActionToken,
  expectedSessionBinding,
  verifyActionToken,
  verifyAdminActionToken,
  verifySebConfigGrantActionToken
} from "../../src/server/http/action-token.js";
import {
  requireAdminManagementRequestIntegrity,
  requireManagementRequestIntegrity,
  requireSebConfigGrantRequestIntegrity
} from "../../src/server/http/request-integrity.js";
import type { VerifiedLtiPrincipal } from "../../src/server/security/verified-lti-principal.js";

describe("action tokens", () => {
  const config = {
    value: { security: { sessionSecret: "test-session-secret" } },
    getRequiredToolUrl: () => "https://tool.example.test"
  } as AppConfig;
  const principal: VerifiedLtiPrincipal = {
    version: 1,
    issuer: "https://canvas.example.test",
    deploymentId: "deployment-1",
    subject: "opaque-lti-subject",
    canvasUserId: "canvas-user-1",
    courseId: "course-7",
    roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
    custom: {},
    authenticatedAt: "2026-01-01T00:00:00.000Z"
  };

  it("signs the verified launch identity and current session into the dashboard action context", () => {
    const token = createActionToken(config, "canvas-user-1", "course-7", {
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    expect(verifyActionToken(config, token)).toMatchObject({
      version: 2,
      purpose: "assessment-management",
      userId: "canvas-user-1",
      courseId: "course-7",
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionBinding: expectedSessionBinding(config, "session-1")
    });
    expect(verifyActionToken(config, `${token}tampered`)).toBeNull();
  });

  it("does not let a token minted for one session satisfy another session binding", () => {
    const token = createActionToken(config, "canvas-user-1", "course-7", {
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });
    const payload = verifyActionToken(config, token);

    expect(payload?.sessionBinding).toBe(expectedSessionBinding(config, "session-1"));
    expect(payload?.sessionBinding).not.toBe(expectedSessionBinding(config, "attacker-session"));
    expect(token).not.toContain("session-1");

    expect(() => requireManagementRequestIntegrity(requestDouble("session-1", token), config, principal)).not.toThrow();
    expect(() =>
      requireManagementRequestIntegrity(requestDouble("attacker-session", token), config, principal)
    ).toThrow("Invalid or missing management request token");
  });

  it("uses a distinct root-account and session-bound token for administrator mutations", () => {
    const adminPrincipal = {
      ...principal,
      contextType: "account" as const,
      courseId: "" as const,
      accountId: "root-7",
      rootAccountId: "root-7",
      isRootAccountAdmin: true as const
    };
    const token = createAdminActionToken(config, "canvas-user-1", "root-7", {
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    expect(verifyAdminActionToken(config, token)).toMatchObject({
      purpose: "account-admin-management",
      userId: "canvas-user-1",
      rootAccountId: "root-7",
      sessionBinding: expectedSessionBinding(config, "session-1")
    });
    expect(verifyActionToken(config, token)).toBeNull();
    expect(() =>
      requireAdminManagementRequestIntegrity(requestDouble("session-1", token), config, adminPrincipal)
    ).not.toThrow();
    expect(() =>
      requireAdminManagementRequestIntegrity(requestDouble("other-session", token), config, adminPrincipal)
    ).toThrow("Invalid or missing administrator request token");
  });

  it("rejects legacy or incomplete signed payload shapes", () => {
    const valid = createActionToken(config, "canvas-user-1", "course-7", {
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });
    const legacyPayload = Buffer.from(
      JSON.stringify({ userId: "canvas-user-1", courseId: "course-7", exp: Date.now() + 60_000 }),
      "utf8"
    ).toString("base64url");
    const legacySignature = createHmac("sha256", "test-session-secret").update(legacyPayload).digest("base64url");

    expect(valid).toBeTruthy();
    expect(verifyActionToken(config, `${legacyPayload}.${legacySignature}`)).toBeNull();
  });

  it("rejects appended segments and non-canonical base64url encodings", () => {
    const actionToken = createActionToken(config, "canvas-user-1", "course-7", {
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });
    const grantToken = createSebConfigGrantActionToken(config, "canvas-user-1", "course-7", {
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    expect(verifyActionToken(config, `${actionToken}.ignored`)).toBeNull();
    expect(verifyActionToken(config, actionToken.replace(".", "=."))).toBeNull();
    expect(verifySebConfigGrantActionToken(config, `${grantToken}.ignored`)).toBeNull();
    expect(verifySebConfigGrantActionToken(config, grantToken.replace(".", "=."))).toBeNull();
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = createActionToken(config, "canvas-user-1", "course-7", {
        subject: "opaque-lti-subject",
        deploymentId: "deployment-1",
        sessionId: "session-1"
      });

      vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
      expect(verifyActionToken(config, token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a dedicated session-bound token for click-time SEB configuration grants", () => {
    const token = createSebConfigGrantActionToken(config, "canvas-user-1", "course-7", {
      subject: "opaque-lti-subject",
      deploymentId: "deployment-1",
      sessionId: "session-1"
    });

    expect(verifySebConfigGrantActionToken(config, token)).toMatchObject({
      version: 1,
      purpose: "seb-config-grant",
      courseId: "course-7",
      subject: "opaque-lti-subject",
      sessionBinding: expectedSessionBinding(config, "session-1")
    });
    expect(verifyActionToken(config, token)).toBeNull();
    expect(() =>
      requireSebConfigGrantRequestIntegrity(requestDouble("session-1", token), config, principal)
    ).not.toThrow();
    expect(() =>
      requireSebConfigGrantRequestIntegrity(requestDouble("different-session", token), config, principal)
    ).toThrow("Invalid or missing SEB launch request token");
  });
});

function requestDouble(sessionID: string, token: string): any {
  return {
    sessionID,
    header(name: string) {
      return {
        "x-auth-token": token,
        origin: "https://tool.example.test",
        "sec-fetch-site": "same-origin"
      }[name.toLowerCase()];
    }
  };
}
