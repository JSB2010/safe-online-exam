import type { Response } from "express";
import type { AppConfig } from "../config/app-config.js";

export function applySecurityHeaders(response: Response, config: AppConfig): void {
  const headers = securityHeaders(config);
  for (const [name, value] of Object.entries(headers)) {
    if (!response.hasHeader(name)) {
      response.setHeader(name, value);
    }
  }
}

export function securityHeaders(config: AppConfig): Record<string, string> {
  const canvasOrigin = new URL(config.getCanvasDomain()).origin;
  const directives = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'self'",
    `frame-ancestors 'self' ${canvasOrigin}`
  ];
  if (config.profile === "prod" || config.toolUrl?.startsWith("https://")) {
    directives.push("upgrade-insecure-requests");
  }

  const headers: Record<string, string> = {
    "content-security-policy": directives.join("; "),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
    "x-permitted-cross-domain-policies": "none",
    "x-dns-prefetch-control": "off",
    "cache-control": "no-store"
  };
  if (config.profile === "prod" || config.toolUrl?.startsWith("https://")) {
    headers["strict-transport-security"] = "max-age=31536000";
  }
  return headers;
}
