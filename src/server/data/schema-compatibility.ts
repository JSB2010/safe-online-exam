export const STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE = "strict";
export const GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE = "google-docs-stage2-v7";

export type DatabaseSchemaCompatibilityProfile =
  typeof STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE | typeof GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE;

export function normalizeDatabaseSchemaCompatibilityProfile(value?: string): string {
  return value?.trim().toLowerCase() || STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE;
}

export function isDatabaseSchemaCompatibilityProfile(value: string): value is DatabaseSchemaCompatibilityProfile {
  return (
    value === STRICT_DATABASE_SCHEMA_COMPATIBILITY_PROFILE ||
    value === GOOGLE_DOCS_STAGE2_V7_SCHEMA_COMPATIBILITY_PROFILE
  );
}
