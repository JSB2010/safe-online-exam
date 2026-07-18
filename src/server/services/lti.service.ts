import { Injectable } from "@nestjs/common";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { assertLtiRoleClaimsConsistent, type LtiLaunchData } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";

const LTI_SIGNING_ALGORITHM = "RS256";
const LTI_CLOCK_TOLERANCE_SECONDS = 30;
const LTI_MAX_TOKEN_AGE_SECONDS = 5 * 60;

const LTI_CLAIMS = {
  version: "https://purl.imsglobal.org/spec/lti/claim/version",
  messageType: "https://purl.imsglobal.org/spec/lti/claim/message_type",
  deploymentId: "https://purl.imsglobal.org/spec/lti/claim/deployment_id",
  targetLinkUri: "https://purl.imsglobal.org/spec/lti/claim/target_link_uri",
  resourceLink: "https://purl.imsglobal.org/spec/lti/claim/resource_link",
  context: "https://purl.imsglobal.org/spec/lti/claim/context",
  roles: "https://purl.imsglobal.org/spec/lti/claim/roles",
  custom: "https://purl.imsglobal.org/spec/lti/claim/custom",
  toolPlatform: "https://purl.imsglobal.org/spec/lti/claim/tool_platform",
  ags: "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint"
} as const;

@Injectable()
export class LtiService {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig) {}

  async validateToken(idToken: string, expectedNonce: string): Promise<LtiLaunchData> {
    const clientId = this.config.value.lti.clientId;
    if (!clientId) {
      throw new Error("LTI client id is not configured");
    }
    const header = decodeProtectedHeader(idToken);
    if (!header.kid) {
      throw new Error("LTI token is missing kid");
    }
    if (header.alg !== LTI_SIGNING_ALGORITHM) {
      throw new Error("Unsupported LTI signing algorithm");
    }
    const { payload } = await jwtVerify(idToken, this.getJwks(), {
      issuer: this.config.value.lti.issuer,
      audience: clientId,
      algorithms: [LTI_SIGNING_ALGORITHM],
      clockTolerance: LTI_CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: LTI_MAX_TOKEN_AGE_SECONDS,
      requiredClaims: ["exp", "iat", "sub", "nonce"]
    });
    assertValidTemporalClaims(payload);
    if (payload.nonce !== expectedNonce) {
      throw new Error("Invalid LTI nonce");
    }
    if (payload[LTI_CLAIMS.version] !== "1.3.0") {
      throw new Error("Unsupported LTI version");
    }
    if (!payload[LTI_CLAIMS.messageType]) {
      throw new Error("Missing LTI message type");
    }
    if (!payload[LTI_CLAIMS.deploymentId]) {
      throw new Error("Missing LTI deployment id");
    }
    if (
      this.config.value.lti.deploymentIdCheckingEnabled !== false &&
      !isAllowedDeploymentId(this.config.value.lti.deploymentId, payload[LTI_CLAIMS.deploymentId])
    ) {
      throw new Error("Invalid LTI deployment id");
    }
    if (!payload[LTI_CLAIMS.targetLinkUri]) {
      throw new Error("Missing LTI target link URI");
    }
    return launchDataFromPayload(payload);
  }

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    this.jwks ||= createRemoteJWKSet(new URL(this.config.value.lti.keySetUrl));
    return this.jwks;
  }
}

