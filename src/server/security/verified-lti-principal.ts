import type { Request } from "express";
import type { LtiLaunchData } from "../../shared/models.js";
import { isInstructor } from "../../shared/models.js";

export interface VerifiedLtiPrincipal {
  version: 1;
  issuer: string;
  deploymentId: string;
  subject: string;
  canvasUserId: string;
  courseId: string;
  roles: string[];
  custom: Record<string, string>;
  authenticatedAt: string;
}

export class CanvasLtiConfigurationError extends Error {
  constructor() {
    super("Canvas launch is missing the signed numeric Canvas user id");
  }
}

export function isCanvasRestUserId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/u.test(value);
}

export function createVerifiedLtiPrincipal(launchData: LtiLaunchData): VerifiedLtiPrincipal {
  const subject = launchData.ltiSubject || launchData.userId;
  const canvasUserId = launchData.canvasUserId || launchData.custom?.canvas_user_id;
  const issuer = launchData.issuer;
  const deploymentId = launchData.deploymentId;
  const courseId = launchData.courseId;
  if (!isCanvasRestUserId(canvasUserId)) {
    throw new CanvasLtiConfigurationError();
  }
  if (!subject || !issuer || !deploymentId || !courseId) {
    throw new Error("Validated LTI launch is missing required principal claims");
  }
  return {
    version: 1,
    issuer,
    deploymentId,
    subject,
    canvasUserId,
    courseId,
    roles: [...launchData.roles],
    custom: { ...(launchData.custom || {}) },
    authenticatedAt: new Date().toISOString()
  };
}

export function verifiedLtiPrincipal(request: Request): VerifiedLtiPrincipal | null {
  const principal = request.session?.verifiedLtiPrincipal;
  if (
    principal?.version !== 1 ||
    !principal.issuer ||
    !principal.deploymentId ||
    !principal.subject ||
    !principal.canvasUserId ||
    !principal.courseId ||
    !Array.isArray(principal.roles) ||
    !principal.custom ||
    typeof principal.custom !== "object"
  ) {
    return null;
  }
  return principal;
}

export function isVerifiedInstructor(principal: VerifiedLtiPrincipal): boolean {
  return isInstructor({ roles: principal.roles, custom: principal.custom });
}
