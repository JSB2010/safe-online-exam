import { describe, expect, it } from "vitest";
import { canvasScopes } from "../../src/server/controllers/oauth.controller.js";

describe("canvasScopes", () => {
  it("requests the Canvas API scopes needed for quiz SEB enforcement", () => {
    expect(canvasScopes()).toEqual([
      "url:GET|/api/v1/courses/:course_id/quizzes",
      "url:GET|/api/v1/courses/:course_id/assignments",
      "url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
      "url:PUT|/api/v1/courses/:course_id/quizzes/:id",
      "url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id"
    ]);
  });
});
