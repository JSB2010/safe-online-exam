import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig } from "../../src/server/config/app-config.js";
import { SebController } from "../../src/server/controllers/seb.controller.js";
import { createInMemoryRepositories, type RepositoryProvider } from "../../src/server/data/repositories.js";
import { SebConfigKeyService } from "../../src/server/services/seb-config-key.service.js";
import {
  SebSessionHandoffService,
  sebCanvasSessionPath
} from "../../src/server/services/seb-session-handoff.service.js";

const token = "T".repeat(43);
const key = "a".repeat(64);
const content = "newquiz:1:2";
const returnTo = "https://canvas.example.edu/courses/1/assignments/2";
const url = "https://tool.example.edu" + sebCanvasSessionPath("1", content, token);

beforeEach(() => {
  vi.stubEnv("TOOL_URL", "https://tool.example.edu");
  vi.stubEnv("CANVAS_BASE_URL", "https://canvas.example.edu");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function fixture() {
  const repositories = createInMemoryRepositories();
  const keys = new SebConfigKeyService();
  const handoff = new SebSessionHandoffService({ value: repositories } as RepositoryProvider, keys);
  await handoff.registerSessionStart(token, {
    canvasUserId: "student-1",
    courseId: "1",
    contentId: content,
    settingsFingerprint: "settings",
    configKey: key,
    returnTo
  });
  const canvas = {
    getLearnerAssessmentAvailability: vi.fn().mockImplementation(async () => ({
      available: true,
      reason: "available",
      checkedAt: new Date().toISOString()
    })),
    getSessionToken: vi.fn().mockResolvedValue(returnTo + "?session_token=fresh")
  };
  const controller = new SebController(
    new AppConfig(),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    keys,
    {} as any,
    {} as any,
    { consumeRequestIp: async () => true } as any,
    canvas as any,
    handoff
  );
  const coordinator = (controller as any).contentCoordinator;
  vi.spyOn(coordinator, "resolveCurrentConfiguredTarget").mockResolvedValue({
    canonicalContentId: content,
    settingsFingerprint: "settings",
    setting: {}
  });
  vi.spyOn(coordinator, "finalizeCourseScopedGrant").mockImplementation(async (_c, target) => target);
  const request = {
    header: (name: string) => (name === "origin" ? "https://tool.example.edu" : ""),
    ip: "session-start-test"
  };
  const response = () => {
    const r = { status: vi.fn(), json: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
    r.status.mockReturnValue(r);
    return r;
  };
  const hash = keys.hashForUrl(url, key);
  const start = (r = response(), req = request, proof = hash) =>
    controller.startCanvasSession(req as any, r as any, "1", content, token, { configKeyHash: proof }).then(() => r);
  return { handoff, keys, canvas, controller, coordinator, request, response, hash, start };
}

describe("deferred Canvas login", () => {
  it("waits through a long password prompt, rechecks availability, then creates a fresh Canvas login exactly once", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const page = f.response();
    await f.controller.canvasSessionPage(page as any, "1", content, token);
    expect(page.send).toHaveBeenCalledWith(expect.stringContaining("seb-session-start"));
    expect(f.canvas.getSessionToken).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10 * 60_000);
    const result = await f.start();
    expect(result.json).toHaveBeenCalledWith({ success: true, sessionUrl: returnTo + "?session_token=fresh" });
    expect(f.canvas.getLearnerAssessmentAvailability).toHaveBeenCalledWith("1", content, "student-1");
    expect(f.canvas.getSessionToken).toHaveBeenCalledExactlyOnceWith("student-1", returnTo);
    expect(f.canvas.getLearnerAssessmentAvailability.mock.invocationCallOrder[0]).toBeLessThan(
      f.canvas.getSessionToken.mock.invocationCallOrder[0]
    );
    expect(await f.handoff.resolveConfigKey("1", content, "settings", f.keys.hashForUrl(returnTo, key), returnTo)).toBe(
      key
    );
    const replay = await f.start();
    expect(replay.status).toHaveBeenCalledWith(403);
    expect(f.canvas.getSessionToken).toHaveBeenCalledTimes(1);
  });

  it("does not burn a capability for forged proof, another course, another URL, or a cross-origin request", async () => {
    const f = await fixture();
    expect(await f.handoff.consumeSessionStart(token, "other", content, f.hash, url)).toBeNull();
    expect(await f.handoff.consumeSessionStart(token, "1", content, f.hash, url + "/other")).toBeNull();
    expect((await f.start(f.response(), f.request, "b".repeat(64))).status).toHaveBeenCalledWith(403);
    expect(
      (await f.start(f.response(), { ...f.request, header: () => "https://attacker.example" })).status
    ).toHaveBeenCalledWith(403);
    const malformed = f.response();
    await f.controller.startCanvasSession(f.request as any, malformed as any, "1", content, token, null as any);
    expect(malformed.status).toHaveBeenCalledWith(403);
    expect(f.canvas.getSessionToken).not.toHaveBeenCalled();
    expect((await f.start()).json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("rejects expired startup capabilities and malformed tokens", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    vi.advanceTimersByTime(16 * 60_000);
    expect((await f.start()).status).toHaveBeenCalledWith(403);
    expect(await f.handoff.getSessionStart("bad", "1", content)).toBeNull();
    expect(f.canvas.getSessionToken).not.toHaveBeenCalled();
  });

  it("allows only one of simultaneous starts", async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 20 }, () => f.start()));
    expect(results.filter((r) => r.json.mock.calls[0]?.[0]?.success === true)).toHaveLength(1);
    expect(f.canvas.getSessionToken).toHaveBeenCalledTimes(1);
  });

  it("rejects changed settings and newly unavailable quizzes before creating a Canvas login", async () => {
    const changed = await fixture();
    changed.coordinator.resolveCurrentConfiguredTarget.mockResolvedValue(null);
    expect((await changed.start()).status).toHaveBeenCalledWith(409);
    expect(changed.canvas.getSessionToken).not.toHaveBeenCalled();
    const denied = await fixture();
    denied.canvas.getLearnerAssessmentAvailability.mockResolvedValue({ available: false, reason: "closed" });
    expect((await denied.start()).status).toHaveBeenCalledWith(403);
    expect(denied.canvas.getSessionToken).not.toHaveBeenCalled();
  });

  it("revokes registered proof state when Canvas session creation fails", async () => {
    const f = await fixture();
    f.canvas.getSessionToken.mockRejectedValue(new Error("upstream unavailable"));
    expect((await f.start()).status).toHaveBeenCalledWith(503);
    expect(
      await f.handoff.resolveConfigKey("1", content, "settings", f.keys.hashForUrl(returnTo, key), returnTo)
    ).toBeNull();
  });
});
