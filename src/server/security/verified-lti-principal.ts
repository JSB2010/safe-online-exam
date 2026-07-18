import type { Request } from "express";
import type { LtiLaunchData } from "../../shared/models.js";
import { isAccountAdministrator, isInstructor, isStudent } from "../../shared/models.js";

interface VerifiedLtiPrincipalBase {
  version: 1;
  issuer: string;
  deploymentId: string;
  subject: string;
  canvasUserId: string;
  roles: string[];
  custom: Record<string, string>;
  authenticatedAt: string;
}

export interface VerifiedCourseLtiPrincipal extends VerifiedLtiPrincipalBase {
  contextType?: "course";
  courseId: string;
  accountId?: string;
  rootAccountId?: string;
  isRootAccountAdmin?: false;
}

export interface VerifiedAccountAdminPrincipal extends VerifiedLtiPrincipalBase {
  contextType: "account";
  courseId: "";
  accountId: string;
  rootAccountId: string;
  isRootAccountAdmin: true;
}

export type VerifiedLtiPrincipal = VerifiedCourseLtiPrincipal | VerifiedAccountAdminPrincipal;

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
  if (!subject || !issuer || !deploymentId) {
    throw new Error("Validated LTI launch is missing required principal claims");
  }
  const custom = { ...(launchData.custom || {}) };
  if (custom.seb_launch_surface === "account_admin") {
    const accountId = custom.canvas_account_id;
    const rootAccountId = custom.canvas_root_account_id;
    if (!isCanvasRestUserId(accountId) || !isCanvasRestUserId(rootAccountId)) {
      throw new Error("Validated root-account launch is missing signed numeric account identifiers");
    }
    if (custom.canvas_user_is_root_account_admin !== "true") {
      throw new Error("Validated root-account launch does not identify a Canvas root-account administrator");
    }
    if (!isAccountAdministrator({ roles: launchData.roles, custom })) {
      throw new Error("Validated root-account launch is missing a signed Canvas administrator role");
    }
    return {
      version: 1,
      contextType: "account",
      issuer,
      deploymentId,
      subject,
      canvasUserId,
      courseId: "",
      accountId,
      rootAccountId,
      isRootAccountAdmin: true,
      roles: [...launchData.roles],
      custom,
      authenticatedAt: new Date().toISOString()
    };
  }
  if (!courseId) {
    throw new Error("Validated course launch is missing required course context");
  }
  return {
    version: 1,
    issuer,
    deploymentId,
    subject,
    canvasUserId,
    courseId,
    roles: [...launchData.roles],
    custom,
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
    !Array.isArray(principal.roles) ||
    !principal.custom ||
    typeof principal.custom !== "object"
  ) {
    return null;
  }
  if (principal.contextType === "account") {
    if (
      principal.courseId !== "" ||
      !isCanvasRestUserId(principal.accountId) ||
      !isCanvasRestUserId(principal.rootAccountId) ||
      principal.isRootAccountAdmin !== true
    ) {
      return null;
    }
  } else if (!principal.courseId) {
    return null;
  }
  return principal;
}

export function isVerifiedInstructor(principal: VerifiedLtiPrincipal): principal is VerifiedCourseLtiPrincipal {
  return principal.contextType !== "account" && isInstructor({ roles: principal.roles, custom: principal.custom });
}

export function isVerifiedStudent(principal: VerifiedLtiPrincipal): principal is VerifiedCourseLtiPrincipal {
  return principal.contextType !== "account" && isStudent({ roles: principal.roles, custom: principal.custom });
}

export function isVerifiedAccountAdmin(principal: VerifiedLtiPrincipal): principal is VerifiedAccountAdminPrincipal {
  return (
    principal.contextType === "account" &&
    principal.isRootAccountAdmin === true &&
    isAccountAdministrator({ roles: principal.roles, custom: principal.custom })
  );
}
