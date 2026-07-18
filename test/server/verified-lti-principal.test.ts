import { describe, expect, it } from "vitest";
import {
  CanvasLtiConfigurationError,
  createVerifiedLtiPrincipal,
  isCanvasRestUserId,
  isVerifiedAccountAdmin
} from "../../src/server/security/verified-lti-principal.js";

const administratorRole = "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator";
const systemAdministratorRole = "http://purl.imsglobal.org/vocab/lis/v2/system/person#SysAdmin";

describe("verified LTI principal", () => {
  it("keeps the opaque LTI subject separate from the signed numeric Canvas REST user id", () => {
    expect(
      createVerifiedLtiPrincipal({
        ltiSubject: "opaque-subject",
        canvasUserId: "42",
        userId: "42",
        issuer: "https://canvas.example.edu",
        deploymentId: "deployment-1",
        courseId: "11825",
        roles: []
      })
    ).toMatchObject({
      subject: "opaque-subject",
      canvasUserId: "42",
      courseId: "11825"
    });
  });

  it.each([undefined, "", "opaque-subject", "$Canvas.user.id", "42.0", " 42"])(
    "rejects a missing or nonnumeric Canvas REST user id: %s",
    (canvasUserId) => {
      expect(() =>
        createVerifiedLtiPrincipal({
          ltiSubject: "opaque-subject",
          canvasUserId,
          userId: "opaque-subject",
          issuer: "https://canvas.example.edu",
          deploymentId: "deployment-1",
          courseId: "11825",
          roles: []
        })
      ).toThrow(CanvasLtiConfigurationError);
    }
  );

  it.each(["1", "42", "9007199254740993"])("accepts a decimal Canvas REST user id: %s", (value) => {
    expect(isCanvasRestUserId(value)).toBe(true);
  });

  it("creates a root-account administrator principal only from signed administrator launch claims", () => {
    const principal = createVerifiedLtiPrincipal({
      ltiSubject: "opaque-admin-subject",
      canvasUserId: "42",
      userId: "42",
      issuer: "https://canvas.example.edu",
      deploymentId: "deployment-1",
      courseId: "",
      roles: [administratorRole],
      custom: {
        seb_launch_surface: "account_admin",
        canvas_account_id: "7",
        canvas_root_account_id: "7",
        canvas_user_is_root_account_admin: "true"
      }
    });

    expect(isVerifiedAccountAdmin(principal)).toBe(true);
    expect(principal).toMatchObject({
      contextType: "account",
      canvasUserId: "42",
      accountId: "7",
      rootAccountId: "7",
      courseId: "",
      isRootAccountAdmin: true
    });
  });

  it("accepts a signed Canvas system administrator only with the independent root-account assertion", () => {
    const principal = createVerifiedLtiPrincipal({
      ltiSubject: "opaque-admin-subject",
      canvasUserId: "42",
      userId: "42",
      issuer: "https://canvas.example.edu",
      deploymentId: "deployment-1",
      courseId: "",
      roles: [systemAdministratorRole],
      custom: {
        seb_launch_surface: "account_admin",
        canvas_account_id: "7",
        canvas_root_account_id: "7",
        canvas_user_is_root_account_admin: "true"
      }
    });

    expect(isVerifiedAccountAdmin(principal)).toBe(true);
  });

  it.each([
    ["non-admin role", []],
    ["non-root admin flag", [administratorRole]]
  ])("rejects an administrative surface with %s", (condition, roles) => {
    expect(() =>
      createVerifiedLtiPrincipal({
        ltiSubject: "opaque-admin-subject",
        canvasUserId: "42",
        userId: "42",
        issuer: "https://canvas.example.edu",
        deploymentId: "deployment-1",
        courseId: "",
        roles,
        custom: {
          seb_launch_surface: "account_admin",
          canvas_account_id: "7",
          canvas_root_account_id: "7",
          canvas_user_is_root_account_admin: condition === "non-root admin flag" ? "false" : "true"
        }
      })
    ).toThrow(
      condition === "non-root admin flag"
        ? "does not identify a Canvas root-account administrator"
        : "missing a signed Canvas administrator role"
    );
  });
});
