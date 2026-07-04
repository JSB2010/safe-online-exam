import { describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import type { AppConfig } from "../../src/server/config/app-config.js";
import { apiError, noUserSession } from "../../src/server/http/api-error.js";
import { renderAppShell, renderFallbackHtml } from "../../src/server/http/app-shell.js";
import { isAllowedCorsOrigin } from "../../src/server/http/cors.js";
import { absoluteUrl, requestBaseUrl, sebSchemeUrl } from "../../src/server/http/request-url.js";

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
    expect(appShell).toContain('<script type="module" src="/assets/index.js"></script>');
    expect(appShell).toContain('<link rel="stylesheet" href="/assets/index.css">');
    expect(appShell).not.toContain("crossorigin");
    expect(renderFallbackHtml("A < B", "<p>Body</p>")).toContain("A &lt; B");
  });

  it("allows Canvas, configured tool, and dev localhost CORS origins", () => {
    const config = {
      profile: "dev",
      toolUrl: "https://canvas-seb-dev.run.app",
      getCanvasDomain: () => "https://kentdenver.instructure.com"
    } as AppConfig;

    expect(isAllowedCorsOrigin(undefined, config)).toBe(true);
    expect(isAllowedCorsOrigin("https://kentdenver.instructure.com", config)).toBe(true);
    expect(isAllowedCorsOrigin("https://school.instructure.com", config)).toBe(true);
    expect(isAllowedCorsOrigin("https://canvas-seb-dev.run.app", config)).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:8080", config)).toBe(true);
    expect(isAllowedCorsOrigin("https://example.com", config)).toBe(false);
  });

  it("blocks localhost CORS origins in production unless configured as the tool URL", () => {
    const config = {
      profile: "prod",
      toolUrl: "https://canvas-seb-prod.run.app",
      getCanvasDomain: () => "https://kentdenver.instructure.com"
    } as AppConfig;

    expect(isAllowedCorsOrigin("http://localhost:8080", config)).toBe(false);
    expect(isAllowedCorsOrigin("https://canvas-seb-prod.run.app", config)).toBe(true);
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
