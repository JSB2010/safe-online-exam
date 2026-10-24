import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { diagnostics } from "./runtime.js";
@Catch()
export class DiagnosticsExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (!diagnostics.settings.enabled || exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }
    diagnostics.failure("request.exception", exception, { reasonCode: "UNHANDLED_EXCEPTION" });
    const response = host.switchToHttp().getResponse();
    if (!this.applicationRef!.isHeadersSent(response))
      this.applicationRef!.reply(response, { statusCode: 500, message: "Internal server error" }, 500);
    else this.applicationRef!.end(response);
  }
}
