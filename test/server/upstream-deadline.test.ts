import { describe, expect, it, vi } from "vitest";
import {
  UPSTREAM_REQUEST_TIMEOUT_MS,
  UpstreamRequestTimeoutError,
  withUpstreamDeadline
} from "../../src/server/http/upstream-deadline.js";

describe("withUpstreamDeadline", () => {
  it("leaves time for one explicit compensation call inside the assessment lock lease", () => {
    expect(UPSTREAM_REQUEST_TIMEOUT_MS * 2).toBeLessThan(30_000);
  });

  it("aborts a stalled upstream operation with a typed timeout", async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const operation = withUpstreamDeadline((signal) => {
        observedSignal = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }, 25);
      const rejected = expect(operation).rejects.toBeInstanceOf(UpstreamRequestTimeoutError);

      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(observedSignal?.aborted).toBe(true);
      expect(observedSignal?.reason).toBeInstanceOf(UpstreamRequestTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });
});
