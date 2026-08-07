import type { Response } from "express";

export function setSecretResponseHeaders(response: Response): void {
  response.setHeader("cache-control", "private, no-store, max-age=0");
  response.setHeader("pragma", "no-cache");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
}
