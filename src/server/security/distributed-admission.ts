import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { RepositoryProvider } from "../data/repositories.js";

@Injectable()
export class DistributedAdmissionService {
  constructor(private readonly repositories: RepositoryProvider) {}

  async consume(scope: string, identity: string, limit: number, windowMs = 60_000): Promise<boolean> {
    if (!isSafeScope(scope) || !identity || limit < 1 || windowMs < 1_000) {
      return false;
    }
    const digest = createHash("sha256").update(`distributed-admission-v1\0${scope}\0${identity}`, "utf8").digest("hex");
    return this.repositories.value.transientStates.consumeBudget(`admission:${digest}`, limit, windowMs);
  }

  async consumeRequestIp(request: Request, scope: string, limit: number, windowMs = 60_000): Promise<boolean> {
    return this.consume(scope, normalizedRequestIp(request), limit, windowMs);
  }

  async consumeLtiValidationIp(request: Request): Promise<boolean> {
    return this.consumeRequestIp(request, "lti-token-validation-ip", 1_200, 60_000);
  }

  async consumeLtiLoginIp(request: Request): Promise<boolean> {
    return this.consumeRequestIp(request, "lti-login-ip", 1_200, 60_000);
  }

  async consumeLtiStateValidationAttempt(state: string): Promise<boolean> {
    return this.consume("lti-token-validation-state", state, 5, 600_000);
  }
}

export function hasBoundedLtiValidationEnvelope(state: unknown, idToken: unknown): state is string {
  return (
    typeof state === "string" &&
    state.length > 0 &&
    state.length <= 4_096 &&
    typeof idToken === "string" &&
    idToken.length > 0 &&
    idToken.length <= 32_768
  );
}

function normalizedRequestIp(request: Request): string {
  const value = request.ip || request.socket?.remoteAddress || "unknown";
  return String(value).trim().toLowerCase().slice(0, 128) || "unknown";
}

function isSafeScope(scope: string): boolean {
  return /^[a-z0-9:_-]{1,80}$/u.test(scope);
}
