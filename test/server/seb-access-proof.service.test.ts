import { describe, expect, it } from "vitest";
import { SebAccessProofService } from "../../src/server/services/seb-access-proof.service.js";

describe("SebAccessProofService", () => {
  it("mints single-use tokens bound to course and content", () => {
    const service = new SebAccessProofService();
    const token = service.mintProof("course-1", "quiz-1");

    expect(service.consumeProof(token, "course-2", "quiz-1")).toBe(false);
    expect(service.consumeProof(token, "course-1", "quiz-1")).toBe(false);

    const valid = service.mintProof("course-1", "quiz-1");
    expect(service.consumeProof(valid, "course-1", "quiz-1")).toBe(true);
    expect(service.consumeProof(valid, "course-1", "quiz-1")).toBe(false);
  });
});
