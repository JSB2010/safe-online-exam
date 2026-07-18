import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AppConfig } from "../config/app-config.js";
import { apiError, noUserSession } from "../http/api-error.js";
import { requireAdminManagementRequestIntegrity, requireSameOriginRequest } from "../http/request-integrity.js";
import {
  isVerifiedAccountAdmin,
  type VerifiedAccountAdminPrincipal,
  verifiedLtiPrincipal
} from "../security/verified-lti-principal.js";
import { CanvasApiService, type CanvasAdminCourse } from "./canvas-api.service.js";

@Injectable()
export class AdminAuthorizationService {
  constructor(
    private readonly config: AppConfig,
    private readonly canvasApi: CanvasApiService
  ) {}

  requireAdmin(request: Request, mutation = false): VerifiedAccountAdminPrincipal {
    const principal = verifiedLtiPrincipal(request);
    if (!principal) {
      return noUserSession();
    }
    if (!isVerifiedAccountAdmin(principal)) {
      return apiError(403, "Root-account administrator access is required", {
        error_code: "ACCOUNT_ADMIN_ACCESS_DENIED"
      });
    }
    if (mutation) {
      requireAdminManagementRequestIntegrity(request, this.config, principal);
    } else {
      requireSameOriginRequest(request, this.config, "administrator read");
    }
    return principal;
  }

  async requireAdminForCourse(
    request: Request,
    courseId: string,
    mutation = false
  ): Promise<{ principal: VerifiedAccountAdminPrincipal; course: CanvasAdminCourse }> {
    const principal = this.requireAdmin(request, mutation);
    if (!/^\d+$/u.test(courseId)) {
      return apiError(404, "Course not found", { error_code: "COURSE_NOT_FOUND" });
    }
    const course = await this.canvasApi.getAdminCourse(courseId, principal.canvasUserId);
    let courseRootAccountId = course.rootAccountId;
    if (!courseRootAccountId) {
      const account = await this.canvasApi.getAdminAccount(course.accountId, principal.canvasUserId);
      courseRootAccountId = account.rootAccountId;
    }
    if (courseRootAccountId !== principal.rootAccountId) {
      return apiError(403, "Administrator access is not valid for this course", {
        error_code: "ADMIN_COURSE_ACCESS_DENIED"
      });
    }
    const permissions = await this.canvasApi.getAdminPermissions(course.accountId, principal.canvasUserId, [
      "manage_course_content_edit"
    ]);
    if (permissions.manage_course_content_edit !== true) {
      return apiError(403, "Canvas has not granted this administrator permission to manage this course", {
        error_code: "ADMIN_COURSE_PERMISSION_DENIED"
      });
    }
    return { principal, course: { ...course, rootAccountId: courseRootAccountId } };
  }
}
