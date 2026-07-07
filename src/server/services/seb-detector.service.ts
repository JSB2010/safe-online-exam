import { timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { ContentSebSetting, QuizSebSetting } from "../../shared/models.js";

@Injectable()
export class SebDetector {
  isRequestFromSeb(
    request: Request,
    setting?: Pick<QuizSebSetting | ContentSebSetting, "browserExamKey"> | null
  ): boolean {
    const userAgent = request.header("user-agent") || "";
    const sebHeader = firstHeader(request, [
      "x-safeexambrowser-requesthash",
      "x-safeexambrowser-configkeyhash",
      "x-seb-config-key-hash",
      "x-seb-browser-exam-key"
    ]);
    const configKeyHeader = firstHeader(request, [
      "x-safeexambrowser-requesthash",
      "x-safeexambrowser-configkeyhash",
      "x-seb-config-key-hash"
    ]);
    const uaLooksLikeSeb =
      /SafeExamBrowser|SEB\/|SEB;/iu.test(userAgent) || (/AppleWebKit/iu.test(userAgent) && /SEB/iu.test(userAgent));
    if (!uaLooksLikeSeb && !sebHeader) {
      return false;
    }

    const expectedBek = setting?.browserExamKey;
    const providedBek =
      request.header("x-safeexambrowser-browserexamkey") ||
      request.header("x-seb-browser-exam-key") ||
      request.header("browser-exam-key");
    if (expectedBek && providedBek) {
      return this.validateBrowserExamKey(providedBek, expectedBek) || !!configKeyHeader;
    }

    return true;
  }

  validateBrowserExamKey(provided?: string | null, expected?: string | null): boolean {
    if (!provided || !expected) {
      return false;
    }
    const left = Buffer.from(provided.trim());
    const right = Buffer.from(expected.trim());
    return left.length === right.length && timingSafeEqual(left, right);
  }
}

function firstHeader(request: Request, names: string[]): string | undefined {
  for (const name of names) {
    const value = request.header(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}
