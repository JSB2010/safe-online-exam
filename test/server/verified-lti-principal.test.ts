import { describe, expect, it } from "vitest";
import {
  CanvasLtiConfigurationError,
  createVerifiedLtiPrincipal,
  isCanvasRestUserId
} from "../../src/server/security/verified-lti-principal.js";

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
});
