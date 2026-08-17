import { LtiLaunchData } from "./canvas.js";

type RoleAwareLaunchData = Pick<LtiLaunchData, "roles" | "custom">;

const instructorContextRoles = new Set(["administrator", "contentdeveloper", "instructor"]);

const studentContextRoles = new Set(["learner"]);

const studentInstitutionRoles = new Set(["student", "learner"]);

export function isInstructor(launchData?: RoleAwareLaunchData | null): boolean {
  if (!launchData) {
    return false;
  }
  return launchData.roles.some(isContextInstructorRole);
}

export function isStudent(launchData?: RoleAwareLaunchData | null): boolean {
  if (!launchData) {
    return false;
  }
  return launchData.roles.some(isContextStudentRole) || launchData.roles.some(isInstitutionStudentRole);
}

export function isAccountAdministrator(launchData?: RoleAwareLaunchData | null): boolean {
  if (!launchData) {
    return false;
  }
  return launchData.roles.some((role) => {
    const context = parseContextRole(role);
    const institution = parseInstitutionRole(role);
    return context?.principal === "administrator" || institution === "administrator" || isSystemAdministratorRole(role);
  });
}

function isContextInstructorRole(role: string): boolean {
  const parsed = parseContextRole(role);
  return !!parsed && instructorContextRoles.has(parsed.principal);
}

function isContextStudentRole(role: string): boolean {
  const parsed = parseContextRole(role);
  return !!parsed && studentContextRoles.has(parsed.principal);
}

function isInstitutionStudentRole(role: string): boolean {
  const parsed = parseInstitutionRole(role);
  return !!parsed && studentInstitutionRoles.has(parsed);
}

function parseContextRole(role: string): { principal: string; subRole?: string } | null {
  const value = role.trim();
  const normalized = value.toLowerCase();
  if (!normalized || normalized.startsWith("$")) {
    return null;
  }
  const contextPrefix = "http://purl.imsglobal.org/vocab/lis/v2/membership";
  if (normalized.startsWith(`${contextPrefix}#`)) {
    return { principal: normalized.slice(`${contextPrefix}#`.length) };
  }
  if (normalized.startsWith(`${contextPrefix}/`)) {
    const [principal, subRole] = normalized.slice(`${contextPrefix}/`.length).split("#", 2);
    return principal ? { principal, subRole } : null;
  }
  const legacyContextMatch = normalized.match(/^urn:lti:(?:role:)?ims\/lis\/([^/#:]+)(?:[#/:](.+))?$/u);
  if (legacyContextMatch?.[1]) {
    return { principal: legacyContextMatch[1], subRole: legacyContextMatch[2] };
  }
  if (/^[a-z]+$/u.test(normalized)) {
    return { principal: normalized };
  }
  return null;
}

function parseInstitutionRole(role: string): string | null {
  const normalized = role.trim().toLowerCase();
  const institutionPrefix = "http://purl.imsglobal.org/vocab/lis/v2/institution/person#";
  if (normalized.startsWith(institutionPrefix)) {
    return normalized.slice(institutionPrefix.length);
  }
  return null;
}

function isSystemAdministratorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "http://purl.imsglobal.org/vocab/lis/v2/system/person#sysadmin" ||
    normalized === "urn:lti:sysrole:ims/lis/sysadmin"
  );
}
