import type { LtiLaunchData } from "../../shared/models.js";
import type { VerifiedLtiPrincipal } from "../security/verified-lti-principal.js";

declare module "express-session" {
  interface SessionData {
    launchData?: LtiLaunchData;
    verifiedLtiPrincipal?: VerifiedLtiPrincipal;
    ltiLaunchData?: LtiLaunchData;
    target_link_uri?: string;
    canvas_user_id?: string;
    canvas_course_id?: string;
    userId?: string;
    user_id?: string;
    courseId?: string;
    authToken?: string;
    oauthState?: Record<string, unknown>;
    pendingSebLaunch?: {
      courseId: string;
      contentId: string;
      subject: string;
      deploymentId: string;
      issuedAt: number;
    };
    completedSebLaunch?: {
      courseId: string;
      contentId: string;
      issuedAt: number;
    };
  }
}
