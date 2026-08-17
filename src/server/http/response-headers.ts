import type { Response } from "express";

export function setSecretResponseHeaders(response: Response): void {
  response.setHeader("cache-control", "private, no-store, max-age=0");
  response.setHeader("pragma", "no-cache");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
}

export function setPrivateNoStoreResponseHeaders(response: Response): void {
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("referrer-policy", "no-referrer");
}

export function setSebDownloadResponseHeaders(response: Response): void {
  setPrivateNoStoreResponseHeaders(response);
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-transfer-encoding", "binary");
}

export function setSensitiveSebResponseHeaders(response?: Response): void {
  if (!response) {
    return;
  }
  response.setHeader("cache-control", "private, no-store, max-age=0");
  response.setHeader("pragma", "no-cache");
  response.setHeader("expires", "0");
  response.setHeader("referrer-policy", "no-referrer");
  response.vary("Origin, X-SEB-Proof-Token");
}
