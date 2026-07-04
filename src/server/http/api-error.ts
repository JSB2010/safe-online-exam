import { HttpException } from "@nestjs/common";

const noUserSessionMessage = "User not authenticated. Please refresh the page or re-launch from Canvas.";

export function apiError(statusCode: number, message: string, extra: Record<string, unknown> = {}): never {
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
