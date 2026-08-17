import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Response } from "express";

const CONTENT_HASHED_CLIENT_ASSET = /-[A-Za-z0-9_-]{8}\.(?:css|js)$/u;
const SAFE_CLIENT_MODULE = /^assets\/[A-Za-z0-9._-]+\.js$/u;

type ViteManifestEntry = {
  file?: unknown;
  imports?: unknown;
  isEntry?: unknown;
};

let cachedManifestPath: string | undefined;
let cachedEntryPreloads: string[] | undefined;

export function setClientAssetCacheHeaders(response: Response, assetPath: string): void {
  response.setHeader(
    "cache-control",
    CONTENT_HASHED_CLIENT_ASSET.test(assetPath) ? "public, max-age=31536000, immutable" : "no-cache"
  );
}

export function clientEntryModulePreloads(cwd = process.cwd()): string[] {
  const manifestPath = join(cwd, "dist/client/.vite/manifest.json");
  if (cachedManifestPath === manifestPath && cachedEntryPreloads) {
    return cachedEntryPreloads;
  }

  try {
    cachedEntryPreloads = parseClientEntryModulePreloads(readFileSync(manifestPath, "utf8"));
  } catch {
    cachedEntryPreloads = [];
  }
  cachedManifestPath = manifestPath;
  return cachedEntryPreloads;
}

export function parseClientEntryModulePreloads(value: string): string[] {
  const manifest: unknown = JSON.parse(value);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [];
  }

  const entries = manifest as Record<string, ViteManifestEntry>;
  const entry = Object.values(entries).find((candidate) => candidate.isEntry === true);
  if (!entry || !Array.isArray(entry.imports)) {
    return [];
  }

  return entry.imports.flatMap((importKey) => {
    if (typeof importKey !== "string") {
      return [];
    }
    const imported = entries[importKey];
    return typeof imported?.file === "string" && SAFE_CLIENT_MODULE.test(imported.file) ? [`/${imported.file}`] : [];
  });
}
