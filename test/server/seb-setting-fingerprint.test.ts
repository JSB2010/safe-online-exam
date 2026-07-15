import { describe, expect, it } from "vitest";
import {
  invalidateConfigKeyIfSebConfigChanged,
  sebConfigFingerprint
} from "../../src/server/services/seb-setting-fingerprint.js";

describe("SEB setting fingerprint", () => {
  it("binds selected tool definitions but ignores disabled catalog entries", () => {
    const base = {
      quizId: "quiz-1",
      courseId: "course-1",
      sebRequired: true,
      enabled: true,
      accessCode: "ACCESS",
      configKey: "stored-key",
      externalTools: [
        { id: "selected", label: "Selected", url: "https://selected.example.edu/exam", enabled: true },
        { id: "disabled", label: "Disabled", url: "https://disabled.example.edu/old", enabled: false }
      ]
    };
    const changedDisabledCatalog = {
      ...base,
      externalTools: [
        base.externalTools[0]!,
        { id: "disabled", label: "Renamed", url: "https://disabled.example.edu/new", enabled: false }
      ]
    };
    const changedSelection = {
      ...base,
      externalTools: [
        { id: "selected", label: "Selected", url: "https://selected.example.edu/revised", enabled: true },
        base.externalTools[1]!
      ]
    };

    expect(sebConfigFingerprint(changedDisabledCatalog)).toBe(sebConfigFingerprint(base));
    expect(sebConfigFingerprint(changedSelection)).not.toBe(sebConfigFingerprint(base));
    expect(invalidateConfigKeyIfSebConfigChanged(base, changedDisabledCatalog).configKey).toBe("stored-key");
    expect(invalidateConfigKeyIfSebConfigChanged(base, changedSelection).configKey).toBeNull();
  });
});
