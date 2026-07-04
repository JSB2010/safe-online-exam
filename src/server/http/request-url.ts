import type { Request } from "express";

export function requestBaseUrl(request: Request): string {
  const forwardedProto = firstHeader(request.header("x-forwarded-proto"));
  const scheme = forwardedProto || request.protocol || "http";
  const host = firstHeader(request.header("x-forwarded-host")) || request.hostname;
  const forwardedPort = firstHeader(request.header("x-forwarded-port"));
  const fallbackPort = forwardedProto
    ? defaultPortForScheme(scheme, request.socket.localPort || 0)
    : request.socket.localPort || 0;
  const port = forwardedPort ? Number.parseInt(forwardedPort, 10) : fallbackPort;
  const includePort = !hostIncludesPort(host) && port > 0 && !isDefaultPort(scheme, port);
  return `${scheme}://${host}${includePort ? `:${port}` : ""}`;
}

export function absoluteUrl(request: Request, path: string, configuredBaseUrl?: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = configuredBaseUrl?.trim() ? configuredBaseUrl.replace(/\/+$/u, "") : requestBaseUrl(request);
  return `${baseUrl}${normalizedPath}`;
}

export function sebSchemeUrl(request: Request, path: string, configuredBaseUrl?: string): string {
  const url = absoluteUrl(request, path, configuredBaseUrl);
  if (url.startsWith("https://")) {
    return `sebs://${url.slice("https://".length)}`;
  }
  if (url.startsWith("http://")) {
    return `seb://${url.slice("http://".length)}`;
  }
  return url;
}

export function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value?.split(",", 2)[0]?.trim() || undefined;
}

function hostIncludesPort(host: string): boolean {
  return /:\d+$/u.test(host);
}

function isDefaultPort(scheme: string, port: number): boolean {
  return (scheme === "https" && port === 443) || (scheme === "http" && port === 80);
}

function defaultPortForScheme(scheme: string, fallback: number): number {
  if (scheme === "https") {
    return 443;
  }
  if (scheme === "http") {
    return 80;
  }
  return fallback;
}
