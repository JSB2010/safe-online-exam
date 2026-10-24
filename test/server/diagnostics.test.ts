import { describe, it, expect, afterEach, vi } from "vitest";
import { createDecipheriv, randomUUID } from "node:crypto";
import { DiagnosticsRuntime, diagnosticsSettings } from "../../src/server/diagnostics/runtime.js";
import { validateEvent, eventOutcome, type DiagnosticEvent } from "../../src/shared/diagnostics/diagnostics.js";
import { analyzeLog, redactDiagnosticText } from "../../src/shared/diagnostics/redaction.js";

const key = Buffer.alloc(32, 7).toString("base64url");
const env = {
  DIAGNOSTICS_ENABLED: "true",
  DIAGNOSTICS_INSTALLATION_ID: "pilot",
  DIAGNOSTICS_HASH_KEY: "h".repeat(32),
  DIAGNOSTICS_IDENTITY_ENABLED: "true",
  DIAGNOSTICS_IDENTITY_ACTIVE_KEY_ID: "first",
  DIAGNOSTICS_IDENTITY_KEYRING: JSON.stringify({ first: key })
};
afterEach(() => vi.useRealTimers());
describe("production diagnostics safety", () => {
  it("defaults off, respects course and expiry limits, and isolates output failure", () => {
    const output = vi.fn();
    new DiagnosticsRuntime(diagnosticsSettings({}), output).record("lti.login");
    const runtime = new DiagnosticsRuntime(
      diagnosticsSettings({
        ...env,
        DIAGNOSTICS_COURSE_IDS: "42",
        DIAGNOSTICS_EXPIRES_AT: new Date(Date.now() + 1000).toISOString()
      }),
      output
    );
    runtime.record("lti.login", { courseId: "43" });
    expect(output).not.toHaveBeenCalled();
    runtime.record("lti.login", { courseId: "42" });
    expect(output).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);
    runtime.record("lti.login", { courseId: "42" });
    expect(output).toHaveBeenCalledOnce();
    expect(() =>
      new DiagnosticsRuntime(diagnosticsSettings(env), () => {
        throw Error("sink unavailable");
      }).record("lti.login")
    ).not.toThrow();
  });
  it("keeps flow, learner and multiple application attempts distinct and encrypts identity with bound context", () => {
    const events: DiagnosticEvent[] = [];
    const runtime = new DiagnosticsRuntime(diagnosticsSettings(env), (e) => events.push(e));
    const flowId = randomUUID(),
      attempt1 = randomUUID(),
      attempt2 = randomUUID();
    runtime.context.run({ flowId, startedAt: Date.now(), courseId: "42", subjectKey: runtime.subject("123") }, () => {
      runtime.identity({ canvasUserId: "123", email: "synthetic@example.edu", displayName: "Synthetic Learner" });
      runtime.bind({ attemptId: attempt1 });
      runtime.record("proof.validation", { outcome: "failed", reasonCode: "SEB_CONFIG_PROOF_MISMATCH" });
      runtime.bind({ attemptId: attempt2 });
      runtime.record("access_code.released", { outcome: "succeeded" });
    });
    expect(events.map((e) => e.flowId)).toEqual([flowId, flowId, flowId]);
    expect(events[1].attemptId).not.toBe(events[2].attemptId);
    expect(JSON.stringify(events)).not.toContain("synthetic@example.edu");
    const e = events[0].identity!;
    const d = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64url"), Buffer.from(e.iv, "base64url"));
    d.setAAD(Buffer.from("soe-diagnostics-identity-v1\0pilot\0" + flowId));
    d.setAuthTag(Buffer.from(e.tag, "base64url"));
    expect(
      JSON.parse(Buffer.concat([d.update(Buffer.from(e.ciphertext, "base64url")), d.final()]).toString()).canvasUserId
    ).toBe("123");
    expect(runtime.subject("123")).not.toBe("123");
  });
  it("rejects tampered, expired and wrong-installation browser capabilities and bounds event rate", () => {
    const runtime = new DiagnosticsRuntime(diagnosticsSettings(env), () => {});
    runtime.context.run({ flowId: randomUUID(), startedAt: Date.now(), courseId: "42" }, () => {
      const token = runtime.browserToken(randomUUID())!;
      expect(runtime.verifyBrowserToken(token)).toBeTruthy();
      expect(runtime.verifyBrowserToken(token.slice(0, -1) + "!")).toBeNull();
      const other = new DiagnosticsRuntime(diagnosticsSettings({ ...env, DIAGNOSTICS_INSTALLATION_ID: "other" }));
      expect(other.verifyBrowserToken(token)).toBeNull();
      vi.useFakeTimers();
      vi.advanceTimersByTime(13 * 3600000);
      expect(runtime.verifyBrowserToken(token)).toBeNull();
    });
    for (let i = 0; i < 120; i++) expect(runtime.consumeBudget("attempt")).toBe(true);
    expect(runtime.consumeBudget("attempt")).toBe(false);
  });
  it("never includes unexpected error messages, SQL values or token URLs", () => {
    const events: DiagnosticEvent[] = [];
    const runtime = new DiagnosticsRuntime(diagnosticsSettings(env), (e) => events.push(e));
    const error = Object.assign(new Error("password=hunter token=secret synthetic@example.edu"), { code: "XX001" });
    runtime.failure("database.query", error);
    const value = JSON.stringify(events);
    expect(value).not.toMatch(/hunter|secret|synthetic@example/);
    expect(events[0].errorFingerprint).toHaveLength(64);
    expect(() => validateEvent({ ...events[0], password: "secret" })).toThrow();
    expect(() => validateEvent({ ...events[0], details: { query: "SELECT secret" } })).toThrow();
  });
});
it("extracts multiple untrusted native markers and precise findings without retaining raw lines", () => {
  const a = randomUUID(),
    b = randomUUID();
  const parsed = analyzeLog(
    `2026-11-01 01:30:00 URL https://school.example/quiz?diagnostic=${a}&code=secret\nquiz_diagnostic_${b}.seb\nUnable to decrypt settings password=secret\ninvalid authenticity token\n`
  );
  expect(parsed.markers).toEqual([a, b]);
  expect(parsed.findings.map((f) => f.line)).toEqual([3, 4]);
  expect(parsed.timestampBasis).toBe("client_log_uncertain");
  expect(JSON.stringify(parsed)).not.toContain("secret");
  const safe = redactDiagnosticText(
    `Bearer abc password=secret ConfigKey=abc https://user:pass@school.example/login?session_token=bad#secret https://tool.example/seb/session/42/quiz/token`
  );
  expect(safe).not.toMatch(/Bearer abc|password=secret|ConfigKey=abc|user:pass|session_token=bad|quiz\/token/);
});
it("does not mistake downloads or missing browser events for confirmed entry or submission", () => {
  const base = {
    schema: "soe.diagnostics",
    schemaVersion: 1,
    eventId: randomUUID(),
    flowId: randomUUID(),
    installationId: "pilot",
    occurredAt: new Date().toISOString(),
    stage: "configuration.delivered",
    source: "server",
    outcome: "succeeded",
    severity: "INFO"
  } as DiagnosticEvent;
  expect(eventOutcome([base])).toBe("No further observation");
  expect(eventOutcome([{ ...base, stage: "access_code.released" }])).toBe("Entry confirmed");
  expect(eventOutcome([{ ...base, stage: "browser.submit_observed", source: "browser", outcome: "observed" }])).toBe(
    "No further observation"
  );
});

