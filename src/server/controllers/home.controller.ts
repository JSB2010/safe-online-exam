import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Controller, Get, Header, Res, ServiceUnavailableException } from "@nestjs/common";
import type { Response } from "express";
import { AppConfig } from "../config/app-config.js";
import { RepositoryProvider } from "../data/repositories.js";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";

@Controller()
export class HomeController {
  constructor(
    private readonly config: AppConfig,
    private readonly repositories: RepositoryProvider
  ) {}

  @Get("/")
  @Header("content-type", "text/html; charset=utf-8")
  home(): string {
    return renderAppShell({
      title: "Safe Online Exam",
      view: "service-status"
    });
  }

  @Get("/login")
  @Header("content-type", "text/html; charset=utf-8")
  login(): string {
    return renderFallbackHtml(
      "Launch from Canvas",
      "<h1>Launch from Canvas</h1><p>This tool is available through Canvas. Open the course in Canvas and launch Safe Online Exam from the configured LTI link.</p>"
    );
  }

  @Get("/setup")
  @Header("content-type", "text/html; charset=utf-8")
  setup(): string {
    return this.renderSetup(false);
  }

  @Get("/setup/guide")
  @Header("content-type", "text/html; charset=utf-8")
  setupGuide(): string {
    return this.renderSetup(true);
  }

  private renderSetup(detailed: boolean): string {
    const toolUrl = this.config.getRequiredToolUrl();
    return renderAppShell({
      title: "Safe Online Exam setup",
      view: "admin-setup",
      initialData: {
        toolUrl,
        healthUrl: `${toolUrl}/health`,
        ltiConfigUrl: `${toolUrl}/lti/config`,
        jwksUrl: `${toolUrl}/.well-known/jwks.json`,
        detectorUrl: `${toolUrl}/js/canvas-seb-detector.js`,
        detailed
      }
    });
  }

  @Get("/health")
  health(): Record<string, string> {
    return { status: "UP" };
  }

  @Get("/favicon.ico")
  async favicon(@Res() response: Response): Promise<void> {
    response.type("image/x-icon").send(await faviconBytes());
  }

  @Get("/ready")
  async ready(): Promise<Record<string, string>> {
    try {
      await this.repositories.assertReady();
      return { status: "UP" };
    } catch {
      throw new ServiceUnavailableException({ status: "DOWN" });
    }
  }

  @Get("/login/health")
  loginHealth(): Record<string, string> {
    return { status: "UP" };
  }
}

async function faviconBytes(): Promise<Buffer> {
  for (const path of [join(process.cwd(), "dist/client/favicon.ico"), join(process.cwd(), "public/favicon.ico")]) {
    try {
      return await readFile(path);
    } catch {
      // The source file is available during development; the built asset is
      // available in the production image.
    }
  }
  throw new Error("Safe Online Exam favicon is unavailable");
}
