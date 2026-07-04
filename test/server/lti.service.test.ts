import { describe, expect, it } from "vitest";
import { launchDataFromPayload } from "../../src/server/services/lti.service.js";

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
          lineitems: "https://canvas.example.com/api/lti/courses/99999/line_items"
        }
      })
    ).toMatchObject({
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
});
