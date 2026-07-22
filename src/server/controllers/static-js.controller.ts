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
    const diagnosticsEnabled = this.config?.value.security.detectorDiagnosticsEnabled ?? false;
    setDetectorCacheHeaders(response, debugEnabled || diagnosticsEnabled);

    const script = await readFirstAvailable(detectorAssetCandidates(debugEnabled || diagnosticsEnabled));
    const baseUrl = this.config?.getApplicationBaseUrl() || requestBaseUrl(request);
    return script
      .replaceAll('"__SEB_BASE_URL__"', JSON.stringify(baseUrl))
      .replaceAll("'__SEB_BASE_URL__'", JSON.stringify(baseUrl))
      .replaceAll('"__SEB_DEBUG_ENABLED__"', JSON.stringify(debugEnabled))
      .replaceAll("'__SEB_DEBUG_ENABLED__'", JSON.stringify(debugEnabled))
      .replaceAll('"__SEB_DIAGNOSTIC_MODE__"', JSON.stringify(diagnosticsEnabled))
      .replaceAll("'__SEB_DIAGNOSTIC_MODE__'", JSON.stringify(diagnosticsEnabled))
      .replaceAll("'${SEB_BASE_URL}'", JSON.stringify(baseUrl))
      .replaceAll("${SEB_API_KEY}", "");
  }

  /**
   * A Canvas theme-safe loader hosted by the tool rather than by Canvas Files.
   *
   * Some self-hosted Canvas deployments reject a locally stored theme .js file
   * with Rails' InvalidCrossOriginRequest protection. Pointing the theme's
   * js_overrides setting at this endpoint avoids that Canvas attachment route
   * while retaining the normal quiz-page-only detector loading behavior.
   */
  @Get("/js/canvas-seb-theme-loader.js")
  @Header("content-type", "application/javascript; charset=utf-8")
  canvasThemeLoader(@Req() request: Request, @Res({ passthrough: true }) response?: Response): string {
    const debugEnabled = this.config?.value.security.debugEnabled ?? true;
    setDetectorCacheHeaders(response, debugEnabled);

    const baseUrl = this.config?.getApplicationBaseUrl() || requestBaseUrl(request);
    return renderCanvasThemeLoader(baseUrl);
  }

  @Get("/js/health")
  health(): Record<string, string> {
    return { status: "UP" };
  }
}

export function renderCanvasThemeLoader(baseUrl: string): string {
  const detectorUrl = `${baseUrl}/js/canvas-seb-detector.js`;
  return `(function () {
  "use strict";

  const detectorUrl = ${JSON.stringify(detectorUrl)};
  const assessmentPath = /^\\/courses\\/\\d+\\/(?:quizzes\\/\\d+\\/take|assignments\\/\\d+)(?:\\/|$)/;
  const newQuizAuthoringPath = /^\\/courses\\/\\d+\\/assignments\\/\\d+\\/(?:build|settings|moderate|reports|exports)(?:\\/|$)/;

  if (!assessmentPath.test(window.location.pathname) || newQuizAuthoringPath.test(window.location.pathname)) {
    return;
  }
  if (document.querySelector('script[data-canvas-seb-detector="true"]')) {
    return;
  }

  const script = document.createElement("script");
  script.src = detectorUrl;
  script.async = true;
  script.dataset.canvasSebDetector = "true";
  document.head.appendChild(script);
})();
`;
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

  response.setHeader(
    "cache-control",
    debugEnabled ? "no-cache, no-store, must-revalidate" : "no-cache, must-revalidate"
  );
  response.setHeader("pragma", "no-cache");
  response.vary("Origin, X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-Port");
  response.setHeader("expires", "0");
}
