import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/app-config.js";

const ACTION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export interface ActionTokenPayload {
  userId: string;
  courseId: string;
  exp: number;
}

export function createActionToken(config: AppConfig, userId: string, courseId: string): string {
  const payload: ActionTokenPayload = {
    userId,
    courseId,
    exp: Date.now() + ACTION_TOKEN_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(config, encodedPayload)}`;
}

export function verifyActionToken(config: AppConfig, token: string | undefined | null): ActionTokenPayload | null {
  if (!token) {
    return null;
  }
  const [encodedPayload, signature] = token.split(".", 2);
  if (!encodedPayload || !signature || !constantTimeEquals(signature, sign(config, encodedPayload))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ActionTokenPayload;
    if (!payload.userId || !payload.courseId || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function sign(config: AppConfig, encodedPayload: string): string {
  return createHmac("sha256", config.value.security.sessionSecret).update(encodedPayload).digest("base64url");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
