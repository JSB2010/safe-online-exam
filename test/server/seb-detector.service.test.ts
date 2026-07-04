import { describe, expect, it } from "vitest";
import { SebDetector } from "../../src/server/services/seb-detector.service.js";

describe("SebDetector", () => {
  it("accepts modern SEB user agents and validates provided Browser Exam Keys", () => {
    const detector = new SebDetector();
    const request = requestWithHeaders({ "user-agent": "Mozilla/5.0 SafeExamBrowser" });

    expect(detector.isRequestFromSeb(request, { browserExamKey: "bek-1" })).toBe(true);
    expect(detector.validateBrowserExamKey("bek-1", "bek-1")).toBe(true);
    expect(detector.validateBrowserExamKey("wrong", "bek-1")).toBe(false);
  });

  it("rejects non-SEB requests", () => {
    expect(new SebDetector().isRequestFromSeb(requestWithHeaders({ "user-agent": "Chrome" }))).toBe(false);
  });
});

function requestWithHeaders(headers: Record<string, string>) {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as any;
}
