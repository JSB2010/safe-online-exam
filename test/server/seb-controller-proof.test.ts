import { describe, expect, it } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { isSebJavascriptConfigProof } from "../../src/server/controllers/seb.controller.js";

function requestWithUserAgent(userAgent: string) {
  return {
    header(name: string) {
      return name.toLowerCase() === "user-agent" ? userAgent : undefined;
    }
  } as any;
}

describe("SEB JavaScript proof validation", () => {
  it("accepts SEB JavaScript Config Key proof only on the expected Canvas quiz URL", () => {
    const previousCanvasBaseUrl = process.env.CANVAS_BASE_URL;
    process.env.CANVAS_BASE_URL = "https://kentdenver.instructure.com";
    const config = new AppConfig();
    const request = requestWithUserAgent("Mozilla/5.0 SEB/3.6.1");

    try {
      expect(
        isSebJavascriptConfigProof(
          request,
          {
            configKeyHash: "a".repeat(64),
            url: "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take?user_id=7288"
          },
          config,
          "11825",
          "23455"
        )
      ).toBe(true);

      expect(
        isSebJavascriptConfigProof(
          requestWithUserAgent("Mozilla/5.0 Safari/605.1.15"),
          {
            configKeyHash: "a".repeat(64),
            url: "https://kentdenver.instructure.com/courses/11825/quizzes/23455/take?user_id=7288"
          },
          config,
          "11825",
          "23455"
        )
      ).toBe(false);

      expect(
        isSebJavascriptConfigProof(
          request,
          {
            configKeyHash: "a".repeat(64),
            url: "https://kentdenver.instructure.com/courses/11825/quizzes/99999/take"
          },
          config,
          "11825",
          "23455"
        )
      ).toBe(false);
    } finally {
      if (previousCanvasBaseUrl === undefined) {
        delete process.env.CANVAS_BASE_URL;
      } else {
        process.env.CANVAS_BASE_URL = previousCanvasBaseUrl;
      }
    }
  });
});
