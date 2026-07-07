import { Injectable, Logger } from "@nestjs/common";

export interface DetectorTraceRequestMeta {
  ip?: string;
  origin?: string;
  userAgent?: string;
}

const MAX_STRING_LENGTH = 600;
const MAX_ARRAY_LENGTH = 25;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 5;

const SENSITIVE_KEY_PATTERN =
  /(?:access.?code|authorization|config.?key|cookie|encryption.?key|id.?token|password|private.?key|proof(?:.?token)?|secret|token|(?:^|[_-])state(?:$|[_-]))/iu;
const SENSITIVE_URL_PARAMS = [
  "access_code",
  "access-token",
  "access_token",
  "canvas_url",
  "code",
  "id_token",
  "login_hint",
  "proofToken",
  "quiz_access_code",
  "state",
  "token",
  "user_id"
];

@Injectable()
export class DetectorTraceService {
  private readonly logger = new Logger("CanvasSebDetectorTrace");

  recordEvent(payload: unknown, meta: DetectorTraceRequestMeta = {}): void {
    const entry = {
      source: "canvas-seb-detector",
      receivedAt: new Date().toISOString(),
      origin: sanitizeValue(meta.origin, "origin"),
      userAgent: sanitizeValue(meta.userAgent, "userAgent"),
      ip: sanitizeValue(meta.ip, "ip"),
      payload: sanitizeValue(payload)
    };

    this.logger.log(JSON.stringify(entry));
  }
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (depth >= MAX_DEPTH) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, key, depth + 1));
  }

  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      sanitized[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1);
    }
    return sanitized;
  }

  return String(value);
}

function sanitizeString(value: string): string {
  const trimmed = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  return sanitizeUrlIfPossible(trimmed);
}

function sanitizeUrlIfPossible(value: string): string {
  try {
    const url = new URL(value);
    for (const param of SENSITIVE_URL_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, "[redacted]");
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}