it("uses an opaque keyed configuration revision without exposing the settings fingerprint", () => {
  const runtime = new DiagnosticsRuntime(diagnosticsSettings(env), () => {});
  const snapshot = JSON.stringify({ accessCode: "synthetic-secret", quitPassword: "synthetic-password" });
  const revision = runtime.configurationRevision(snapshot);
  expect(revision).toMatch(/^[a-f0-9]{64}$/);
  expect(revision).not.toContain("synthetic");
  expect(runtime.configurationRevision(snapshot)).toBe(revision);
});

it("validates the checked-in failure and recovery scenario fixtures", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixtures = JSON.parse(await readFile(process.cwd() + "/src/shared/diagnostics/fixtures.json", "utf8")) as {
    scenario: string;
    events: DiagnosticEvent[];
  }[];
  expect(fixtures).toHaveLength(9);
  for (const fixture of fixtures)
    for (const event of fixture.events) expect(validateEvent(event).schemaVersion).toBe(1);
  expect(eventOutcome(fixtures.find((f) => f.scenario === "retry_recovery")!.events)).toBe("Recovered");
  expect(eventOutcome(fixtures.find((f) => f.scenario === "submission_exit")!.events)).toBe("No further observation");
});
it("retains the resolved attempt on response completion even when emitted outside the request async context", async () => {
  const { EventEmitter } = await import("node:events");
  const { configureDiagnostics, diagnosticRequest } = await import("../../src/server/diagnostics/runtime.js");
  const runtime = configureDiagnostics(env);
  const emitted: DiagnosticEvent[] = [];
  const output = vi.spyOn(console, "info").mockImplementation((value) => emitted.push(JSON.parse(String(value))));
  const flow = randomUUID(),
    attempt = randomUUID();
  const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: true });
  const request = {
    path: "/seb/config/42/classicquiz_9.seb",
    method: "GET",
    session: { diagnosticsFlowId: flow },
    header: () => undefined
  };
  try {
    diagnosticRequest(request as never, response as never, () =>
      runtime.bind({ attemptId: attempt, courseId: "42", contentId: "classicquiz_9" })
    );
    response.emit("finish");
    const finished = emitted.find((e) => e.stage === "configuration.delivered")!;
    expect(finished.flowId).toBe(flow);
    expect(finished.attemptId).toBe(attempt);
  } finally {
    output.mockRestore();
    configureDiagnostics({});
  }
});
