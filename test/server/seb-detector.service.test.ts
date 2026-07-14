import { describe, expect, it } from "vitest";
import { SebDetector } from "../../src/server/services/seb-detector.service.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";

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

  it("does not accept spoofed SEB user agents for protected quiz settings", () => {
    const request = requestWithHeaders({ "user-agent": "Mozilla/5.0 SEB/3.6.1" });

    expect(new SebDetector().isRequestFromSeb(request, { configKey: "expected-config-key" })).toBe(false);
  });

  it("accepts valid Config Key proof headers for protected quiz settings", () => {
    const configKey = new SebConfigKeyService();
    const storedConfigKey = "expected-config-key";
    const requestUrl = "https://tool.example.edu/seb/quiz/course-1/quiz-1";
    const request = requestWithHeaders({
      "user-agent": "Chrome",
      "x-safeexambrowser-configkeyhash": configKey.hashForUrl(requestUrl, storedConfigKey)
    });

    expect(new SebDetector().isRequestFromSeb(request, { configKey: storedConfigKey })).toBe(true);
  });
});

function requestWithHeaders(headers: Record<string, string>) {
  return {
    protocol: "https",
    hostname: "tool.example.edu",
    originalUrl: "/seb/quiz/course-1/quiz-1",
    get(name: string) {
      return name.toLowerCase() === "host" ? "tool.example.edu" : headers[name.toLowerCase()];
    },
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as any;
}
