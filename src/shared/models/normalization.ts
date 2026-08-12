export function normalizeOptionalText(value?: string | null): string | null {
  return value?.trim() ? value.trim() : null;
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function sanitizeToolId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "external-tool";
}
