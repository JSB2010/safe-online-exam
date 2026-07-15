import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { createActionToken } from "../../src/server/http/action-token.js";
import { AssessmentAuthorizationService } from "../../src/server/services/assessment-authorization.service.js";

const SESSION_SECRET = "test-session-secret";
const COURSE_ID = "course-1";
const USER_ID = "canvas-user-1";
const SUBJECT = "opaque-lti-subject";
const DEPLOYMENT_ID = "deployment-1";
const SESSION_ID = "session-1";
const INSTRUCTOR_ROLE = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
const LEARNER_ROLE = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

describe("AssessmentAuthorizationService", () => {
  it("authorizes an exact Classic Quiz binding for a verified instructor", async () => {
    const assessment = classicAssessment();
    const { service, assessments } = serviceWithAssessment(assessment);

    await expect(
      service.requireInstructorForAssessment(request({ mutation: true }), COURSE_ID, "quiz-1", true)
    ).resolves.toEqual({ principal: expect.objectContaining({ canvasUserId: USER_ID }), assessment });
    expect(assessments.getAssessmentRecord).toHaveBeenCalledWith("classicquiz_quiz-1");
  });

  it("authorizes an exact New Quiz course and assignment binding", async () => {
    const assessment = newQuizAssessment();
    const { service, assessments } = serviceWithAssessment(assessment);

    await expect(
      service.requireInstructorForAssessment(
        request({ mutation: true }),
        COURSE_ID,
        "newquiz:course-1:assignment-99",
        true
      )
    ).resolves.toEqual({ principal: expect.objectContaining({ courseId: COURSE_ID }), assessment });
    expect(assessments.getAssessmentRecord).toHaveBeenCalledWith("newquiz:course-1:assignment-99");
  });

  it("rejects learners even when their action token is otherwise valid", async () => {
    const { service } = serviceWithAssessment(classicAssessment());
    await expectHttpError(
      () =>
        service.requireInstructorForAssessment(
          request({ mutation: true, roles: [LEARNER_ROLE] }),
          COURSE_ID,
          "quiz-1",
          true
        ),
      403,
      "INSTRUCTOR_ACCESS_DENIED"
    );
  });

  it("rejects legacy launch aliases instead of treating them as verified identity", async () => {
    const { service, assessments } = serviceWithAssessment(classicAssessment());
    const token = actionToken(SESSION_ID);
    const legacyRequest = {
      sessionID: SESSION_ID,
      session: {
        launchData: { userId: USER_ID, courseId: COURSE_ID, roles: [INSTRUCTOR_ROLE] },
        userId: USER_ID,
        courseId: COURSE_ID,
        canvas_user_id: USER_ID,
        canvas_course_id: COURSE_ID
      },
      header: (name: string) => (name.toLowerCase() === "x-auth-token" ? token : undefined)
    };

    await expectHttpError(
      () => service.requireInstructorForAssessment(legacyRequest as any, COURSE_ID, "quiz-1", true),
      401,
      "NO_USER_SESSION"
    );
    expect(assessments.getAssessmentRecord).not.toHaveBeenCalled();
  });

  it("rejects a valid action token when there is no verified LTI session", async () => {
    const { service, assessments } = serviceWithAssessment(classicAssessment());
    const tokenOnlyRequest = {
      sessionID: SESSION_ID,
      session: {},
      header: (name: string) => (name.toLowerCase() === "x-auth-token" ? actionToken(SESSION_ID) : undefined)
    };

    await expectHttpError(
      () => service.requireInstructorForAssessment(tokenOnlyRequest as any, COURSE_ID, "quiz-1", true),
      401,
      "NO_USER_SESSION"
    );
    expect(assessments.getAssessmentRecord).not.toHaveBeenCalled();
  });

  it("rejects a token copied from a different Express session", async () => {
    const { service, assessments } = serviceWithAssessment(classicAssessment());

    await expectHttpError(
      () =>
        service.requireInstructorForAssessment(
          request({ mutation: true, tokenSessionId: "attacker-session" }),
          COURSE_ID,
          "quiz-1",
          true
        ),
      403,
      "REQUEST_INTEGRITY_FAILED"
    );
    expect(assessments.getAssessmentRecord).not.toHaveBeenCalled();
  });

  it("requires the session-bound action token on every mutation", async () => {
    const { service, assessments } = serviceWithAssessment(classicAssessment());

    await expectHttpError(
      () => service.requireInstructorForAssessment(request(), COURSE_ID, "quiz-1", true),
      403,
      "REQUEST_INTEGRITY_FAILED"
    );
    expect(assessments.getAssessmentRecord).not.toHaveBeenCalled();
  });

  it("rejects course mismatch before loading an assessment", async () => {
    const { service, assessments } = serviceWithAssessment(classicAssessment());

    await expectHttpError(
      () => service.requireInstructorForAssessment(request(), "other-course", "quiz-1"),
      403,
      "COURSE_ACCESS_DENIED"
    );
    expect(assessments.getAssessmentRecord).not.toHaveBeenCalled();
  });

  it("fails closed when the stored Classic Quiz belongs to another course", async () => {
    const { service } = serviceWithAssessment(classicAssessment({ courseId: "other-course" }));

    await expectHttpError(
      () => service.requireInstructorForAssessment(request(), COURSE_ID, "quiz-1"),
      404,
      "ASSESSMENT_NOT_FOUND"
    );
  });

  it("fails closed when the stored Classic Canvas quiz id differs", async () => {
    const mismatched = classicAssessment({
      canvas: { id: "different-quiz", quizId: "different-quiz", title: "Different Quiz" }
    });
    const { service } = serviceWithAssessment(mismatched);

    await expectHttpError(
      () => service.requireInstructorForAssessment(request(), COURSE_ID, "quiz-1"),
      404,
      "ASSESSMENT_NOT_FOUND"
    );
  });

  it("fails closed when canonical lookup returns a different record id or content type", async () => {
    const wrongId = classicAssessment({ id: "classicquiz_different-quiz" });
    const { service: wrongIdService } = serviceWithAssessment(wrongId);
    await expectHttpError(
      () => wrongIdService.requireInstructorForAssessment(request(), COURSE_ID, "quiz-1"),
      404,
      "ASSESSMENT_NOT_FOUND"
    );

    const wrongType = classicAssessment({ contentType: "NEW_QUIZ" });
    const { service: wrongTypeService } = serviceWithAssessment(wrongType);
    await expectHttpError(
      () => wrongTypeService.requireInstructorForAssessment(request(), COURSE_ID, "quiz-1"),
      404,
      "ASSESSMENT_NOT_FOUND"
    );
  });

  it("fails closed when either stored New Quiz assignment identity differs", async () => {
    const assignmentMismatch = newQuizAssessment({
      canvas: { id: "assignment-99", assignmentId: "different-assignment", title: "New Quiz" }
    });
    const { service: assignmentService } = serviceWithAssessment(assignmentMismatch);
    await expectHttpError(
      () => assignmentService.requireInstructorForAssessment(request(), COURSE_ID, "newquiz:course-1:assignment-99"),
      404,
      "ASSESSMENT_NOT_FOUND"
    );

    const canvasIdMismatch = newQuizAssessment({
      canvas: { id: "different-assignment", assignmentId: "assignment-99", title: "New Quiz" }
    });
    const { service: canvasIdService } = serviceWithAssessment(canvasIdMismatch);
    await expectHttpError(
      () => canvasIdService.requireInstructorForAssessment(request(), COURSE_ID, "newquiz:course-1:assignment-99"),
      404,
      "ASSESSMENT_NOT_FOUND"
    );
  });

  it("rejects cross-origin browser reads but permits the tool origin", async () => {
    const { service } = serviceWithAssessment(classicAssessment());

    await expectHttpError(
      () => service.requireInstructorForAssessment(request({ origin: "https://evil.example" }), COURSE_ID, "quiz-1"),
      403,
      "REQUEST_ORIGIN_REJECTED"
    );
    await expect(
      service.requireInstructorForAssessment(request({ origin: "https://tool.example.edu" }), COURSE_ID, "quiz-1")
    ).resolves.toBeTruthy();
  });
});

