export class UpstreamResponseTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super("Upstream response exceeded the configured byte limit");
    this.name = "UpstreamResponseTooLargeError";
  }
}

export class UpstreamResponseReadError extends Error {
  constructor() {
    super("Upstream response could not be read safely");
    this.name = "UpstreamResponseReadError";
  }
}

export async function readBoundedUtf8Response(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Response byte limit must be a positive safe integer");
  }

  const declaredLength = declaredContentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    await discardResponseBody(response);
    throw new UpstreamResponseTooLargeError(maxBytes);
  }
  if (!response.body) {
    return "";
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    throw new UpstreamResponseReadError();
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength > maxBytes - totalBytes) {
        await cancelReader(reader);
        throw new UpstreamResponseTooLargeError(maxBytes);
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } catch (error) {
    if (error instanceof UpstreamResponseTooLargeError) {
      throw error;
    }
    await cancelReader(reader);
    throw new UpstreamResponseReadError();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader state errors are intentionally collapsed into the safe result above.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new UpstreamResponseReadError();
  }
}

export async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A failed best-effort cancellation must not expose the upstream error.
  }
}

function declaredContentLength(response: Response): number | null {
  const value = response.headers.get("content-length")?.trim();
  if (!value || !/^[0-9]+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // A failed best-effort cancellation must not replace the sanitized error.
  }
}
