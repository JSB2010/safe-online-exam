import { describe, expect, it, vi } from "vitest";
import {
  discardResponseBody,
  readBoundedUtf8Response,
  UpstreamResponseReadError,
  UpstreamResponseTooLargeError
} from "../../src/server/http/bounded-response.js";

describe("bounded upstream response reader", () => {
  it("reads and decodes a response within its byte limit", async () => {
    const encoded = new TextEncoder().encode("safe ✓");
    const response = streamResponse([encoded.subarray(0, 6), encoded.subarray(6)]);

    await expect(readBoundedUtf8Response(response, encoded.byteLength)).resolves.toBe("safe ✓");
  });

  it("rejects an oversized declared body and cancels it without reading", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull: vi.fn(),
        cancel
      }),
      { headers: { "content-length": "101" } }
    );

    await expect(readBoundedUtf8Response(response, 100)).rejects.toBeInstanceOf(UpstreamResponseTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces the streamed byte count when Content-Length is absent or false", async () => {
    const response = streamResponse([new Uint8Array(6), new Uint8Array(5)]);

    await expect(readBoundedUtf8Response(response, 10)).rejects.toBeInstanceOf(UpstreamResponseTooLargeError);
  });

  it("replaces stream and UTF-8 decoder failures with sanitized errors", async () => {
    const streamFailure = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("SECRET_STREAM_FAILURE"));
        }
      })
    );
    const invalidUtf8 = streamResponse([Uint8Array.from([0xc3, 0x28])]);

    for (const response of [streamFailure, invalidUtf8]) {
      const error = await readBoundedUtf8Response(response, 100).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UpstreamResponseReadError);
      expect(String(error)).not.toContain("SECRET_STREAM_FAILURE");
    }
  });

  it("sanitizes an unavailable body reader and rejects invalid byte limits", async () => {
    const lockedResponse = streamResponse([new TextEncoder().encode("SECRET_LOCKED_BODY")]);
    const lock = lockedResponse.body!.getReader();
    try {
      const error = await readBoundedUtf8Response(lockedResponse, 100).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(UpstreamResponseReadError);
      expect(String(error)).not.toContain("SECRET_LOCKED_BODY");
    } finally {
      await lock.cancel();
      lock.releaseLock();
    }

    await expect(readBoundedUtf8Response(new Response("safe"), 0)).rejects.toBeInstanceOf(RangeError);
  });

  it("silently discards an unwanted response body", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));

    await expect(discardResponseBody(response)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

function streamResponse(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      }
    })
  );
}
