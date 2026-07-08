import type { AppConfig } from "../config/app-config.js";

export function isAllowedCorsOrigin(origin: string | undefined, config: AppConfig): boolean {
  if (!origin) {
    return true;
  }

  const originUrl = parseUrl(origin);
  if (!originUrl) {
    return false;
  }

  if (sameOrigin(originUrl, config.toolUrl) || sameOrigin(originUrl, config.getCanvasDomain())) {
    return true;
  }

  const host = originUrl.hostname.toLowerCase();
  if (isCanvasHost(host)) {
    return true;
  }

  return config.profile !== "prod" && isLocalhost(host);
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

function isCanvasHost(host: string): boolean {
  return (
    host.endsWith(".instructure.com") ||
    host.endsWith(".canvaslms.com") ||
    host.endsWith(".insops.net") ||
    host.endsWith(".inscloudgate.net") ||
    host === "canvas.instructure.com"
  );
}

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
