import { describe, expect, it } from "vitest";
import { SebDetector } from "../../src/server/services/seb-detector.service.js";

describe("SebDetector", () => {
  it("accepts modern SEB user agents", () => {
    const detector = new SebDetector();
    const request = requestWithHeaders({ "user-agent": "Mozilla/5.0 SafeExamBrowser" });

    expect(detector.isRequestFromSeb(request)).toBe(true);
  });

  it("accepts Config Key proof headers as SEB signals", () => {
    const detector = new SebDetector();
    const request = requestWithHeaders({
      "user-agent": "Chrome",
      "x-safeexambrowser-configkeyhash": "hash-from-seb"
    });

    expect(detector.isRequestFromSeb(request)).toBe(true);
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
