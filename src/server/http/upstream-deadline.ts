// Two explicit calls (a primary mutation plus compensation) still fit inside the 30s assessment lease.
export const UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;

export class UpstreamRequestTimeoutError extends Error {
  constructor() {
    super("Upstream request timed out");
    this.name = "UpstreamRequestTimeoutError";
  }
}

/**
 * Runs one complete upstream sequence under a shared deadline. Reusing this signal for token
 * refresh, request, and body parsing prevents each step from receiving a fresh timeout.
 */
export async function withUpstreamDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = UPSTREAM_REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new UpstreamRequestTimeoutError()), timeoutMs);
  timeout.unref?.();
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && isUpstreamRequestTimeout(controller.signal.reason)) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function isUpstreamRequestTimeout(error: unknown): error is UpstreamRequestTimeoutError {
  return (
    error instanceof UpstreamRequestTimeoutError ||
    (!!error && typeof error === "object" && "name" in error && error.name === "TimeoutError")
  );
}
