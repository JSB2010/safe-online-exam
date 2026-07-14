import type { AppConfig } from "../config/app-config.js";

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
