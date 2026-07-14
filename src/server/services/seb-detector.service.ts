import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { SebConfigKeyService } from "./seb-config-key.service.js";

type SebProofSetting = {
  configKey?: string | null;
};

@Injectable()
export class SebDetector {
  constructor(private readonly configKey: SebConfigKeyService = new SebConfigKeyService()) {}

  isRequestFromSeb(request: Request, setting?: SebProofSetting | null): boolean {
    if (setting) {
      return this.configKey.validateConfigKeyHash(request, setting.configKey);
    }

    const userAgent = request.header("user-agent") || "";
    const sebHeader = firstHeader(request, [
      "x-safeexambrowser-requesthash",
      "x-safeexambrowser-configkeyhash",
      "x-seb-config-key-hash",
      "x-safeexambrowser-browserexamkey",
      "x-seb-browser-exam-key"
    ]);
    const uaLooksLikeSeb =
      /SafeExamBrowser|SEB\/|SEB;/iu.test(userAgent) || (/AppleWebKit/iu.test(userAgent) && /SEB/iu.test(userAgent));
    return uaLooksLikeSeb || !!sebHeader;
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
