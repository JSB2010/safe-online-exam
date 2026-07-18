// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import type { AppConfig } from "../../src/server/config/app-config.js";
import { isAllowedDeploymentId, launchDataFromPayload, LtiService } from "../../src/server/services/lti.service.js";

const ISSUER = "https://canvas.instructure.com";
const CLIENT_ID = "client-1";
const DEPLOYMENT_ID = "deployment-1";
const NONCE = "nonce-1";
const TARGET_LINK_URI = "https://tool.example.com/lti/launch";
const INSTRUCTOR_ROLE = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
const LEARNER_ROLE = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

describe("launchDataFromPayload", () => {
  it("extracts Canvas custom course ids, roles, and resource links", () => {
    expect(
      launchDataFromPayload({
        sub: "user-1",
        name: "Instructor One",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "deployment-1",
        "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://tool.example.com/lti/launch",
        "https://purl.imsglobal.org/spec/lti/claim/roles": [
          "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"
        ],
        "https://purl.imsglobal.org/spec/lti/claim/custom": { canvas_course_id: "11825" },
        "https://purl.imsglobal.org/spec/lti/claim/resource_link": { id: "resource-1", title: "Quiz" },
        "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
          lineitems: "https://canvas.example.com/api/lti/courses/11825/line_items"
        }
      })
    ).toMatchObject({
      ltiSubject: "user-1",
      userId: "user-1",
      courseId: "11825",
      resourceLinkId: "resource-1",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]
    });
  });

  it("uses the numeric AGS course id instead of Canvas's opaque LTI context id", () => {
    expect(
      launchDataFromPayload({
        sub: "user-1",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "deployment-1",
        "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://tool.example.com/lti/launch",
        "https://purl.imsglobal.org/spec/lti/claim/context": {
          id: "fde3df11ccce4acf053a8da564e180fd7a70377f",
          title: "Test Course"
        },
        "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
          lineitems: "https://canvas.example.com/api/lti/courses/11825/line_items"
        }
      })
    ).toMatchObject({
      courseId: "11825"
    });
  });

  it("accepts a launch only when every present numeric course source agrees", () => {
    expect(
      launchDataFromPayload({
        sub: "user-1",
        "https://purl.imsglobal.org/spec/lti/claim/custom": { canvas_course_id: "11825" },
        "https://purl.imsglobal.org/spec/lti/claim/context": { id: "11825" },
        "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
          lineitems: "https://canvas.example.com/api/lti/courses/11825/line_items",
          lineitem: "https://canvas.example.com/api/lti/courses/11825/line_items/91"
        }
      })
    ).toMatchObject({ courseId: "11825" });
  });

  it.each([
    {
      name: "custom and AGS",
      custom: { canvas_course_id: "11825" },
      context: { id: "opaque-context" },
      ags: { lineitems: "https://canvas.example.com/api/lti/courses/99999/line_items" }
    },
    {
      name: "context and AGS",
      custom: {},
      context: { id: "11825" },
      ags: { lineitems: "https://canvas.example.com/api/lti/courses/99999/line_items" }
    },
    {
      name: "AGS lineitems and lineitem",
      custom: {},
      context: { id: "opaque-context" },
      ags: {
        lineitems: "https://canvas.example.com/api/lti/courses/11825/line_items",
        lineitem: "https://canvas.example.com/api/lti/courses/99999/line_items/91"
      }
    }
  ])("rejects conflicting signed course ids from $name", ({ custom, context, ags }) => {
    expect(() =>
      launchDataFromPayload({
        sub: "user-1",
        "https://purl.imsglobal.org/spec/lti/claim/custom": custom,
        "https://purl.imsglobal.org/spec/lti/claim/context": context,
        "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": ags
      })
    ).toThrow("Conflicting signed LTI course claims");
  });

  it("uses the signed Canvas REST user id while retaining the opaque LTI subject", () => {
    expect(
      launchDataFromPayload({
        sub: "opaque-subject",
        iss: "https://canvas.instructure.com",
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "deployment-1",
        "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://tool.example.com/lti/launch",
        "https://purl.imsglobal.org/spec/lti/claim/custom": {
          canvas_course_id: "11825",
          canvas_user_id: "42"
        }
      })
    ).toMatchObject({
      ltiSubject: "opaque-subject",
      canvasUserId: "42",
      userId: "42",
      issuer: "https://canvas.instructure.com"
    });
  });

  it("rejects payloads that omit the signed LTI subject", () => {
    expect(() =>
      launchDataFromPayload({
        "https://purl.imsglobal.org/spec/lti/claim/custom": {
          canvas_course_id: "11825",
          canvas_user_id: "42"
        }
      })
    ).toThrow("LTI token is missing subject");
  });

  it("does not treat course enrollment substitutions as authorization claims on the account admin surface", () => {
    expect(
      launchDataFromPayload({
        sub: "admin-subject",
        "https://purl.imsglobal.org/spec/lti/claim/roles": [
          "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator"
        ],
        "https://purl.imsglobal.org/spec/lti/claim/custom": {
          seb_launch_surface: "account_admin",
          canvas_user_id: "42",
          canvas_account_id: "7",
          canvas_root_account_id: "7",
          canvas_user_is_root_account_admin: "true",
          canvas_membership_roles: "TeacherEnrollment,StudentEnrollment",
          canvas_lis_membership_roles: LEARNER_ROLE
        }
      })
    ).toMatchObject({
      ltiSubject: "admin-subject",
      canvasUserId: "42",
      courseId: undefined,
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator"],
      custom: {
        seb_launch_surface: "account_admin",
        canvas_account_id: "7",
        canvas_root_account_id: "7",
        canvas_user_is_root_account_admin: "true"
      }
    });
  });

  it("fails closed unless the exact Canvas deployment id is configured", () => {
    expect(isAllowedDeploymentId(undefined, "deployment-1")).toBe(false);
    expect(isAllowedDeploymentId("", "deployment-1")).toBe(false);
    expect(isAllowedDeploymentId("deployment-1", "deployment-1")).toBe(true);
    expect(isAllowedDeploymentId("deployment-1,deployment-2", "deployment-2")).toBe(true);
    expect(isAllowedDeploymentId("deployment-1\ndeployment-2", "deployment-3")).toBe(false);
    expect(isAllowedDeploymentId("deployment-1", undefined)).toBe(false);
    expect(isAllowedDeploymentId("deployment-1", " deployment-1 ")).toBe(false);
  });
});

