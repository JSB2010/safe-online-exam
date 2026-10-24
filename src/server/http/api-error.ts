import { diagnostics } from "../diagnostics/runtime.js";
import { HttpException } from "@nestjs/common";

const noUserSessionMessage = "User not authenticated. Please refresh the page or re-launch from Canvas.";

export function apiError(statusCode: number, message: string, extra: Record<string, unknown> = {}): never {
  diagnostics.record("api.rejected", {
    outcome: "failed",
    status: statusCode,
    reasonCode:
      typeof extra.error_code === "string" && /^[A-Z0-9_]{1,100}$/.test(extra.error_code)
        ? extra.error_code
        : "HTTP_" + statusCode
  });
  throw new HttpException(
    {
      success: false,
      statusCode,
      message,
      ...extra
    },
    statusCode
  );
}

export function noUserSession(statusCode = 401): never {
  return apiError(statusCode, noUserSessionMessage, { error_code: "NO_USER_SESSION" });
}
