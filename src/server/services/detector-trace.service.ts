import { Injectable, Logger } from "@nestjs/common";

export interface DetectorTraceRequestMeta {
  origin?: string;
  includeDetails?: boolean;
}

interface SafeTraceEvent {
  seq: number;
  event: string;
  type: "info" | "success" | "warn" | "error";
  readyState: "loading" | "interactive" | "complete" | "unknown";
  hidden: boolean;
  sebDetected: boolean;
  details?: string;
}

const MAX_DETAILS_LENGTH = 6_000;
const MAX_DETAIL_STRING_LENGTH = 400;
const SENSITIVE_DETAIL_KEY =
  /(?:access.?code|authorization|config.?key|cookie|encryption.?key|grant|id.?token|jwt|password|private.?key|proof(?:.?token)?|secret|token|(?:^|[_-])state(?:$|[_-]))/iu;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/giu;
const JWT_IN_TEXT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;

@Injectable()
export class DetectorTraceService {
  private readonly logger = new Logger("CanvasSebDetectorTrace");

  recordEvent(payload: unknown, meta: DetectorTraceRequestMeta = {}): void {
    const input = asRecord(payload);
    const traceId = safeIdentifier(input.traceId, 80);
    const events = Array.isArray(input.events)
      ? input.events
          .slice(0, 25)
          .map((event) => toSafeEvent(event, meta.includeDetails === true))
          .filter((event): event is SafeTraceEvent => !!event)
      : [];
    const entry = {
      source: "canvas-seb-detector",
      receivedAt: new Date().toISOString(),
      origin: safeOrigin(meta.origin),
      traceId,
      events
    };
    this.logger.log(JSON.stringify(entry));
  }
}

function toSafeEvent(value: unknown, includeDetails: boolean): SafeTraceEvent | null {
  const event = asRecord(value);
  const name = safeIdentifier(event.event, 64);
  if (!name) {
    return null;
  }
  const type = ["info", "success", "warn", "error"].includes(String(event.type))
    ? (String(event.type) as SafeTraceEvent["type"])
    : "info";
  const readyState = ["loading", "interactive", "complete"].includes(String(event.readyState))
    ? (String(event.readyState) as SafeTraceEvent["readyState"])
    : "unknown";
  const safeEvent: SafeTraceEvent = {
    seq: Number.isSafeInteger(event.seq) && Number(event.seq) >= 0 ? Number(event.seq) : 0,
    event: name,
    type,
    readyState,
    hidden: event.hidden === true,
    sebDetected: event.sebDetected === true
  };
  if (includeDetails && event.details !== undefined) {
    safeEvent.details = safeDetails(event.details);
  }
  return safeEvent;
}

function safeDetails(value: unknown): string {
  try {
    const serialized = JSON.stringify(sanitizeDetailValue(value));
    if (typeof serialized !== "string") {
      return "[unserializable]";
    }
    return serialized.length > MAX_DETAILS_LENGTH
      ? serialized.slice(0, MAX_DETAILS_LENGTH) + "...[truncated]"
      : serialized;
  } catch {
    return "[unserializable]";
  }
}

function sanitizeDetailValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_DETAIL_KEY.test(key)) {
    return "[redacted]";
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeDetailString(value);
  }
  if (depth >= 4) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDetailValue(item, key, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeDetailValue(entryValue, entryKey, depth + 1)])
    );
  }
  return sanitizeDetailString(String(value));
}

function sanitizeDetailString(value: string): string {
  const redacted = value.replace(JWT_IN_TEXT, "[redacted-jwt]").replace(URL_IN_TEXT, sanitizeDiagnosticUrl);
  return redacted.length > MAX_DETAIL_STRING_LENGTH
    ? redacted.slice(0, MAX_DETAIL_STRING_LENGTH) + "...[truncated]"
    : redacted;
}

function sanitizeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    if (url.pathname.startsWith("/seb/exit/session/")) {
      const segments = url.pathname.split("/");
      segments[segments.length - 1] = "[redacted]";
      url.pathname = segments.join("/");
    }
    return url.toString();
  } catch {
    return "[unparseable-url]";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeIdentifier(value: unknown, maxLength: number): string | null {
  const text = typeof value === "string" ? value : "";
  return text.length <= maxLength && /^[a-z0-9-]+$/u.test(text) ? text : null;
}

function safeOrigin(value?: string): string | null {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}
