import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Controller, Get, Header, Req } from "@nestjs/common";
import type { Request } from "express";
import { AppConfig } from "../config/app-config.js";
import { requestBaseUrl } from "../http/request-url.js";

@Controller()
export class StaticJsController {
  constructor(private readonly config?: AppConfig) {}

  @Get(["/js/canvas-seb-detector.js", "/api/seb/canvas-detector.js"])
  @Header("content-type", "application/javascript; charset=utf-8")
  @Header("cache-control", "no-cache, no-store, must-revalidate")
  @Header("pragma", "no-cache")
  @Header("expires", "0")
  async canvasDetector(@Req() request: Request): Promise<string> {
    const assetPath = join(process.cwd(), "dist/server/server/assets/canvas-seb-detector.js");
    const devPath = join(process.cwd(), "src/server/assets/canvas-seb-detector.js");
    const paths = process.env.NODE_ENV === "production" ? [assetPath, devPath] : [devPath, assetPath];
    const script = await readFirstAvailable(paths);
    const baseUrl = this.config?.getApplicationBaseUrl() || requestBaseUrl(request);
    return script.replaceAll("${SEB_BASE_URL}", baseUrl).replaceAll("${SEB_API_KEY}", "");
  }

  @Get("/js/health")
  health(): Record<string, string> {
    return { status: "UP" };
  }
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
