import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { AppConfig } from "../../src/server/config/app-config.js";
import {
  detectorAssetCandidates,
  renderCanvasThemeLoader,
  StaticJsController
} from "../../src/server/controllers/static-js.controller.js";

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
    expect(script).not.toContain("__LTI_CLIENT_ID__");
    expect(script).not.toContain("__LTI_DEPLOYMENT_ID_CHECKING_ENABLED__");
    expect(script).not.toContain("__LTI_DEPLOYMENT_IDS__");
    expect(script).not.toContain("https://canvas-seb-dev.run.app:80");
  });

  it("injects the Canvas LTI installation identity used when course navigation is hidden", async () => {
    const controller = new StaticJsController({
      value: {
        security: { debugEnabled: false, detectorDiagnosticsEnabled: false },
        lti: {
          clientId: '10000000000001";globalThis.injected=true;//',
          deploymentId: "deployment-one,\ndeployment-two",
          deploymentIdCheckingEnabled: false
        }
      },
      getApplicationBaseUrl() {
        return "https://configured.example.com";
      }
    } as AppConfig);

    const script = await controller.canvasDetector(createRequest());

    expect(script).toContain('const LTI_CLIENT_ID = "10000000000001\\";globalThis.injected=true;//";');
    expect(script).toContain('const LTI_DEPLOYMENT_IDS = ["deployment-one","deployment-two"];');
    expect(script).toContain("const LTI_DEPLOYMENT_ID_CHECKING_ENABLED = false;");
    expect(script).not.toContain('const LTI_CLIENT_ID = "10000000000001";globalThis');
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
    expect(script).toContain("/api/seb/access-code/");
    expect(script).toContain("method: 'POST'");
    expect(script).toContain("cache: 'no-store'");
    expect(script).toContain("'X-SEB-Proof-Token': proofToken");
    expect(script).toContain("const tools = Array.isArray(data.tools) ? data.tools.filter(isUsableExamTool) : [];");
    expect(script).toContain("state.authorizedExamTools.get(");
    expect(script).toContain("state.authorizedExamTools.set(");
    expect(script).not.toContain("/api/seb/tools/");
    expect(script).toContain("seb-exam-tools-sidebar");
    expect(script).toContain("makeExamToolsDraggable");
    expect(script).toContain("makeExamToolsDraggable(sidebar, header, storageKey)");
    expect(script).toContain("target.closest('button')");
    expect(script).toContain("clampExamToolsPosition");
    expect(script).toContain("placeExamToolsAutomatically");
    expect(script).toContain("snapExamToolsToNearbyEdge");
    expect(script).toContain("user-select: none");
    expect(script).toContain("border-color: #0b63ce");
    expect(script).toContain("background: #eff8ff");
    expect(script).not.toContain("border-color: #0f766e");
    expect(script).not.toContain("@media (max-width: 640px)");
    expect(script).toContain("aria-expanded");
    expect(script).toContain("examToolWindows: new Map()");
    expect(script).toContain("focusExamToolWindow(existingWindow)");
    expect(script).toContain("focusNewExamToolWindow(tool, windowName, openedWindow, launchVersion)");
    expect(script).toContain("isGoogleSheetsToolUrl(tool.url)");
    expect(script).toContain("window.open(tool.url, windowName)");
    expect(script).toContain("openedWindow.opener = null");
    expect(script).not.toContain("window.open('about:blank', windowName)");
    expect(script).not.toContain("openedWindow.location.replace(tool.url)");
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

  it("requires revalidation of the stable detector URL when app debug mode is disabled", async () => {
    const controller = new StaticJsController(createConfig(false));
    const response = createResponse();
    response.setHeader("vary", "Origin");

    const script = await controller.canvasDetector(createRequest(), response as any);

    expect(response.headers.get("cache-control")).toBe("no-cache, must-revalidate");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("vary")).toBe("Origin, X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-Port");
    expect(response.headers.get("vary")?.match(/Origin/gu)).toHaveLength(1);
    expect(script).toContain("const SERVER_DEBUG_ENABLED = false;");
    expect(script).not.toContain("__SEB_DEBUG_ENABLED__");
  });

  it("prefers the minified detector asset in production when debug mode is disabled", () => {
    const [firstCandidate] = detectorAssetCandidates(false, "production", "/repo");

    expect(firstCandidate).toBe("/repo/dist/server/server/assets/canvas-seb-detector.min.js");
  });

  it("serves a hosted theme loader that downloads the detector only for required Canvas assessments", () => {
    const script = renderCanvasThemeLoader("https://seb.example.edu");

    expect(script).toContain('const detectorUrl = "https://seb.example.edu/js/canvas-seb-detector.js";');
    expect(script).toContain("classicQuizPath");
    expect(script).toContain("assignmentPath");
    expect(script).toContain("newQuizAuthoringPath");
    expect(script).toContain("build|settings|moderate|reports|exports");
    expect(script).toContain('const requirementBaseUrl = "https://seb.example.edu/api/seb/requirement";');
    expect(script).toContain('"newquiz:" + courseId + ":" + assignmentMatch[2]');
    expect(script).toContain('credentials: "omit"');
    expect(script).toContain("result.sebRequired !== true");
    expect(script).toContain('script.dataset.canvasSebDetector = "true";');
  });

  it("uses the configured canonical URL for the hosted theme loader", () => {
    const controller = new StaticJsController(createConfig(false));
    const response = createResponse();

    const script = controller.canvasThemeLoader(createRequest(), response as any);

    expect(script).toContain('const detectorUrl = "https://configured.example.com/js/canvas-seb-detector.js";');
    expect(response.headers.get("cache-control")).toBe("no-cache, must-revalidate");
  });

  it("does not fetch the full detector for an ordinary Canvas assignment", async () => {
    const appended: Array<{ src?: string }> = [];
    const fetch = async () => ({ ok: true, json: async () => ({ success: true, sebRequired: false }) });
    runInNewContext(renderCanvasThemeLoader("https://seb.example.edu"), {
      window: { location: { pathname: "/courses/11825/assignments/437577" } },
      document: {
        querySelector: () => null,
        createElement: () => ({}),
        head: { appendChild: (node: { src?: string }) => appended.push(node) }
      },
      fetch
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appended).toEqual([]);
  });

  it("loads the full detector after an authoritative New Quiz requirement response", async () => {
    const appended: Array<{ src?: string; dataset?: Record<string, string> }> = [];
    let requestedUrl = "";
    const fetch = async (url: string) => {
      requestedUrl = url;
      return { ok: true, json: async () => ({ success: true, sebRequired: true }) };
    };
    runInNewContext(renderCanvasThemeLoader("https://seb.example.edu"), {
      window: { location: { pathname: "/courses/11825/assignments/437577" } },
      document: {
        querySelector: () => null,
        createElement: () => ({ dataset: {} }),
        head: { appendChild: (node: { src?: string; dataset?: Record<string, string> }) => appended.push(node) }
      },
      fetch
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestedUrl).toBe("https://seb.example.edu/api/seb/requirement/11825/newquiz%3A11825%3A437577");
    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toBe("https://seb.example.edu/js/canvas-seb-detector.js");
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

function createResponse(): {
  headers: Map<string, string>;
  setHeader(name: string, value: string): void;
  vary(value: string): void;
} {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    vary(value: string) {
      const fields = `${headers.get("vary") || ""},${value}`
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
      const seen = new Set<string>();
      headers.set(
        "vary",
        fields
          .filter((field) => {
            const normalized = field.toLowerCase();
            if (seen.has(normalized)) {
              return false;
            }
            seen.add(normalized);
            return true;
          })
          .join(", ")
      );
    }
  };
}