describe("LtiService.validateToken", () => {
  let privateKey: CryptoKey;
  let localJwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const keyPair = await generateKeyPair("RS256", { extractable: true });
    privateKey = keyPair.privateKey;
    localJwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(keyPair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" }]
    });
  });

  it("accepts a fresh RS256 launch whose signed identity sources agree", async () => {
    const service = makeLtiService(localJwks);
    const token = await signLaunch(privateKey, launchPayload());

    await expect(service.validateToken(token, NONCE)).resolves.toMatchObject({
      ltiSubject: "opaque-subject",
      canvasUserId: "42",
      courseId: "11825",
      roles: [INSTRUCTOR_ROLE]
    });
  });

  it("accepts an otherwise valid signed deployment outside the allowlist when deployment checking is disabled", async () => {
    const service = makeLtiService(localJwks, false);
    const token = await signLaunch(
      privateKey,
      launchPayload({
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "course-installed-deployment"
      })
    );

    await expect(service.validateToken(token, NONCE)).resolves.toMatchObject({
      deploymentId: "course-installed-deployment"
    });
  });

  it("still requires Canvas to sign a deployment ID when deployment checking is disabled", async () => {
    const service = makeLtiService(localJwks, false);
    const payload = launchPayload();
    delete payload["https://purl.imsglobal.org/spec/lti/claim/deployment_id"];
    const token = await signLaunch(privateKey, payload);

    await expect(service.validateToken(token, NONCE)).rejects.toThrow("Missing LTI deployment id");
  });

  it("rejects RS384 even when the token has otherwise valid claims and a known key id", async () => {
    const keyPair = await generateKeyPair("RS384");
    const token = await new SignJWT(launchPayload())
      .setProtectedHeader({ alg: "RS384", kid: "test-key" })
      .sign(keyPair.privateKey);

    await expect(makeLtiService(localJwks).validateToken(token, NONCE)).rejects.toThrow(
      "Unsupported LTI signing algorithm"
    );
  });

  it("rejects a learner token whose custom claims request teacher privileges", async () => {
    const token = await signLaunch(
      privateKey,
      launchPayload({
        "https://purl.imsglobal.org/spec/lti/claim/roles": [LEARNER_ROLE],
        "https://purl.imsglobal.org/spec/lti/claim/custom": {
          canvas_course_id: "11825",
          canvas_user_id: "42",
          canvas_membership_roles: "TeacherEnrollment",
          canvas_membership_permissions: "manage_assignments_edit manage_course_content_edit"
        }
      })
    );

    await expect(makeLtiService(localJwks).validateToken(token, NONCE)).rejects.toThrow("Conflicting LTI role claims");
  });

  it.each(["iat", "exp"] as const)("rejects a token missing %s", async (claim) => {
    const payload = launchPayload();
    delete payload[claim];
    const token = await signLaunch(privateKey, payload);

    await expect(makeLtiService(localJwks).validateToken(token, NONCE)).rejects.toThrow();
  });

  it("rejects non-numeric temporal claims", async () => {
    const token = await signLaunch(privateKey, {
      ...launchPayload(),
      exp: "tomorrow"
    } as unknown as JWTPayload);

    await expect(makeLtiService(localJwks).validateToken(token, NONCE)).rejects.toThrow();
  });

  it("rejects expired, stale, future-issued, and reversed token windows", async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalidWindows = [
      { iat: now - 600, exp: now - 60 },
      { iat: now - 600, exp: now + 600 },
      { iat: now + 60, exp: now + 300 },
      { iat: now, exp: now }
    ];

    for (const window of invalidWindows) {
      const token = await signLaunch(privateKey, launchPayload(window));
      await expect(makeLtiService(localJwks).validateToken(token, NONCE)).rejects.toThrow();
    }
  });
});

