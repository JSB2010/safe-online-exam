import { describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import type { AppConfig } from "../../src/server/config/app-config.js";
import { apiError, noUserSession } from "../../src/server/http/api-error.js";
import { renderAppShell, renderFallbackHtml } from "../../src/server/http/app-shell.js";
import { corsOptionsForRequest, isAllowedCorsOrigin, isBrowserDocumentNavigation } from "../../src/server/http/cors.js";
import { absoluteUrl, requestBaseUrl, sebSchemeUrl } from "../../src/server/http/request-url.js";
import { securityHeaders } from "../../src/server/http/security-headers.js";
import { parseClientEntryModulePreloads, setClientAssetCacheHeaders } from "../../src/server/http/static-assets.js";

describe("HTTP helpers", () => {
  it("builds forwarded Cloud Run base URLs without default ports", () => {
    const request = {
      header(name: string) {
        return {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "canvas-seb-dev.run.app",
          "x-forwarded-port": "443"
        }[name.toLowerCase()];
      },
      protocol: "http",
      hostname: "localhost",
      socket: { localPort: 8080 }
    } as any;

    expect(requestBaseUrl(request)).toBe("https://canvas-seb-dev.run.app");
    expect(absoluteUrl(request, "/seb/exit")).toBe("https://canvas-seb-dev.run.app/seb/exit");
    expect(sebSchemeUrl(request, "/seb/config/course-1/quiz-1.seb")).toBe(
      "sebs://canvas-seb-dev.run.app/seb/config/course-1/quiz-1.seb"
    );
  });

  it("escapes app shell bootstrap and fallback HTML", () => {
    const appShell = renderAppShell({ title: "A < B", view: "test", initialData: { value: "<script>" } });

    expect(appShell).toContain("\\u003cscript>");
    expect(appShell).toContain('<script id="seb-bootstrap" type="application/json">');
    expect(appShell).not.toContain("window.__SEB_BOOTSTRAP__");
    expect(appShell).toContain('<script type="module" src="/assets/index.js"></script>');
    expect(appShell).toContain('<link rel="stylesheet" href="/assets/index.css">');
    expect(appShell).toContain('<link rel="icon" type="image/x-icon" href="/favicon.ico" />');
    expect(appShell).toContain(
      '<link rel="icon" type="image/png" sizes="192x192" href="/assets/safe-online-exam-icon.png" />'
    );
    expect(appShell).toContain('aria-label="Loading Safe Online Exam"');
    expect(appShell).toContain('class="seb-app-loading__row"');
    expect(appShell).not.toContain("crossorigin");
    expect(renderFallbackHtml("A < B", "<p>Body</p>")).toContain("A &lt; B");
  });

  it("allows framing only from the exact Canvas origin and emits strict browser headers", () => {
    const config = {
      profile: "prod",
      toolUrl: "https://tool.example.edu",
      getCanvasDomain: () => "https://school.instructure.com"
    } as AppConfig;
    const headers = securityHeaders(config);

    expect(headers["content-security-policy"]).toContain("frame-ancestors 'self' https://school.instructure.com");
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["content-security-policy"]).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["cache-control"]).toBe("no-store");
  });

  it("versions app shell assets by Cloud Run revision when available", () => {
    const previousRevision = process.env.K_REVISION;
    try {
      process.env.K_REVISION = "canvas-seb-dev-00307-lsm";

      const appShell = renderAppShell({ title: "SEB", view: "test" });

      expect(appShell).toContain('<script type="module" src="/assets/index.js?v=canvas-seb-dev-00307-lsm"></script>');
      expect(appShell).toContain('<link rel="stylesheet" href="/assets/index.css?v=canvas-seb-dev-00307-lsm">');
    } finally {
      if (previousRevision === undefined) {
        delete process.env.K_REVISION;
      } else {
        process.env.K_REVISION = previousRevision;
      }
    }
  });

  it("allows immutable caching only for content-addressed client chunks", () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      }
    } as any;

    setClientAssetCacheHeaders(response, "/dist/client/assets/dashboard-BvyaXW_g.js");
    expect(headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    setClientAssetCacheHeaders(response, "/dist/client/assets/index.js");
    expect(headers.get("cache-control")).toBe("no-cache");

    setClientAssetCacheHeaders(response, "/dist/client/assets/index.css");
    expect(headers.get("cache-control")).toBe("no-cache");
  });

  it("reads only safe static imports from the Vite client entry manifest", () => {
    expect(
      parseClientEntryModulePreloads(
        JSON.stringify({
          "index.html": {
            file: "assets/index.js",
            isEntry: true,
            imports: ["_runtime.js", "_vendor.js", "_unsafe.js", 42]
          },
          "_runtime.js": { file: "assets/rolldown-runtime-abcdefgh.js" },
          "_vendor.js": { file: "assets/react-vendor-12345678.js" },
          "_unsafe.js": { file: "../outside.js" }
        })
      )
    ).toEqual(["/assets/rolldown-runtime-abcdefgh.js", "/assets/react-vendor-12345678.js"]);
    expect(parseClientEntryModulePreloads("[]")).toEqual([]);
  });

  it("allows only the exact configured Canvas and tool CORS origins", () => {
    const config = {
      profile: "dev",
      toolUrl: "https://canvas-seb-dev.run.app",
      getCanvasDomain: () => "https://canvas.example.edu"
    } as AppConfig;

    expect(isAllowedCorsOrigin(undefined, config)).toBe(true);
    expect(isAllowedCorsOrigin("https://canvas.example.edu", config)).toBe(true);
    expect(isAllowedCorsOrigin("https://canvas-seb-dev.run.app", config)).toBe(true);
    expect(isAllowedCorsOrigin("https://school.instructure.com", config)).toBe(false);
    expect(isAllowedCorsOrigin("https://canvas.example.edu.attacker.test", config)).toBe(false);
    expect(isAllowedCorsOrigin("https://canvas.example.edu:444", config)).toBe(false);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8080", config)).toBe(false);
    expect(isAllowedCorsOrigin("https://example.com", config)).toBe(false);
    expect(isAllowedCorsOrigin("not a URL", config)).toBe(false);
  });

  it("blocks localhost CORS origins in production unless configured as the tool URL", () => {
    const config = {
      profile: "prod",
      toolUrl: "https://canvas-seb-prod.run.app",
      getCanvasDomain: () => "https://canvas.example.edu"
    } as AppConfig;

    expect(isAllowedCorsOrigin("http://localhost:8080", config)).toBe(false);
    expect(isAllowedCorsOrigin("https://canvas-seb-prod.run.app", config)).toBe(true);
  });

  it("does not apply CORS to top-level browser navigations after OAuth", () => {
    const config = {
      profile: "dev",
      toolUrl: "https://canvas-seb-dev.run.app",
      getCanvasDomain: () => "https://canvas.example.edu"
    } as AppConfig;
    const documentNavigation = {
      method: "GET",
      header(name: string) {
        return {
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          origin: "https://accounts.example.edu"
        }[name.toLowerCase()];
      }
    } as any;

    expect(isBrowserDocumentNavigation(documentNavigation)).toBe(true);
    expect(corsOptionsForRequest(documentNavigation, config)).toEqual({ origin: false });
  });

  it("continues to apply strict CORS to cross-origin fetch requests", () => {
    const config = {
      profile: "dev",
      toolUrl: "https://canvas-seb-dev.run.app",
      getCanvasDomain: () => "https://canvas.example.edu"
    } as AppConfig;
    const crossOriginFetch = {
      method: "GET",
      header(name: string) {
        return {
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          origin: "https://attacker.example"
        }[name.toLowerCase()];
      }
    } as any;

    expect(isBrowserDocumentNavigation(crossOriginFetch)).toBe(false);
    const options = corsOptionsForRequest(crossOriginFetch, config);
    expect(options.origin).toBeTypeOf("function");
    if (typeof options.origin !== "function") {
      throw new Error("Expected a dynamic CORS origin policy");
    }

    let rejectedOriginError: Error | null = null;
    options.origin("https://attacker.example", (error) => {
      rejectedOriginError = error;
    });
    expect(rejectedOriginError).toBeInstanceOf(HttpException);
    expect((rejectedOriginError as HttpException).getStatus()).toBe(403);
  });

  it("throws API errors with legacy-compatible response bodies", () => {
    expect(() => apiError(409, "Conflict")).toThrow(HttpException);
    try {
      noUserSession(403);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(403);
      expect(exception.getResponse()).toMatchObject({
        success: false,
        statusCode: 403,
        error_code: "NO_USER_SESSION"
      });
    }
  });
});
