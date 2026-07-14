import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetectorTraceService } from "../../src/server/services/detector-trace.service.js";

describe("DetectorTraceService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs only the structural detector-event allowlist", () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const service = new DetectorTraceService();
    const secretSentinel = "SEB_TEST_SECRET_SENTINEL";

    service.recordEvent(
      {
        traceId: "trace-1",
        pageUrl: `https://canvas.example.edu/courses/11825/quizzes/23455/take?access_code=${secretSentinel}`,
        accessCode: secretSentinel,
        proofToken: secretSentinel,
        events: [
          {
            seq: 7,
            event: "submit",
            type: "success",
            readyState: "complete",
            hidden: true,
            sebDetected: true,
            details: {
              action: `https://canvas.example.edu/courses/11825/quizzes/23455?state=${secretSentinel}`,
              answerText: secretSentinel
            }
          },
          {
            event: secretSentinel,
            details: secretSentinel
          }
        ]
      },
      {
        origin: "https://canvas.example.edu/private/path?access_code=not-logged"
      }
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const rendered = String(logSpy.mock.calls[0][0]);
    const entry = JSON.parse(rendered) as Record<string, unknown>;
    expect(entry).toMatchObject({
      source: "canvas-seb-detector",
      origin: "https://canvas.example.edu",
      traceId: "trace-1",
      events: [
        {
          seq: 7,
          event: "submit",
          type: "success",
          readyState: "complete",
          hidden: true,
          sebDetected: true
        }
      ]
    });
    expect(Object.keys(entry).sort()).toEqual(["events", "origin", "receivedAt", "source", "traceId"]);
    expect(Object.keys((entry.events as Array<Record<string, unknown>>)[0]).sort()).toEqual([
      "event",
      "hidden",
      "readyState",
      "sebDetected",
      "seq",
      "type"
    ]);
    expect(rendered).not.toContain(secretSentinel);
    expect(rendered).not.toContain("access_code");
    expect(rendered).not.toContain("private/path");
  });

  it("logs capped event details only when the caller opts in", () => {
    const logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const service = new DetectorTraceService();

    service.recordEvent(
      {
        traceId: "trace-2",
        events: [
          { seq: 1, event: "diagnostic-dom-snapshot", details: { pathname: "/courses/1/assignments/2" } },
          { seq: 2, event: "diagnostic-click", details: "x".repeat(10_000) }
        ]
      },
      { origin: "https://canvas.example.edu", includeDetails: true }
    );

    const entry = JSON.parse(String(logSpy.mock.calls[0][0])) as {
      events: Array<{ event: string; details?: string }>;
    };
    expect(entry.events[0].details).toBe(JSON.stringify({ pathname: "/courses/1/assignments/2" }));
    expect(entry.events[1].details).toContain("...[truncated]");
    expect(entry.events[1].details!.length).toBeLessThanOrEqual(6_020);
  });
});