function makeLtiService(jwks: ReturnType<typeof createLocalJWKSet>, deploymentIdCheckingEnabled = true): LtiService {
  const config = {
    value: {
      lti: {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        deploymentId: DEPLOYMENT_ID,
        deploymentIdCheckingEnabled,
        keySetUrl: "https://canvas.example.com/api/lti/security/jwks"
      }
    }
  } as unknown as AppConfig;
  const service = new LtiService(config);
  Object.assign(service, { jwks });
  return service;
}

function launchPayload(overrides: JWTPayload = {}): JWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: "opaque-subject",
    nonce: NONCE,
    iat: now,
    exp: now + 300,
    "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
    "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id": DEPLOYMENT_ID,
    "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": TARGET_LINK_URI,
    "https://purl.imsglobal.org/spec/lti/claim/roles": [INSTRUCTOR_ROLE],
    "https://purl.imsglobal.org/spec/lti/claim/context": { id: "11825", title: "Course" },
    "https://purl.imsglobal.org/spec/lti/claim/custom": {
      canvas_course_id: "11825",
      canvas_user_id: "42",
      canvas_membership_roles: "TeacherEnrollment"
    },
    "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
      lineitems: "https://canvas.example.com/api/lti/courses/11825/line_items"
    },
    ...overrides
  };
}

async function signLaunch(key: CryptoKey, payload: JWTPayload): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(key);
}
