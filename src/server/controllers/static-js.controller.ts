import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Controller, Get, Header, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppConfig } from "../config/app-config.js";
import { requestBaseUrl } from "../http/request-url.js";

@Controller()
export class StaticJsController {
  constructor(private readonly config?: AppConfig) {}

  @Get(["/js/canvas-seb-detector.js", "/api/seb/canvas-detector.js"])
  @Header("content-type", "application/javascript; charset=utf-8")
  async canvasDetector(@Req() request: Request, @Res({ passthrough: true }) response?: Response): Promise<string> {
    const debugEnabled = this.config?.value.security.debugEnabled ?? true;
    setDetectorCacheHeaders(response, debugEnabled);

    const script = await readFirstAvailable(detectorAssetCandidates(debugEnabled));
    const baseUrl = this.config?.getApplicationBaseUrl() || requestBaseUrl(request);
    return script
      .replaceAll('"__SEB_BASE_URL__"', JSON.stringify(baseUrl))
      .replaceAll("'__SEB_BASE_URL__'", JSON.stringify(baseUrl))
      .replaceAll('"__SEB_DEBUG_ENABLED__"', JSON.stringify(debugEnabled))
      .replaceAll("'__SEB_DEBUG_ENABLED__'", JSON.stringify(debugEnabled))
      .replaceAll("'${SEB_BASE_URL}'", JSON.stringify(baseUrl))
      .replaceAll("${SEB_API_KEY}", "");
  }

  @Get("/js/health")
  health(): Record<string, string> {
    return { status: "UP" };
  }
}

export function detectorAssetCandidates(
  debugEnabled: boolean,
  nodeEnv = process.env.NODE_ENV,
  cwd = process.cwd()
): string[] {
  const assetName = debugEnabled ? "canvas-seb-detector.js" : "canvas-seb-detector.min.js";
  const assetPath = join(cwd, "dist/server/server/assets", assetName);
  const fallbackAssetPath = join(cwd, "dist/server/server/assets/canvas-seb-detector.js");
  const devPath = join(cwd, "src/server/assets/canvas-seb-detector.js");

  if (nodeEnv === "production") {
    return [assetPath, fallbackAssetPath, devPath];
  }

  return [devPath, assetPath, fallbackAssetPath];
}

async function readFirstAvailable(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      return await readFile(path, "utf8");
    } catch {
      // Try the next path. Built and dev layouts differ.
    }
  }
  throw new Error("Canvas detector script not found");
}

function setDetectorCacheHeaders(response: Response | undefined, debugEnabled: boolean): void {
  if (!response) {
    return;
  }

  if (debugEnabled) {
    response.setHeader("cache-control", "no-cache, no-store, must-revalidate");
    response.setHeader("pragma", "no-cache");
    response.setHeader("expires", "0");
    return;
  }

  response.setHeader("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
  response.setHeader("vary", "X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-Port");
  response.setHeader("expires", new Date(Date.now() + 3600 * 1000).toUTCString());
}
