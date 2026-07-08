import { Injectable } from "@nestjs/common";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { LtiLaunchData } from "../../shared/models.js";
import { AppConfig } from "../config/app-config.js";

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
    const { payload } = await jwtVerify(idToken, this.getJwks(), {
      issuer: this.config.value.lti.issuer,
      audience: clientId
    });
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
    if (!isAllowedDeploymentId(this.config.value.lti.deploymentId, payload[LTI_CLAIMS.deploymentId])) {
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
  const courseIdFromAgs = extractCourseIdFromAgs(ags);
  const courseIdFromCustom = asString(custom.canvas_course_id);
  const courseIdFromContext = asString(context.id);
  return {
    userId: String(payload.sub || ""),
    fullName: asString(payload.name),
    email: asString(payload.email),
    courseId: resolveCanvasCourseId(courseIdFromCustom, courseIdFromAgs, courseIdFromContext),
    courseName: asString(context.title) || asString(context.label),
    roles,
    deploymentId: asString(payload[LTI_CLAIMS.deploymentId]),
    targetLinkUri: asString(payload[LTI_CLAIMS.targetLinkUri]),
    messageType: asString(payload[LTI_CLAIMS.messageType]),
    ltiVersion: asString(payload[LTI_CLAIMS.version]),
    resourceLinkId: asString(resourceLink.id),
    resourceLinkTitle: asString(resourceLink.title),
    resourceLinkDescription: asString(resourceLink.description),
    custom: stringifyRecord(custom),
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

function extractCourseIdFromAgs(ags: Record<string, any>): string | undefined {
  const lineItems = asString(ags.lineitems) || asString(ags.lineitem);
  const match = lineItems?.match(/\/courses\/(\d+)\/line_items/u);
  return match?.[1];
}

function resolveCanvasCourseId(
  customCourseId: string | undefined,
  agsCourseId: string | undefined,
  contextId: string | undefined
): string | undefined {
  return firstNumeric(customCourseId, agsCourseId, contextId) || customCourseId || agsCourseId || contextId;
}

function firstNumeric(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => !!value && /^\d+$/u.test(value));
}

export function isAllowedDeploymentId(configuredDeploymentIds: string | undefined, actual: unknown): boolean {
  if (!configuredDeploymentIds?.trim()) {
    return true;
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
