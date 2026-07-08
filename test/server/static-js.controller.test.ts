import { describe, expect, it } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { detectorAssetCandidates, StaticJsController } from "../../src/server/controllers/static-js.controller.js";

describe("StaticJsController", () => {
  it("injects forwarded Cloud Run base URL without API key placeholders", async () => {
    const controller = new StaticJsController();
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canvas-seb-dev.run.app"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "canvas-seb-dev.run.app",
      socket: { localPort: 8080 }
    } as any;

    const script = await controller.canvasDetector(request);

    expect(script).toContain("https://canvas-seb-dev.run.app");
    expect(script).not.toContain("${SEB_API_KEY}");
    expect(script).not.toContain("https://canvas-seb-dev.run.app:80");
  });

  it("includes a generic progress overlay for the SEB quiz handoff", async () => {
    const controller = new StaticJsController();
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canvas-seb-dev.run.app"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "canvas-seb-dev.run.app",
      socket: { localPort: 8080 }
    } as any;

    const script = await controller.canvasDetector(request);

    expect(script).toContain("Preparing your quiz");
    expect(script).toContain("Entering the access code automatically.");
    expect(script).toContain("Something went wrong");
    expect(script).toContain("Try again");
    expect(script).toContain("showAccessCodeProgressOverlay();");
    expect(script).toContain("hideAccessCodeProgressOverlay(8000);");
  });

  it("guards access-code auto-fill so it does not reopen errors on the quiz-taking page", async () => {
    const controller = new StaticJsController();
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canvas-seb-dev.run.app"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "canvas-seb-dev.run.app",
      socket: { localPort: 8080 }
    } as any;

    const script = await controller.canvasDetector(request);

    expect(script).toContain("function shouldAttemptAccessCodeAutofill()");
    expect(script).toContain("return isAccessCodeChallengePage();");
    expect(script).toContain("attemptAutoFillWithRetry(accessCode, 0, shouldShowAccessCodeErrors)");
    expect(script).toContain("setupAccessCodeObserver(accessCode, shouldShowMissingFieldError)");
    expect(script).toContain("if (!document.hidden && shouldAttemptAccessCodeAutofill())");
    expect(script).toContain("if (!completed && (shouldShowMissingFieldError || shouldAttemptAccessCodeAutofill()))");
  });

  it("includes the draggable external exam tools sidebar", async () => {
    const controller = new StaticJsController();
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canvas-seb-dev.run.app"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "canvas-seb-dev.run.app",
      socket: { localPort: 8080 }
    } as any;

    const script = await controller.canvasDetector(request);

    expect(script).toContain("setupExamToolsSidebar(quizInfo);");
    expect(script).toContain("/api/seb/tools/");
    expect(script).toContain("seb-exam-tools-sidebar");
    expect(script).toContain("makeExamToolsDraggable");
    expect(script).toContain("examToolWindows: new Map()");
    expect(script).toContain("focusExamToolWindow(existingWindow)");
    expect(script).toContain("window.open(tool.url, windowName)");
    expect(script).toContain("openedWindow.opener = null");
    expect(script).not.toContain("window.open(tool.url, '_blank', 'noopener,noreferrer')");
  });

  it("uses the configured app base URL for detector API calls when available", async () => {
    const previousAppBaseUrl = process.env.APP_BASE_URL;
    const previousBaseUrl = process.env.BASE_URL;
    const previousToolUrl = process.env.TOOL_URL;
    process.env.APP_BASE_URL = "https://configured.example.com";
    delete process.env.BASE_URL;
    delete process.env.TOOL_URL;
    const controller = new StaticJsController(new AppConfig());
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "alternate.example.com"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "alternate.example.com",
      socket: { localPort: 8080 }
    } as any;

    try {
      const script = await controller.canvasDetector(request);

      expect(script).toContain('const SEB_DOWNLOAD_BASE_URL = "https://configured.example.com";');
      expect(script).not.toContain('const SEB_DOWNLOAD_BASE_URL = "https://alternate.example.com";');
    } finally {
      if (previousAppBaseUrl === undefined) {
        delete process.env.APP_BASE_URL;
      } else {
        process.env.APP_BASE_URL = previousAppBaseUrl;
      }
      if (previousBaseUrl === undefined) {
        delete process.env.BASE_URL;
      } else {
        process.env.BASE_URL = previousBaseUrl;
      }
      if (previousToolUrl === undefined) {
        delete process.env.TOOL_URL;
      } else {
        process.env.TOOL_URL = previousToolUrl;
      }
    }
  });

  it("injects unusual base URL text as a safe JavaScript string literal", async () => {
    const controller = new StaticJsController();
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": 'canvas-seb-dev.run.app";globalThis.injected=true;//'
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "canvas-seb-dev.run.app",
      socket: { localPort: 8080 }
    } as any;

    const script = await controller.canvasDetector(request);

    expect(script).toContain(
      'const SEB_DOWNLOAD_BASE_URL = "https://canvas-seb-dev.run.app\\";globalThis.injected=true;//";'
    );
    expect(script).not.toContain('const SEB_DOWNLOAD_BASE_URL = "https://canvas-seb-dev.run.app";globalThis');
  });

  it("serves the readable detector without caching when app debug mode is enabled", async () => {
    const controller = new StaticJsController(createConfig(true));
    const response = createResponse();

    const script = await controller.canvasDetector(createRequest(), response as any);

    expect(response.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(script).toContain("const SERVER_DEBUG_ENABLED = true;");
    expect(script).not.toContain("__SEB_DEBUG_ENABLED__");
    expect(script).toContain("/api/debug/canvas-detector-trace");
  });

  it("serves a cacheable detector when app debug mode is disabled", async () => {
    const controller = new StaticJsController(createConfig(false));
    const response = createResponse();

    const script = await controller.canvasDetector(createRequest(), response as any);

    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, stale-while-revalidate=86400");
    expect(response.headers.get("vary")).toBe("X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-Port");
    expect(script).toContain("const SERVER_DEBUG_ENABLED = false;");
    expect(script).not.toContain("__SEB_DEBUG_ENABLED__");
  });

  it("prefers the minified detector asset in production when debug mode is disabled", () => {
    const [firstCandidate] = detectorAssetCandidates(false, "production", "/repo");

    expect(firstCandidate).toBe("/repo/dist/server/server/assets/canvas-seb-detector.min.js");
  });
});

function createRequest(): any {
  return {
    header(name: string) {
      return {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "canvas-seb-dev.run.app"
      }[name.toLowerCase()];
    },
    protocol: "http",
    hostname: "canvas-seb-dev.run.app",
    socket: { localPort: 8080 }
  };
}

function createConfig(debugEnabled: boolean): AppConfig {
  return {
    value: { security: { debugEnabled } },
    getApplicationBaseUrl() {
      return "https://configured.example.com";
    }
  } as AppConfig;
}

function createResponse(): { headers: Map<string, string>; setHeader(name: string, value: string): void } {
  return {
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
    }
  };
}
