import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/app-config.js";

const ACTION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const ACTION_TOKEN_PURPOSE = "assessment-management";
const SEB_CONFIG_GRANT_TOKEN_PURPOSE = "seb-config-grant";

export interface ActionTokenPayload {
  version: 2;
  purpose: typeof ACTION_TOKEN_PURPOSE;
  userId: string;
  courseId: string;
  subject: string;
  deploymentId: string;
  sessionBinding: string;
  exp: number;
}

export interface ActionTokenContext {
  subject: string;
  deploymentId: string;
  sessionId: string;
}

export interface SebConfigGrantActionTokenPayload {
  version: 1;
  purpose: typeof SEB_CONFIG_GRANT_TOKEN_PURPOSE;
  userId: string;
  courseId: string;
  subject: string;
  deploymentId: string;
  sessionBinding: string;
  exp: number;
}

export function createActionToken(
  config: AppConfig,
  userId: string,
  courseId: string,
  context: ActionTokenContext
): string {
  const payload: ActionTokenPayload = {
    version: 2,
    purpose: ACTION_TOKEN_PURPOSE,
    userId,
    courseId,
    subject: context.subject,
    deploymentId: context.deploymentId,
    sessionBinding: sessionBinding(config, context.sessionId),
    exp: Date.now() + ACTION_TOKEN_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(config, encodedPayload)}`;
}

export function verifyActionToken(config: AppConfig, token: string | undefined | null): ActionTokenPayload | null {
  const segments = parseSignedToken(token);
  if (!segments) {
    return null;
  }
  const [encodedPayload, signature] = segments;
  if (!constantTimeEquals(signature, sign(config, encodedPayload))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ActionTokenPayload;
    if (
      payload.version !== 2 ||
      payload.purpose !== ACTION_TOKEN_PURPOSE ||
      !payload.userId ||
      !payload.courseId ||
      !payload.subject ||
      !payload.deploymentId ||
      !payload.sessionBinding ||
      !payload.exp ||
      payload.exp < Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createSebConfigGrantActionToken(
  config: AppConfig,
  userId: string,
  courseId: string,
  context: ActionTokenContext
): string {
  const payload: SebConfigGrantActionTokenPayload = {
    version: 1,
    purpose: SEB_CONFIG_GRANT_TOKEN_PURPOSE,
    userId,
    courseId,
    subject: context.subject,
    deploymentId: context.deploymentId,
    sessionBinding: sessionBinding(config, context.sessionId),
    exp: Date.now() + ACTION_TOKEN_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(config, encodedPayload)}`;
}

export function verifySebConfigGrantActionToken(
  config: AppConfig,
  token: string | undefined | null
): SebConfigGrantActionTokenPayload | null {
  const segments = parseSignedToken(token);
  if (!segments) {
    return null;
  }
  const [encodedPayload, signature] = segments;
  if (!constantTimeEquals(signature, sign(config, encodedPayload))) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as SebConfigGrantActionTokenPayload;
    if (
      payload.version !== 1 ||
      payload.purpose !== SEB_CONFIG_GRANT_TOKEN_PURPOSE ||
      !payload.userId ||
      !payload.courseId ||
      !payload.subject ||
      !payload.deploymentId ||
      !payload.sessionBinding ||
      !payload.exp ||
      payload.exp < Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function expectedSessionBinding(config: AppConfig, sessionId: string): string {
  return sessionBinding(config, sessionId);
}

function sign(config: AppConfig, encodedPayload: string): string {
  return createHmac("sha256", config.value.security.sessionSecret).update(encodedPayload).digest("base64url");
}

function sessionBinding(config: AppConfig, sessionId: string): string {
  return createHmac("sha256", config.value.security.sessionSecret)
    .update(`assessment-session:${sessionId}`, "utf8")
    .digest("base64url");
}

function parseSignedToken(token: string | undefined | null): [string, string] | null {
  if (!token || token.length > 4096) {
    return null;
  }
  const segments = token.split(".");
  if (segments.length !== 2) {
    return null;
  }
  const [encodedPayload, signature] = segments;
  if (
    !encodedPayload ||
    !signature ||
    !/^[A-Za-z0-9_-]+$/u.test(encodedPayload) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(signature)
  ) {
    return null;
  }
  try {
    if (Buffer.from(encodedPayload, "base64url").toString("base64url") !== encodedPayload) {
      return null;
    }
  } catch {
    return null;
  }
  return [encodedPayload, signature];
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
