import { Controller, Get, Header, HttpCode, ServiceUnavailableException } from "@nestjs/common";
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
      title: "Canvas SEB LTI",
      view: "service-status"
    });
  }

  @Get("/login")
  @Header("content-type", "text/html; charset=utf-8")
  login(): string {
    return renderFallbackHtml(
      "Launch from Canvas",
      "<h1>Launch from Canvas</h1><p>This tool is available through Canvas. Open the course in Canvas and launch Safe Exam Browser from the configured LTI link.</p>"
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
      title: "Canvas SEB setup",
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
  @HttpCode(204)
  favicon(): void {}

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
