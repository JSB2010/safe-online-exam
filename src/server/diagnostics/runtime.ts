import { requestSpan } from "./tracing.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { DiagnosticEvent, IdentityContext, IdentityEnvelope } from "../../shared/diagnostics/diagnostics.js";
import { DIAGNOSTIC_SCHEMA, UUID, validateEvent } from "../../shared/diagnostics/diagnostics.js";

export interface DiagnosticsSettings {
  enabled: boolean;
  identityEnabled: boolean;
  installationId: string;
  hashKey: string;
  identityKeyId: string;
  identityKeys: Record<string, string>;
  courseIds: string[];
  expiresAt: number;
}
type Context = {
  flowId: string;
  attemptId?: string;
  subjectKey?: string;
  courseId?: string;
  contentId?: string;
  traceId?: string;
  spanId?: string;
  startedAt: number;
};
type Fields = Partial<
  Omit<DiagnosticEvent, "schema" | "schemaVersion" | "eventId" | "installationId" | "occurredAt" | "stage">
>;
export function diagnosticsSettings(env: NodeJS.ProcessEnv): DiagnosticsSettings {
  const enabled = env.DIAGNOSTICS_ENABLED === "true";
  const identityEnabled = enabled && env.DIAGNOSTICS_IDENTITY_ENABLED === "true";
  const result: DiagnosticsSettings = {
    enabled,
    identityEnabled,
    installationId: env.DIAGNOSTICS_INSTALLATION_ID || "",
    hashKey: env.DIAGNOSTICS_HASH_KEY || "",
    identityKeyId: env.DIAGNOSTICS_IDENTITY_ACTIVE_KEY_ID || "",
    identityKeys: {},
    courseIds: (env.DIAGNOSTICS_COURSE_IDS || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    expiresAt: env.DIAGNOSTICS_EXPIRES_AT ? Date.parse(env.DIAGNOSTICS_EXPIRES_AT) : Number.POSITIVE_INFINITY
  };
  if (!enabled) return result;
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(result.installationId) ||
    result.hashKey.length < 32 ||
    Number.isNaN(result.expiresAt)
  )
    throw new Error("Invalid diagnostics configuration");
  if (identityEnabled) {
    try {
      result.identityKeys = JSON.parse(env.DIAGNOSTICS_IDENTITY_KEYRING || "{}");
    } catch {
      throw new Error("Invalid diagnostics identity keyring");
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(result.identityKeyId) || !result.identityKeys[result.identityKeyId])
      throw new Error("Diagnostics identity key is required");
    for (const [id, key] of Object.entries(result.identityKeys))
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        typeof key !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(key) ||
        Buffer.from(key, "base64url").length !== 32
      )
        throw new Error("Invalid diagnostics identity key");
  }
  return result;
}
export class DiagnosticsRuntime {
  readonly context = new AsyncLocalStorage<Context>();
  private budgets = new Map<string, { count: number; at: number }>();
  constructor(
    readonly settings: DiagnosticsSettings,
    private readonly output: (event: DiagnosticEvent) => void = (event) =>
      console.info(
        JSON.stringify({
          ...event,
          "logging.googleapis.com/trace":
            event.traceId && process.env.GOOGLE_CLOUD_PROJECT
              ? "projects/" + process.env.GOOGLE_CLOUD_PROJECT + "/traces/" + event.traceId
              : undefined
        })
      )
  ) {}
  active(courseId?: string) {
    return (
      this.settings.enabled &&
      Date.now() < this.settings.expiresAt &&
      (!this.settings.courseIds.length || !courseId || this.settings.courseIds.includes(courseId))
    );
  }
  current() {
    return this.context.getStore();
  }
  bind(fields: Partial<Context>) {
    const c = this.current();
    if (c) Object.assign(c, fields);
  }
  subject(canvasUserId: string) {
    return this.settings.hashKey
      ? createHmac("sha256", this.settings.hashKey)
          .update("soe-diagnostics-subject-v1\0" + this.settings.installationId + "\0" + canvasUserId)
          .digest("hex")
      : undefined;
  }
  configurationRevision(fingerprint: string) {
    return this.settings.hashKey
      ? createHmac("sha256", this.settings.hashKey)
          .update("soe-diagnostics-configuration-v1\0" + fingerprint)
          .digest("hex")
      : undefined;
  }
  record(stage: string, fields: Fields = {}) {
    try {
      const c = this.current();
      const courseId = fields.courseId || c?.courseId;
      if (!this.active(courseId)) return;
      const event: DiagnosticEvent = {
        schema: DIAGNOSTIC_SCHEMA,
        schemaVersion: 1,
        eventId: randomUUID(),
        installationId: this.settings.installationId,
        occurredAt: new Date().toISOString(),
        flowId: c?.flowId || randomUUID(),
        source: "server",
        outcome: "observed",
        severity: "INFO",
        ...(c
          ? {
              attemptId: c.attemptId,
              subjectKey: c.subjectKey,
              courseId: c.courseId,
              contentId: c.contentId,
              traceId: c.traceId,
              spanId: c.spanId
            }
          : {}),
        revision: process.env.K_REVISION || process.env.SOURCE_COMMIT_SHA,
        ...fields,
        stage
      };
      // Undefined optional properties are removed before strict validation and transport.
      this.output(validateEvent(JSON.parse(JSON.stringify(event))));
    } catch {
      /* Diagnostics must never alter the exam flow. */
    }
  }
  identity(identity: IdentityContext) {
    if (
      !this.settings.identityEnabled ||
      !this.active(this.current()?.courseId) ||
      (this.settings.courseIds.length && !this.settings.courseIds.includes(this.current()?.courseId || ""))
    )
      return;
    try {
      const clean: IdentityContext = { canvasUserId: identity.canvasUserId.slice(0, 100) };
      for (const key of ["displayName", "email", "courseName"] as const)
        if (typeof identity[key] === "string") clean[key] = identity[key]!.slice(0, key === "email" ? 320 : 512);
      for (const key of ["roles", "sectionIds", "sectionNames"] as const)
        if (Array.isArray(identity[key])) clean[key] = identity[key]!.slice(0, 30).map((v) => String(v).slice(0, 256));
      const flowId = this.current()?.flowId;
      if (!flowId) return;
      const iv = randomBytes(12);
      const cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(this.settings.identityKeys[this.settings.identityKeyId], "base64url"),
        iv
      );
      cipher.setAAD(Buffer.from("soe-diagnostics-identity-v1\0" + this.settings.installationId + "\0" + flowId));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(clean)), cipher.final()]);
      const envelope: IdentityEnvelope = {
        version: 1,
        keyId: this.settings.identityKeyId,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        ciphertext: ciphertext.toString("base64url")
      };
      this.record("identity.verified", { outcome: "succeeded", identity: envelope });
    } catch {
      /* Fail safely without logging identity or encryption errors. */
    }
  }
  failure(stage: string, error: unknown, fields: Fields = {}) {
    const e = error as { name?: string; code?: string; status?: number; stack?: string };
    const code = typeof e?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(e.code) ? e.code : "UNEXPECTED_ERROR";
    const frames = (e?.stack || "")
      .split("\n")
      .slice(1, 9)
      .map((v) =>
        v
          .trim()
          .replace(/file:\/\/[^\s)]+/g, "source")
          .replace(/\/[^ ()]*\//g, "source/")
          .slice(0, 170)
      )
      .filter((v) => /^at [A-Za-z0-9_.$<> /:@()-]{1,180}$/.test(v));
    this.record(stage, {
      outcome: "failed",
      severity: "ERROR",
      reasonCode: code,
      errorFingerprint: createHash("sha256")
        .update((e?.name || "Error") + "\0" + code + "\0" + frames.join("\n"))
        .digest("hex"),
      stackFrames: frames,
      ...fields
    });
  }
  browserToken(attemptId: string) {
    const c = this.current();
    if (!c || !UUID.test(attemptId) || !this.active(c.courseId)) return undefined;
    const value = Buffer.from(
      JSON.stringify({
        v: 1,
        instance: this.settings.installationId,
        flowId: c.flowId,
        attemptId,
        subjectKey: c.subjectKey,
        courseId: c.courseId,
        contentId: c.contentId,
        exp: Date.now() + 12 * 3600000
      })
    ).toString("base64url");
    return (
      value +
      "." +
      createHmac("sha256", this.settings.hashKey)
        .update("soe-diagnostics-browser-v1\0" + value)
        .digest("base64url")
    );
  }
  verifyBrowserToken(token: unknown): Record<string, unknown> | null {
    if (!this.settings.enabled || typeof token !== "string" || token.length > 4096) return null;
    const [p, s, ...extra] = token.split(".");
    if (!p || !s || extra.length) return null;
    const expected = createHmac("sha256", this.settings.hashKey)
      .update("soe-diagnostics-browser-v1\0" + p)
      .digest("base64url");
    if (s.length !== expected.length || !timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(p, "base64url").toString());
      return data.v === 1 &&
        data.instance === this.settings.installationId &&
        UUID.test(data.attemptId) &&
        UUID.test(data.flowId) &&
        data.exp > Date.now() &&
        this.active(data.courseId)
        ? data
        : null;
    } catch {
      return null;
    }
  }
  consumeBudget(key: string, limit = 120, cost = 1) {
    const now = Date.now();
    if (this.budgets.size > 10000) for (const [k, v] of this.budgets) if (now - v.at > 60000) this.budgets.delete(k);
    if (this.budgets.size >= 10000 && !this.budgets.has(key)) return false;
    const b = this.budgets.get(key);
    if (!b || now - b.at > 60000) {
      this.budgets.set(key, { at: now, count: cost });
      return cost <= limit;
    }
    b.count += cost;
    return b.count <= limit;
  }
}
export let diagnostics = new DiagnosticsRuntime(diagnosticsSettings({}));
export function configureDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  diagnostics = new DiagnosticsRuntime(diagnosticsSettings(env));
  return diagnostics;
}
export function diagnosticRequest(request: Request, response: Response, next: NextFunction) {
  if (!diagnostics.settings.enabled) {
    next();
    return;
  }
  const principal = request.session?.verifiedLtiPrincipal;
  const incoming = /^([a-f0-9]{32})(?:\/(\d{1,20}))?(?:;o=[01])?$/i.exec(request.header("x-cloud-trace-context") || "");
  let parentSpanId: string | undefined;
  try {
    const n = BigInt(incoming?.[2] || "0");
    if (n > 0n && n <= 0xffffffffffffffffn) parentSpanId = n.toString(16).padStart(16, "0");
  } catch {
    /* Ignore malformed provider context. */
  }
  const flow = request.session?.diagnosticsFlowId;
  const route = diagnosticRoute(request.path);
  requestSpan(
    route,
    incoming?.[1].toLowerCase(),
    (span) => {
      const captured: Context = {
        flowId: flow && UUID.test(flow) ? flow : randomUUID(),
        courseId: principal?.courseId,
        subjectKey: principal ? diagnostics.subject(principal.canvasUserId) : undefined,
        traceId: span?.spanContext().traceId || incoming?.[1].toLowerCase(),
        spanId: span?.spanContext().spanId,
        startedAt: Date.now()
      };
      diagnostics.context.run(captured, () => {
        if (route)
          diagnostics.record("request.started", { outcome: "started", details: { route, httpMethod: request.method } });
        response.once("finish", () =>
          diagnostics.context.run(captured, () => {
            span?.end();
            if (route)
              diagnostics.record("request.completed", {
                outcome: response.statusCode >= 400 ? "failed" : "succeeded",
                status: response.statusCode,
                durationMs: Date.now() - captured.startedAt,
                details: { route, httpMethod: request.method }
              });
            if (request.path.startsWith("/seb/config/") && response.statusCode === 200)
              diagnostics.record("configuration.delivered", {
                outcome: "succeeded",
                durationMs: Date.now() - captured.startedAt
              });
          })
        );
        response.once("close", () =>
          diagnostics.context.run(captured, () => {
            if (!response.writableFinished) {
              span?.end();
              if (route)
                diagnostics.record("request.disconnected", {
                  outcome: "unknown",
                  reasonCode: "CLIENT_DISCONNECTED",
                  durationMs: Date.now() - captured.startedAt,
                  details: { route }
                });
            }
          })
        );
        next();
      });
    },
    parentSpanId
  );
}
export function diagnosticRoute(path: string) {
  if (path.startsWith("/api/diagnostics/")) return undefined;
  if (path.startsWith("/lti/")) return "/lti/" + (path.startsWith("/lti/login") ? "login" : "launch");
  for (const prefix of [
    "/seb/session/",
    "/seb/config/",
    "/seb/launch/",
    "/seb/exit/",
    "/api/seb/access-proof/",
    "/api/seb/access-code/",
    "/api/seb/config-grant/"
  ])
    if (path.startsWith(prefix)) return prefix + ":target";
  if (path.startsWith("/api/oauth2") || path.startsWith("/api/student-session")) return "/api/oauth";
  if (path.startsWith("/api/quizzes")) return "/api/quizzes/:operation";
  return undefined;
}
