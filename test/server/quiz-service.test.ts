import { describe, expect, it, vi } from "vitest";
import { createInMemoryRepositories, RepositoryProvider } from "../../src/server/data/repositories.js";
import { CanvasApiService } from "../../src/server/services/canvas-api.service.js";
import { QuizService } from "../../src/server/services/quiz.service.js";

describe("QuizService", () => {
  it("enables and disables SEB with Canvas access codes", async () => {
    const repos = { value: createInMemoryRepositories() } as RepositoryProvider;
    const canvas = {
      setQuizAccessCode: vi.fn().mockResolvedValue(true),
      removeQuizAccessCode: vi.fn().mockResolvedValue(true),
      getQuizzesForCourse: vi.fn().mockResolvedValue([])
    } as unknown as CanvasApiService;
    const service = new QuizService(repos, canvas);

    const enabled = await service.enableSebWithAccessCode("course-1", "quiz-1", "user-1");
    expect(enabled.sebRequired).toBe(true);
    expect(enabled.accessCode).toMatch(/^[A-Z0-9]{16}$/u);
    expect(canvas.setQuizAccessCode).toHaveBeenCalled();

    const disabled = await service.disableSebWithAccessCode("course-1", "quiz-1", "user-1");
    expect(disabled.sebRequired).toBe(false);
    expect(disabled.accessCode).toBeNull();
    expect(canvas.removeQuizAccessCode).toHaveBeenCalled();
  });
});
