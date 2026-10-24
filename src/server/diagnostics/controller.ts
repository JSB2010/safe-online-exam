import { sebConfigFingerprint } from "../services/seb-setting-fingerprint.js";
import { Body, Controller, Get, Headers, HttpCode, HttpException, Post, Req, Query } from "@nestjs/common";
import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { diagnostics } from "./runtime.js";
import { AssessmentService } from "../services/assessment.service.js";
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const stages = new Set([
  "detector.initialized",
  "browser.seb_detected",
  "browser.form_found",
  "browser.proof_completed",
  "browser.code_completed",
  "browser.begin_requested",
  "browser.assessment_observed",
  "browser.submit_requested",
  "browser.submit_observed",
  "browser.error",
  "browser.exit_requested"
]);
@Controller("/api/diagnostics/v1")
export class DiagnosticsController {
  constructor(private readonly assessments: AssessmentService) {}
  @Post("/browser-events")
  @HttpCode(202)
  events(@Body() body: unknown, @Headers("origin") origin?: string) {
    if (!diagnostics.settings.enabled) return { enabled: false };
    const allowed = [process.env.TOOL_URL, process.env.CANVAS_DOMAIN].flatMap((v) => {
      try {
        return v ? [new URL(v).origin] : [];
      } catch {
        return [];
      }
    });
    if (!origin || !allowed.includes(origin))
      throw new HttpException({ error_code: "DIAGNOSTICS_ORIGIN_REJECTED" }, 403);
    if (!body || typeof body !== "object" || JSON.stringify(body).length > 16384)
      throw new HttpException({ error_code: "INVALID_DIAGNOSTIC_BATCH" }, 400);
    const b = body as { token?: unknown; events?: unknown[] };
    const grant = diagnostics.verifyBrowserToken(b.token);
    if (!grant) throw new HttpException({ error_code: "INVALID_DIAGNOSTIC_CAPABILITY" }, 403);
    if (!Array.isArray(b.events) || b.events.length > 25)
      throw new HttpException({ error_code: "INVALID_DIAGNOSTIC_BATCH" }, 400);
    if (!diagnostics.consumeBudget(String(grant.attemptId), 120, b.events.length))
      throw new HttpException({ error_code: "DIAGNOSTIC_RATE_LIMIT" }, 429);
    let accepted = 0;
    for (const item of b.events) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      if (
        Object.keys(e).some((k) => !["stage", "at", "sequence", "reasonCode", "durationMs", "status"].includes(k)) ||
        typeof e.stage !== "string" ||
        !stages.has(e.stage)
      )
        continue;
      if (
        e.reasonCode !== undefined &&
        (typeof e.reasonCode !== "string" || !/^BROWSER_[A-Z0-9_]{1,70}$/.test(e.reasonCode))
      )
        continue;
      diagnostics.record(e.stage, {
        flowId: String(grant.flowId),
        attemptId: String(grant.attemptId),
        subjectKey: typeof grant.subjectKey === "string" ? grant.subjectKey : undefined,
        courseId: String(grant.courseId || ""),
        contentId: String(grant.contentId || ""),
        source: "browser",
        outcome: e.stage === "browser.error" ? "failed" : "observed",
        severity: e.stage === "browser.error" ? "WARNING" : "INFO",
        reasonCode: e.reasonCode as string | undefined,
        clientOccurredAt: typeof e.at === "string" && Number.isFinite(Date.parse(e.at)) ? e.at : undefined,
        clientSequence: Number.isSafeInteger(e.sequence) && Number(e.sequence) >= 0 ? Number(e.sequence) : undefined,
        status: typeof e.status === "number" && e.status >= 100 && e.status <= 599 ? e.status : undefined,
        durationMs:
          typeof e.durationMs === "number" && e.durationMs >= 0 && e.durationMs < 3600000 ? e.durationMs : undefined
      });
      accepted++;
    }
    return { accepted };
  }
  @Get("/context")
  async context(@Req() request: Request, @Query("courseId") courseId?: string, @Query("offset") offset?: string) {
    if (!diagnostics.active(courseId) || !/^\d{1,30}$/.test(courseId || ""))
      throw new HttpException({ error_code: "NOT_FOUND" }, 404);
    const audience = process.env.DIAGNOSTICS_INTEGRATION_AUDIENCE;
    const caller = process.env.DIAGNOSTICS_SERVICE_ACCOUNT;
    try {
      if (!audience || !caller) throw new Error();
      const { payload } = await jwtVerify((request.header("authorization") || "").replace(/^Bearer /, ""), keys, {
        audience,
        issuer: ["https://accounts.google.com", "accounts.google.com"]
      });
      if (payload.email !== caller || payload.email_verified !== true) throw new Error();
    } catch {
      throw new HttpException({ error_code: "DIAGNOSTICS_INTEGRATION_DENIED" }, 403);
    }
    const [quizzes, content] = await Promise.all([
      this.assessments.getQuizzesForCourse(courseId!),
      this.assessments.getCachedContentForCourse(courseId!)
    ]);
    const start = /^\d{1,6}$/.test(offset || "0") ? Number(offset || "0") : 0;
    const all = [...quizzes, ...content];
    return {
      nextOffset: start + 25 < all.length ? start + 25 : null,
      installationId: diagnostics.settings.installationId,
      items: await Promise.all(
        all.slice(start, start + 25).map(async (q) => {
          const setting =
            "contentType" in q
              ? await this.assessments.getContentSebSetting(q.id)
              : await this.assessments.getSebSettingForQuiz(q.id);
          return {
            id: q.id,
            courseId: q.courseId,
            title: q.title,
            contentType: "contentType" in q ? q.contentType : "CLASSIC_QUIZ",
            configuration: setting
              ? {
                  revision: diagnostics.configurationRevision(sebConfigFingerprint(setting)),
                  enabled: setting.enabled,
                  sebRequired: setting.sebRequired,
                  startPasswordConfigured: !!setting.startPassword,
                  quitPasswordConfigured: !!setting.quitPassword,
                  configKeySaltConfigured: !!setting.configKeySalt
                }
              : null
          };
        })
      )
    };
  }
}
