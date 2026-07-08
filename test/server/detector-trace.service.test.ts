import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetectorTraceService } from "../../src/server/services/detector-trace.service.js";

describe("DetectorTraceService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes sanitized detector trace payloads to the application log", () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const service = new DetectorTraceService();

    service.recordEvent(
      {
        traceId: "trace-1",
        pageUrl: "https://canvas.example.edu/courses/11825/quizzes/23455/take?user_id=7288&access_code=SECRET",
        accessCode: "SECRET",
        proofToken: "proof-1",
        events: [
          {
            event: "submit",
            readyState: "complete",
            details: {
              action: "https://canvas.example.edu/courses/11825/quizzes/23455?state=abc123"
            }
          }
        ]
      },
      {
        origin: "https://canvas.example.edu",
        userAgent: "SafeExamBrowser"
      }
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const rendered = String(logSpy.mock.calls[0][0]);
    expect(rendered).toContain("canvas-seb-detector");
    expect(rendered).toContain("SafeExamBrowser");
    expect(rendered).toContain("complete");
    expect(rendered).not.toContain("SECRET");
    expect(rendered).not.toContain("proof-1");
    expect(rendered).not.toContain("user_id=7288");
    expect(rendered).not.toContain("state=abc123");
    expect(rendered).toContain("%5Bredacted%5D");
  });
});
