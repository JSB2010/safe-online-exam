import { Controller, Get, Header } from "@nestjs/common";
import { renderAppShell, renderFallbackHtml } from "../http/app-shell.js";

@Controller()
export class HomeController {
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

  @Get("/health")
  health(): Record<string, string> {
    return { status: "UP" };
  }

  @Get("/login/health")
  loginHealth(): Record<string, string> {
    return { status: "UP" };
  }
}
