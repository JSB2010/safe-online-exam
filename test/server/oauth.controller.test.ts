import { describe, expect, it } from "vitest";
import { canvasScopes } from "../../src/server/controllers/oauth.controller.js";

describe("canvasScopes", () => {
  it("requests the Canvas API scopes needed for quiz and module SEB enforcement", () => {
    expect(canvasScopes()).toEqual(
      expect.arrayContaining([
        "url:GET|/api/v1/courses/:id",
        "url:GET|/api/v1/courses/:course_id/quizzes",
        "url:GET|/api/v1/courses/:course_id/quizzes/:id",
        "url:GET|/api/v1/courses/:course_id/assignments",
        "url:GET|/api/v1/courses/:course_id/assignments/:id",
        "url:GET|/api/quiz/v1/courses/:course_id/quizzes",
        "url:GET|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
        "url:PUT|/api/v1/courses/:course_id/quizzes/:id",
        "url:PATCH|/api/quiz/v1/courses/:course_id/quizzes/:assignment_id",
        "url:GET|/api/v1/courses/:course_id/modules",
        "url:GET|/api/v1/courses/:course_id/modules/:module_id/items",
        "url:PUT|/api/v1/courses/:course_id/modules/:module_id/items/:id",
        "url:PUT|/api/v1/courses/:course_id/assignments/:id",
        "url:POST|/api/v1/courses/:course_id/assignments"
      ])
    );
  });
});
