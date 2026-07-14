import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { AssessmentRecord } from "../../shared/models.js";
import { canonicalAssessmentId, extractClassicQuizId, parseNewQuizContentId } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";
import { apiError, noUserSession } from "../http/api-error.js";
import { requireManagementRequestIntegrity } from "../http/request-integrity.js";
import {
  isVerifiedInstructor,
  type VerifiedLtiPrincipal,
  verifiedLtiPrincipal
} from "../security/verified-lti-principal.js";
import { AssessmentService } from "./assessment.service.js";

export interface AuthorizedAssessmentContext {
  principal: VerifiedLtiPrincipal;
  assessment: AssessmentRecord;
}

@Injectable()
export class AssessmentAuthorizationService {
  constructor(
    private readonly config: AppConfig,
    private readonly assessments: AssessmentService
  ) {}

  requireInstructor(request: Request, mutation = false): VerifiedLtiPrincipal {
    const principal = verifiedLtiPrincipal(request);
    if (!principal) {
      return noUserSession();
    }
    if (!isVerifiedInstructor(principal)) {
      return apiError(403, "Instructor access is required", { error_code: "INSTRUCTOR_ACCESS_DENIED" });
    }
    this.requireSameOriginForRead(request);
    if (mutation) {
      requireManagementRequestIntegrity(request, this.config, principal);
    }
    return principal;
  }

  requireInstructorForCourse(request: Request, courseId: string, mutation = false): VerifiedLtiPrincipal {
    const principal = this.requireInstructor(request, mutation);
    if (principal.courseId !== courseId) {
      return apiError(403, "Instructor access is required for this course", {
        error_code: "COURSE_ACCESS_DENIED"
      });
    }
    return principal;
  }

  async requireInstructorForAssessment(
    request: Request,
    courseId: string,
    contentId: string,
    mutation = false
  ): Promise<AuthorizedAssessmentContext> {
    const principal = this.requireInstructorForCourse(request, courseId, mutation);
    const canonicalId = canonicalAssessmentId(contentId);
    const assessment = await this.assessments.getAssessmentRecord(canonicalId);
    if (!assessment || assessment.courseId !== courseId || assessment.id !== canonicalId) {
      return apiError(404, "Assessment not found", { error_code: "ASSESSMENT_NOT_FOUND" });
    }
    const parsed = parseNewQuizContentId(contentId);
    if (parsed) {
      if (
        assessment.contentType !== "NEW_QUIZ" ||
        parsed.courseId !== courseId ||
        assessment.canvas.assignmentId !== parsed.assignmentId ||
        assessment.canvas.id !== parsed.assignmentId
      ) {
        return apiError(404, "Assessment not found", { error_code: "ASSESSMENT_NOT_FOUND" });
      }
    } else {
      const quizId = extractClassicQuizId(contentId);
      if (
        !quizId ||
        assessment.contentType !== "CLASSIC_QUIZ" ||
        (assessment.canvas.quizId || assessment.canvas.id) !== quizId
      ) {
        return apiError(404, "Assessment not found", { error_code: "ASSESSMENT_NOT_FOUND" });
      }
    }
    return { principal, assessment };
  }

  private requireSameOriginForRead(request: Request): void {
    const origin = request.header("origin");
    if (!origin) {
      return;
    }
    try {
      if (new URL(origin).origin === new URL(this.config.getRequiredToolUrl()).origin) {
        return;
      }
    } catch {
      // Fall through to the same generic denial.
    }
    apiError(403, "Cross-origin management request rejected", { error_code: "REQUEST_ORIGIN_REJECTED" });
  }
}
