import { ConflictException } from "@nestjs/common";

export class AssessmentAccessCodeConsistencyError extends Error {
  constructor(
    message: string,
    cause?: unknown,
    readonly compensationError?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AssessmentAccessCodeConsistencyError";
  }
}

export class AssessmentOperationLockLostError extends Error {
  constructor(cause?: unknown) {
    super(
      "The assessment update lock was lost before the operation completed. The result was not accepted as successful; verify the assessment state before retrying.",
      cause === undefined ? undefined : { cause }
    );
    this.name = "AssessmentOperationLockLostError";
  }
}

export class AssessmentOperationInProgressError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "ASSESSMENT_UPDATE_IN_PROGRESS",
      message: "Another SEB update is already in progress for this assessment. Try again shortly."
    });
    this.name = "AssessmentOperationInProgressError";
  }
}

export class AssessmentNoLongerAvailableError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "ASSESSMENT_NO_LONGER_AVAILABLE",
      message: "This assessment is no longer available. Refresh the course before making another change."
    });
    this.name = "AssessmentNoLongerAvailableError";
  }
}

export class CourseResetInProgressError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "COURSE_RESET_IN_PROGRESS",
      message: "A Canvas administrator is resetting this course. Wait for the reset to finish, then try again."
    });
    this.name = "CourseResetInProgressError";
  }
}

export class CourseResetAssessmentIdentityError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "COURSE_RESET_ASSESSMENT_IDENTITY_UNAVAILABLE",
      message:
        "Canvas did not provide an assessment identifier required for reset. Course records were not deleted; refresh the course and retry."
    });
    this.name = "CourseResetAssessmentIdentityError";
  }
}

export class CourseResetCompensationError extends Error {
  constructor(
    cause: unknown,
    readonly compensationErrors: readonly unknown[]
  ) {
    super(
      "One or more Canvas assessment access codes could not be restored after the course reset stopped. Manual verification is required.",
      { cause }
    );
    this.name = "CourseResetCompensationError";
  }
}

export class CourseResetOutcomeUnknownError extends Error {
  constructor(
    cause: unknown,
    readonly verificationError: unknown
  ) {
    super(
      "The database reset outcome could not be verified. The reset may have committed; manual verification is required before retrying.",
      { cause }
    );
    this.name = "CourseResetOutcomeUnknownError";
  }
}

export class CourseMutationInProgressError extends ConflictException {
  constructor() {
    super({
      success: false,
      statusCode: 409,
      error_code: "COURSE_UPDATE_IN_PROGRESS",
      message: "Another course update is already in progress. Wait for it to finish, then try again."
    });
    this.name = "CourseMutationInProgressError";
  }
}

export class CourseMutationOperationLockLostError extends ConflictException {
  constructor(cause?: unknown) {
    super(
      {
        success: false,
        statusCode: 409,
        error_code: "COURSE_UPDATE_VERIFY_REQUIRED",
        message: "The course update could not be confirmed. Refresh the course and verify its current settings."
      },
      cause === undefined ? undefined : { cause }
    );
    this.name = "CourseMutationOperationLockLostError";
  }
}

export class CourseResetOperationLockLostError extends Error {
  constructor(cause?: unknown) {
    super(
      "The course reset lock was lost before completion could be confirmed. The reset may have completed; refresh the course and verify Canvas assessment access codes before retrying.",
      cause === undefined ? undefined : { cause }
    );
    this.name = "CourseResetOperationLockLostError";
  }
}
