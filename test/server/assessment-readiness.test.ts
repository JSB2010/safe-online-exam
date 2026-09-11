import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateAssessmentReadiness } from "../../src/server/services/assessment-helpers.js";
import type { AssessmentRecord } from "../../src/shared/models.js";

const NOW = new Date("2026-09-10T20:15:00.000Z");

describe("assessment readiness", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["unpublished", "configured_unpublished"],
    ["conflict", "publication_conflict"],
    ["unknown", "publication_unknown"]
  ] as const)("reports %s publication evidence as %s", (publicationStatus, expectedStatus) => {
    vi.setSystemTime(NOW);
    expect(evaluateAssessmentReadiness(record({ publicationStatus })).status).toBe(expectedStatus);
  });

  it("treats legacy boolean-only publication rows as unknown until refreshed", () => {
    vi.setSystemTime(NOW);
    const legacy = record({ publicationStatus: "published" });
    legacy.canvas.publication = null;
    legacy.canvas.published = true;

    expect(evaluateAssessmentReadiness(legacy)).toMatchObject({
      status: "publication_unknown",
      globallyReady: false
    });
  });

  it("enforces future, exact unlock, exact lock, and closed boundaries", () => {
    vi.setSystemTime(NOW);
    expect(evaluateAssessmentReadiness(record({ unlockAt: "2026-09-10T20:15:00.001Z" })).status).toBe("not_yet_open");
    expect(evaluateAssessmentReadiness(record({ unlockAt: "2026-09-10T20:15:00.000Z" })).globallyReady).toBe(true);
    expect(evaluateAssessmentReadiness(record({ lockAt: "2026-09-10T20:15:00.000Z" })).status).toBe("closed");
    expect(evaluateAssessmentReadiness(record({ lockAt: "2026-09-10T20:14:59.999Z" })).status).toBe("closed");
  });

  it("distinguishes missing, stale, malformed availability, and incomplete settings", () => {
    vi.setSystemTime(NOW);
    const missing = record();
    missing.canvasVerification = { status: "missing", checkedAt: NOW.toISOString() };
    expect(evaluateAssessmentReadiness(missing).status).toBe("canvas_missing");

    const stale = record();
    stale.canvasVerification = {
      status: "verified",
      checkedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString()
    };
    expect(evaluateAssessmentReadiness(stale).status).toBe("canvas_stale");
    expect(evaluateAssessmentReadiness(record({ unlockAt: "not-a-date" })).status).toBe("publication_unknown");

    const incomplete = record();
    incomplete.seb.accessCode = null;
    expect(evaluateAssessmentReadiness(incomplete)).toMatchObject({
      status: "settings_incomplete",
      configured: false,
      globallyReady: true
    });
  });
});

function record(
  overrides: {
    publicationStatus?: "published" | "unpublished" | "conflict" | "unknown";
    unlockAt?: string | null;
    lockAt?: string | null;
  } = {}
): AssessmentRecord {
  const publicationStatus = overrides.publicationStatus || "published";
  return {
    id: "classicquiz_1",
    courseId: "course-1",
    contentType: "CLASSIC_QUIZ",
    canvas: {
      canvasId: "1",
      title: "Exam",
      published: publicationStatus === "published" ? true : publicationStatus === "unpublished" ? false : null,
      publication: {
        status: publicationStatus,
        confidence: publicationStatus === "unknown" ? "unavailable" : "complete",
        checkedAt: NOW.toISOString(),
        quizPublished: publicationStatus === "published" ? true : publicationStatus === "unpublished" ? false : null
      },
      unlockAt: overrides.unlockAt ?? null,
      lockAt: overrides.lockAt ?? null
    },
    seb: {
      required: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: null,
      configKeySalt: null,
      startPassword: null,
      quitPassword: "QUIT",
      usesCourseDefaults: false,
      urlRules: [],
      externalTools: []
    },
    canvasVerification: {
      status: "verified",
      checkedAt: NOW.toISOString(),
      lastVerifiedAt: NOW.toISOString()
    }
  };
}