interface RequestOptions {
  mutation?: boolean;
  roles?: string[];
  sessionId?: string;
  tokenSessionId?: string;
  origin?: string;
}

function configDouble() {
  return {
    getRequiredToolUrl: () => "https://tool.example.edu",
    value: { security: { sessionSecret: SESSION_SECRET } }
  };
}

function serviceWithAssessment(assessment: Record<string, unknown> | null) {
  const assessments = { getAssessmentRecord: vi.fn().mockResolvedValue(assessment) };
  return {
    service: new AssessmentAuthorizationService(configDouble() as any, assessments as any),
    assessments
  };
}

function request(options: RequestOptions = {}): any {
  const sessionId = options.sessionId || SESSION_ID;
  const token = options.mutation ? actionToken(options.tokenSessionId || sessionId) : undefined;
  const headers = new Map<string, string>();
  if (token) {
    headers.set("x-auth-token", token);
  }
  if (options.origin) {
    headers.set("origin", options.origin);
  }
  return {
    sessionID: sessionId,
    session: {
      verifiedLtiPrincipal: {
        version: 1,
        issuer: "https://canvas.example.edu",
        deploymentId: DEPLOYMENT_ID,
        subject: SUBJECT,
        canvasUserId: USER_ID,
        courseId: COURSE_ID,
        roles: options.roles || [INSTRUCTOR_ROLE],
        custom: {},
        authenticatedAt: "2026-07-13T00:00:00.000Z"
      }
    },
    header: (name: string) => headers.get(name.toLowerCase())
  };
}

function actionToken(sessionId: string): string {
  return createActionToken(configDouble() as any, USER_ID, COURSE_ID, {
    subject: SUBJECT,
    deploymentId: DEPLOYMENT_ID,
    sessionId
  });
}

function classicAssessment(overrides: Record<string, unknown> = {}) {
  return {
    id: "classicquiz_quiz-1",
    courseId: COURSE_ID,
    contentType: "CLASSIC_QUIZ",
    canvas: { id: "quiz-1", quizId: "quiz-1", title: "Quiz 1" },
    seb: assessmentSebState(),
    ...overrides
  };
}

function newQuizAssessment(overrides: Record<string, unknown> = {}) {
  return {
    id: "newquiz:course-1:assignment-99",
    courseId: COURSE_ID,
    contentType: "NEW_QUIZ",
    canvas: { id: "assignment-99", assignmentId: "assignment-99", title: "New Quiz" },
    seb: assessmentSebState(),
    ...overrides
  };
}

function assessmentSebState() {
  return {
    required: false,
    enabled: false,
    usesCourseDefaults: true,
    quitPasswordOverride: false,
    startPasswordOverride: false,
    ssoDomains: [],
    educationalToolDomains: [],
    customDomains: [],
    urlRules: [],
    externalTools: []
  };
}

async function expectHttpError(run: () => Promise<unknown>, status: number, errorCode?: string): Promise<void> {
  try {
    await run();
    throw new Error("Expected HTTP error");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    if (errorCode) {
      expect(exception.getResponse()).toMatchObject({ error_code: errorCode });
    }
  }
}
