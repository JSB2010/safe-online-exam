import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import plist from "plist";
import type { Request } from "express";

@Injectable()
export class SebConfigKeyService {
  computeConfigKey(sebConfig: Buffer | Uint8Array | string): string {
    const text = Buffer.isBuffer(sebConfig) ? sebConfig.toString("utf8") : Buffer.from(sebConfig).toString("utf8");
    const parsed = plist.parse(text) as unknown;
    const canonical = canonicalizeSebPlist(parsed);
    return sha256Hex(canonical);
  }

  hashForUrl(url: string, storedConfigKey: string): string {
    return sha256Hex(stripFragment(url) + storedConfigKey);
  }

  validateConfigKeyHashForUrl(
    providedHash?: string | null,
    url?: string | null,
    storedConfigKey?: string | null
  ): boolean {
    if (!providedHash || !url || !storedConfigKey) {
      return false;
    }
    const candidates = [storedConfigKey, this.hashForUrl(url, storedConfigKey)];
    const querylessUrl = stripQueryAndFragment(url);
    if (querylessUrl !== stripFragment(url)) {
      candidates.push(this.hashForUrl(querylessUrl, storedConfigKey));
    }
    return candidates.some((candidate) => safeHashEqual(providedHash, candidate));
  }

  validateConfigKeyHash(request: Request, storedConfigKey?: string | null): boolean {
    const provided =
      firstHeader(request, "x-safeexambrowser-configkeyhash") ||
      firstHeader(request, "x-seb-config-key-hash") ||
      firstHeader(request, "x-config-key-hash");
    const url = `${request.protocol}://${request.get("host") || request.hostname}${request.originalUrl || request.url}`;
    return this.validateConfigKeyHashForUrl(provided, url, storedConfigKey);
  }
}

export function canonicalizeSebPlist(value: unknown): string {
  const pruned = pruneForConfigKey(value);
  return stableJson(pruned);
}

function pruneForConfigKey(value: unknown, keyName?: string): unknown {
  if (keyName === "originatorVersion") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => pruneForConfigKey(entry)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, pruneForConfigKey(child, key)] as const)
      .filter(([, child]) => child !== undefined)
      .filter(
        ([, child]) => !(child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0)
      );
    return Object.fromEntries(entries);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stripFragment(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

function stripQueryAndFragment(url: string): string {
  try {
    const parsed = new URL(stripFragment(url));
    parsed.search = "";
    return parsed.toString();
  } catch {
    const withoutFragment = stripFragment(url);
    const queryIndex = withoutFragment.indexOf("?");
    return queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left.toLowerCase());
  const rightBuffer = Buffer.from(right.toLowerCase());
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function firstHeader(request: Request, name: string): string | undefined {
  const value = request.header(name);
  return Array.isArray(value) ? value[0] : value;
}