export function launchDataFromPayload(payload: JWTPayload): LtiLaunchData {
  const custom = asRecord(payload[LTI_CLAIMS.custom]);
  const context = asRecord(payload[LTI_CLAIMS.context]);
  const resourceLink = asRecord(payload[LTI_CLAIMS.resourceLink]);
  const rawRoles = payload[LTI_CLAIMS.roles];
  const roles = Array.isArray(rawRoles) ? rawRoles.map(String) : [];
  const ags = asRecord(payload[LTI_CLAIMS.ags]);
  const courseIdFromCustom = asString(custom.canvas_course_id);
  const courseIdFromContext = asString(context.id);
  const accountAdminSurface = asString(custom.seb_launch_surface) === "account_admin";
  const ltiSubject = asString(payload.sub);
  if (!ltiSubject) {
    throw new Error("LTI token is missing subject");
  }
  const canvasUserId = asString(custom.canvas_user_id);
  const stringifiedCustom = stringifyRecord(custom);
  // Account-navigation launches do not have a course-membership context. Canvas may still
  // substitute enrollment roles for an administrator who also teaches or studies, so those
  // values cannot be compared with the account-level standard LTI roles. Account launches
  // are authorized separately from signed administrator, root-account, and account-id claims.
  if (!accountAdminSurface) {
    assertLtiRoleClaimsConsistent({ roles, custom: stringifiedCustom });
  }
  return {
    ltiSubject,
    canvasUserId,
    issuer: asString(payload.iss),
    userId: canvasUserId || ltiSubject,
    fullName: asString(payload.name),
    email: asString(payload.email),
    courseId: accountAdminSurface ? undefined : resolveCanvasCourseId(courseIdFromCustom, ags, courseIdFromContext),
    courseName: asString(context.title) || asString(context.label),
    roles,
    deploymentId: asString(payload[LTI_CLAIMS.deploymentId]),
    targetLinkUri: asString(payload[LTI_CLAIMS.targetLinkUri]),
    messageType: asString(payload[LTI_CLAIMS.messageType]),
    ltiVersion: asString(payload[LTI_CLAIMS.version]),
    resourceLinkId: asString(resourceLink.id),
    resourceLinkTitle: asString(resourceLink.title),
    resourceLinkDescription: asString(resourceLink.description),
    custom: stringifiedCustom,
    platform: asRecord(payload[LTI_CLAIMS.toolPlatform]),
    ags
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function stringifyRecord(value: Record<string, any>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, String(child)]));
}

function asString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function extractCourseIdsFromAgs(ags: Record<string, any>): Array<{ source: string; value: string }> {
  return ["lineitems", "lineitem"].flatMap((claim) => {
    const endpoint = asString(ags[claim]);
    if (!endpoint) {
      return [];
    }
    try {
      const pathname = new URL(endpoint).pathname;
      return [...pathname.matchAll(/\/courses\/(\d+)\/line_items(?:\/|$)/gu)].map((match) => ({
        source: `ags.${claim}`,
        value: match[1]!
      }));
    } catch {
      return [];
    }
  });
}

function resolveCanvasCourseId(
  customCourseId: string | undefined,
  ags: Record<string, any>,
  contextId: string | undefined
): string | undefined {
  const numericSources = [
    ...(isNumericId(customCourseId) ? [{ source: "custom.canvas_course_id", value: customCourseId }] : []),
    ...extractCourseIdsFromAgs(ags),
    ...(isNumericId(contextId) ? [{ source: "context.id", value: contextId }] : [])
  ];
  const numericCourseIds = new Set(numericSources.map(({ value }) => value));
  if (numericCourseIds.size > 1) {
    throw new Error("Conflicting signed LTI course claims");
  }
  const [numericCourseId] = numericCourseIds;
  return numericCourseId || customCourseId || contextId;
}

function isNumericId(value: string | undefined): value is string {
  return !!value && /^\d+$/u.test(value);
}

function assertValidTemporalClaims(payload: JWTPayload): void {
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp! <= payload.iat!) {
    throw new Error("Invalid LTI token timestamps");
  }
}

export function isAllowedDeploymentId(configuredDeploymentIds: string | undefined, actual: unknown): boolean {
  if (!configuredDeploymentIds?.trim()) {
    return false;
  }
  const actualValue = asString(actual);
  if (!actualValue) {
    return false;
  }
  return configuredDeploymentIds
    .split(/[,\n]/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(actualValue);
}
