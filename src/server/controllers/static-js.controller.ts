import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Controller, Get, Header, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppConfig } from "../config/app-config.js";
import { requestBaseUrl } from "../http/request-url.js";
import { readDetectorSource } from "../services/detector-source.js";

@Controller()
export class StaticJsController {
  private readonly productionDetectorAssets = new Map<string, Promise<string>>();
  private readonly productionDetectorResponses = new Map<string, Promise<string>>();

  constructor(private readonly config?: AppConfig) {}

  @Get(["/js/canvas-seb-detector.js", "/api/seb/canvas-detector.js"])
  @Header("content-type", "application/javascript; charset=utf-8")
  async canvasDetector(@Req() request: Request, @Res({ passthrough: true }) response?: Response): Promise<string> {
    const debugEnabled = this.config?.value.security.debugEnabled ?? true;
    const diagnosticsEnabled = this.config?.value.security.detectorDiagnosticsEnabled ?? false;
    setDetectorCacheHeaders(response, debugEnabled || diagnosticsEnabled);

    const configuredBaseUrl = this.config?.getApplicationBaseUrl();
    const baseUrl = configuredBaseUrl || requestBaseUrl(request);
    const ltiClientId = this.config?.value.lti?.clientId || "";
    const ltiDeploymentIdCheckingEnabled = this.config?.value.lti?.deploymentIdCheckingEnabled ?? true;
    const ltiDeploymentIds = (this.config?.value.lti?.deploymentId || "")
      .split(/[,\n]/u)
      .map((deploymentId) => deploymentId.trim())
      .filter(Boolean);
    return this.readDetectorResponse(
      debugEnabled,
      diagnosticsEnabled,
      baseUrl,
      ltiClientId,
      ltiDeploymentIdCheckingEnabled,
      ltiDeploymentIds,
      process.env.NODE_ENV === "production" && !!configuredBaseUrl
    );
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

  private readDetectorAsset(debugEnabled: boolean): Promise<string> {
    const candidates = detectorAssetCandidates(debugEnabled);
    if (process.env.NODE_ENV !== "production") {
      return readFirstAvailable(candidates);
    }

    const cacheKey = candidates.join("\n");
    const cached = this.productionDetectorAssets.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = readFirstAvailable(candidates);
    this.productionDetectorAssets.set(cacheKey, pending);
    void pending.catch(() => {
      if (this.productionDetectorAssets.get(cacheKey) === pending) {
        this.productionDetectorAssets.delete(cacheKey);
      }
    });
    return pending;
  }

  private readDetectorResponse(
    debugEnabled: boolean,
    diagnosticsEnabled: boolean,
    baseUrl: string,
    ltiClientId: string,
    ltiDeploymentIdCheckingEnabled: boolean,
    ltiDeploymentIds: string[],
    cacheable: boolean
  ): Promise<string> {
    const render = () =>
      this.readDetectorAsset(debugEnabled || diagnosticsEnabled).then((source) =>
        configureDetectorSource(
          source,
          baseUrl,
          ltiClientId,
          ltiDeploymentIdCheckingEnabled,
          ltiDeploymentIds,
          debugEnabled,
          diagnosticsEnabled
        )
      );
    if (!cacheable) {
      return render();
    }

    const cacheKey = `${baseUrl}\n${ltiClientId}\n${String(ltiDeploymentIdCheckingEnabled)}\n${JSON.stringify(ltiDeploymentIds)}\n${String(debugEnabled)}\n${String(diagnosticsEnabled)}`;
    const cached = this.productionDetectorResponses.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = render();
    this.productionDetectorResponses.set(cacheKey, pending);
    void pending.catch(() => {
      if (this.productionDetectorResponses.get(cacheKey) === pending) {
        this.productionDetectorResponses.delete(cacheKey);
      }
    });
    return pending;
  }
}

function configureDetectorSource(
  source: string,
  baseUrl: string,
  ltiClientId: string,
  ltiDeploymentIdCheckingEnabled: boolean,
  ltiDeploymentIds: string[],
  debugEnabled: boolean,
  diagnosticsEnabled: boolean
): string {
  return source
    .replaceAll('"__SEB_BASE_URL__"', JSON.stringify(baseUrl))
    .replaceAll("'__SEB_BASE_URL__'", JSON.stringify(baseUrl))
    .replaceAll('"__LTI_CLIENT_ID__"', JSON.stringify(ltiClientId))
    .replaceAll("'__LTI_CLIENT_ID__'", JSON.stringify(ltiClientId))
    .replaceAll('"__LTI_DEPLOYMENT_ID_CHECKING_ENABLED__"', JSON.stringify(ltiDeploymentIdCheckingEnabled))
    .replaceAll("'__LTI_DEPLOYMENT_ID_CHECKING_ENABLED__'", JSON.stringify(ltiDeploymentIdCheckingEnabled))
    .replaceAll('"__LTI_DEPLOYMENT_IDS__"', JSON.stringify(ltiDeploymentIds))
    .replaceAll("'__LTI_DEPLOYMENT_IDS__'", JSON.stringify(ltiDeploymentIds))
    .replaceAll('"__SEB_DEBUG_ENABLED__"', JSON.stringify(debugEnabled))
    .replaceAll("'__SEB_DEBUG_ENABLED__'", JSON.stringify(debugEnabled))
    .replaceAll('"__SEB_DIAGNOSTIC_MODE__"', JSON.stringify(diagnosticsEnabled))
    .replaceAll("'__SEB_DIAGNOSTIC_MODE__'", JSON.stringify(diagnosticsEnabled))
    .replaceAll("'${SEB_BASE_URL}'", JSON.stringify(baseUrl))
    .replaceAll("${SEB_API_KEY}", "");
}

export function renderCanvasThemeLoader(baseUrl: string): string {
  const detectorUrl = `${baseUrl}/js/canvas-seb-detector.js`;
  const requirementBaseUrl = `${baseUrl}/api/seb/requirement`;
  return `(function () {
  "use strict";

  const detectorUrl = ${JSON.stringify(detectorUrl)};
  const requirementBaseUrl = ${JSON.stringify(requirementBaseUrl)};
  const classicQuizPath = /^\\/courses\\/(\\d+)\\/quizzes\\/(\\d+)\\/take(?:\\/|$)/;
  const assignmentPath = /^\\/courses\\/(\\d+)\\/assignments\\/(\\d+)(?:\\/|$)/;
  const newQuizAuthoringPath = /^\\/courses\\/\\d+\\/assignments\\/\\d+\\/(?:build|settings|moderate|reports|exports)(?:\\/|$)/;

  const classicMatch = window.location.pathname.match(classicQuizPath);
  const assignmentMatch = window.location.pathname.match(assignmentPath);
  if ((!classicMatch && !assignmentMatch) || newQuizAuthoringPath.test(window.location.pathname)) {
    return;
  }
  if (document.querySelector('script[data-canvas-seb-detector="true"]')) {
    return;
  }

  const courseId = (classicMatch || assignmentMatch)[1];
  const contentId = classicMatch ? classicMatch[2] : "newquiz:" + courseId + ":" + assignmentMatch[2];
  const requirementUrl = requirementBaseUrl + "/" + encodeURIComponent(courseId) + "/" + encodeURIComponent(contentId);

  fetch(requirementUrl, { method: "GET", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (result) {
      if (!result || result.success !== true || result.sebRequired !== true) return;
      if (document.querySelector('script[data-canvas-seb-detector="true"]')) return;
      const script = document.createElement("script");
      script.src = detectorUrl;
      script.async = true;
      script.dataset.canvasSebDetector = "true";
      document.head.appendChild(script);
    })
    .catch(function () { /* Unavailable or malformed requirement checks fail closed without loading. */ });
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
  const devPath = join(cwd, "src/server/assets/detector");

  if (nodeEnv === "production") {
    return [assetPath, fallbackAssetPath, devPath];
  }

  return [devPath, assetPath, fallbackAssetPath];
}

async function readFirstAvailable(paths: string[]): Promise<string> {
  for (const path of paths) {
    try {
      return basename(path) === "detector" ? await readDetectorSource(path) : await readFile(path, "utf8");
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
