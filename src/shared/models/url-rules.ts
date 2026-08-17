import { sanitizeToolId, uniqueStrings } from "./normalization.js";

export type SebUrlRuleMatch = "exact" | "domain" | "regex";

export interface SebUrlRule {
  id: string;
  value: string;
  match: SebUrlRuleMatch;
}

export function normalizeUrlRules(input?: SebUrlRule[] | string[] | null): SebUrlRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.slice(0, 32).flatMap((entry, index) => {
    const candidate = normalizeUrlRule(entry, index);
    if (!candidate) {
      return [];
    }
    const dedupeKey = `${candidate.match}:${candidate.value.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return [];
    }
    seen.add(dedupeKey);
    return [candidate];
  });
}

export function isUnsafeBroadUrlPattern(value?: string | null): boolean {
  const stripped = stripRulePrefix(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "");
  if (!stripped) {
    return true;
  }
  const normalizedRegexDots = stripped.replace(/\\\./gu, ".");
  const withoutAnchors = normalizedRegexDots.replace(/^\^/u, "").replace(/\$$/u, "");
  return (
    [
      "*",
      "*/*",
      ".*",
      "https://*/*",
      "http://*/*",
      "https?://.*",
      "https://.*",
      "http://.*",
      "*.com",
      "*.org",
      "*.net",
      "*.edu",
      "*.amazonaws.com",
      "*.s3.amazonaws.com"
    ].includes(withoutAnchors) ||
    /^(?:https?:\/\/)?\*\.[a-z]{2,}(?:\/\*)?$/u.test(withoutAnchors) ||
    /^https\?:\/\/\.\*$/u.test(withoutAnchors) ||
    /^https?:\/\/\.\*$/u.test(withoutAnchors)
  );
}

export function legacyDomainsToUrlRules(input?: string[] | null): SebUrlRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const rules: SebUrlRule[] = input
    .filter((entry) => !entry.trim().startsWith("regex:"))
    .map((entry, index) => ({
      id: `domain-${index + 1}`,
      value: stripRulePrefix(entry),
      match: entry.trim().startsWith("exact:") ? "exact" : "domain"
    }));
  return normalizeUrlRules(rules);
}

export function urlRulesToAllowedEntries(input?: SebUrlRule[] | null): string[] {
  return normalizeUrlRules(input)
    .map((rule) => {
      switch (rule.match) {
        case "exact":
          return `exact:${normalizeRuleUrl(rule.value) || rule.value}`;
        case "regex":
          return "";
        case "domain":
        default:
          return `domain:${normalizeDomainRule(rule.value) || rule.value}`;
      }
    })
    .filter(Boolean);
}

function normalizeUrlRule(entry: SebUrlRule | string, index: number): SebUrlRule | null {
  if (typeof entry === "string") {
    const stripped = stripRulePrefix(entry);
    return stripped && !entry.trim().startsWith("regex:")
      ? normalizeUrlRule(
          {
            id: `rule-${index + 1}`,
            value: stripped,
            match: entry.startsWith("exact:") ? "exact" : "domain"
          },
          index
        )
      : null;
  }
  const value = entry.value?.trim();
  const match = normalizeUrlRuleMatch(entry.match) || "domain";
  if (!value || match === "regex" || value.includes("*")) {
    return null;
  }
  if (isUnsafeBroadUrlPattern(value)) {
    return null;
  }
  if (match === "exact" && !normalizeRuleUrl(value)) {
    return null;
  }
  if (match === "domain" && !normalizeDomainRule(value)) {
    return null;
  }
  return {
    id: sanitizeToolId(entry.id || `${match}-${index + 1}`),
    value: match === "exact" ? normalizeRuleUrl(value)! : match === "domain" ? normalizeDomainRule(value)! : value,
    match
  };
}

function normalizeUrlRuleMatch(value?: string | null): SebUrlRuleMatch | null {
  if (value === "exact" || value === "domain" || value === "regex") {
    return value;
  }
  return null;
}

function normalizeRuleUrl(value: string): string | null {
  const trimmed = stripRulePrefix(value);
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.toString().length > 2048 ||
      !normalizeConcreteHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeDomainRule(value: string): string | null {
  const stripped = stripRulePrefix(value).trim().toLowerCase();
  return normalizeConcreteHostname(stripped);
}

export function normalizeConcreteDomains(value?: string[] | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(
    value
      .slice(0, 32)
      .map((entry) => normalizeDomainRule(entry))
      .filter((entry): entry is string => !!entry)
  );
}

export function normalizeConcreteHostname(value: string): string | null {
  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.includes("*") || !hostname.includes(".")) {
    return null;
  }
  if (
    !hostname
      .split(".")
      .every((label) => !!label && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))
  ) {
    return null;
  }
  try {
    return new URL(`https://${hostname}`).hostname === hostname ? hostname : null;
  } catch {
    return null;
  }
}

function stripRulePrefix(value: string): string {
  return value.trim().replace(/^(?:exact|domain|regex):/iu, "");
}
