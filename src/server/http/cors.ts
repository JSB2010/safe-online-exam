import { ForbiddenException } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface.js";
import type { Request } from "express";

const CORS_METHODS = ["GET", "POST", "OPTIONS"];
const CORS_ALLOWED_HEADERS = [
  "content-type",
  "x-seb-proof-token",
  "x-safeexambrowser-configkeyhash",
  "x-seb-config-key-hash"
];

/**
 * CORS protects script-readable cross-origin requests, not normal document
 * navigations. Canvas OAuth returns in a top-level browser navigation that can
 * carry an Origin header, so applying the API CORS policy to it breaks the
 * return even though no other origin can read the response.
 */
export function corsOptionsForRequest(request: Pick<Request, "method" | "header">, config: AppConfig): CorsOptions {
  if (isBrowserDocumentNavigation(request)) {
    return { origin: false };
  }

  return {
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (isAllowedCorsOrigin(origin, config)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenException("Origin not allowed by CORS"));
    },
    credentials: false,
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS
  };
}

export function isBrowserDocumentNavigation(request: Pick<Request, "method" | "header">): boolean {
  return (
    request.method.toUpperCase() === "GET" &&
    request.header("sec-fetch-mode")?.trim().toLowerCase() === "navigate" &&
    request.header("sec-fetch-dest")?.trim().toLowerCase() === "document"
  );
}

export function isAllowedCorsOrigin(origin: string | undefined, config: AppConfig): boolean {
  if (!origin) {
    return true;
  }

  const originUrl = parseUrl(origin);
  if (!originUrl) {
    return false;
  }

  return sameOrigin(originUrl, config.toolUrl) || sameOrigin(originUrl, config.getCanvasDomain());
}

function sameOrigin(originUrl: URL, configuredUrl?: string): boolean {
  const parsed = parseUrl(configuredUrl);
  return !!parsed && originUrl.origin === parsed.origin;
}

function parseUrl(value?: string): URL | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
