import { sanitizeToolId, uniqueStrings } from "./normalization.js";
import { SebUrlRuleMatch, normalizeConcreteHostname } from "./url-rules.js";

export interface ExternalToolConfig {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  preset?: string | null;
  /** Server-owned marker for an administrator-managed school preset. */
  adminPresetId?: string | null;
  managedByAdmin?: boolean | null;
  /** Explicit, visible URL access beyond the launch page. */
  allowedRules?: ExternalToolAccessRule[] | null;
  /** @deprecated Legacy persisted representation. Normalized into allowedRules. */
  allowedDomains?: string[] | null;
  /** @deprecated Legacy persisted representation. */
  matchType?: SebUrlRuleMatch | null;
  /** @deprecated Legacy persisted representation. */
  allowedPattern?: string | null;
}

export type ExternalToolAccessMatch = "exact" | "path" | "domain";

export interface ExternalToolAccessRule {
  id: string;
  value: string;
  match: ExternalToolAccessMatch;
  /** Required when a custom rule permits an entire HTTPS domain. */
  broadDomainConfirmed?: boolean;
}

export const YOUTUBE_VIDEO_TOOL_PRESET = "youtube-video";

function isYouTubeHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./u, "");
  return host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com";
}

export function isYouTubeUrl(value?: string | null): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return isYouTubeHostname(new URL(candidate).hostname);
  } catch {
    return false;
  }
}

/**
 * Converts a share, watch, Shorts, or embed link into the one player URL that
 * the exam policy supports. A YouTube video ID is deliberately constrained to
 * its documented 11-character form so a custom URL cannot widen the policy.
 */
export function normalizeYouTubeVideoUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return null;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, "");
    let videoId: string | null = null;
    if (host === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || null;
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const path = parsed.pathname.split("/").filter(Boolean);
      if (path[0] === "watch") {
        videoId = parsed.searchParams.get("v");
      } else if (path[0] === "embed" || path[0] === "shorts") {
        videoId = path[1] || null;
      }
    }
    return videoId && /^[A-Za-z0-9_-]{11}$/u.test(videoId) ? `https://www.youtube.com/embed/${videoId}?rel=0` : null;
  } catch {
    return null;
  }
}

export function youtubeVideoId(tool: Pick<ExternalToolConfig, "preset" | "url">): string | null {
  if (tool.preset !== YOUTUBE_VIDEO_TOOL_PRESET) {
    return null;
  }
  const normalized = normalizeYouTubeVideoUrl(tool.url);
  return normalized ? new URL(normalized).pathname.split("/").at(-1) || null : null;
}

export function isYouTubeVideoTool(tool: Pick<ExternalToolConfig, "preset" | "url">): boolean {
  return youtubeVideoId(tool) !== null;
}

export const EXTERNAL_TOOL_PRESETS: ExternalToolConfig[] = [
  {
    id: "desmos-graphing",
    label: "Desmos Graphing Calculator",
    url: "https://www.desmos.com/calculator",
    enabled: false,
    preset: "desmos-graphing",
    allowedRules: [
      { id: "desmos-build", value: "https://www.desmos.com/assets/build/*", match: "path" },
      { id: "desmos-graphing-images", value: "https://www.desmos.com/assets/img/apps/graphing/*", match: "path" },
      { id: "desmos-pwa", value: "https://www.desmos.com/assets/pwa/*", match: "path" }
    ]
  },
  {
    id: "desmos-scientific",
    label: "Desmos Scientific Calculator",
    url: "https://www.desmos.com/scientific",
    enabled: false,
    preset: "desmos-scientific",
    allowedRules: [
      { id: "desmos-build", value: "https://www.desmos.com/assets/build/*", match: "path" },
      { id: "desmos-scientific-images", value: "https://www.desmos.com/assets/img/apps/scientific/*", match: "path" },
      { id: "desmos-pwa", value: "https://www.desmos.com/assets/pwa/*", match: "path" }
    ]
  },
  {
    id: "geogebra-graphing",
    label: "GeoGebra Graphing Calculator",
    url: "https://www.geogebra.org/graphing",
    enabled: false,
    preset: "geogebra-graphing",
    allowedRules: [
      { id: "geogebra-apps", value: "https://www.geogebra.org/apps/*", match: "path" },
      { id: "geogebra-cdn-apps", value: "https://cdn.geogebra.org/apps/*", match: "path" }
    ]
  },
  {
    id: "geogebra-scientific",
    label: "GeoGebra Scientific Calculator",
    url: "https://www.geogebra.org/scientific",
    enabled: false,
    preset: "geogebra-scientific",
    allowedRules: [
      { id: "geogebra-apps", value: "https://www.geogebra.org/apps/*", match: "path" },
      { id: "geogebra-cdn-apps", value: "https://cdn.geogebra.org/apps/*", match: "path" }
    ]
  }
];

export function normalizeExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.slice(0, 16).flatMap((tool, index) => {
    const requestedId = sanitizeToolId(tool.id || tool.preset || `tool-${index + 1}`);
    // The retired ACT/testing preset is the only server-side conversion we
    // retain. Current preloaded tools are normal course records: instructors
    // may rename, retarget, edit their resources, or delete them.
    if (requestedId === "desmos-calculator" || tool.preset === "desmos-calculator") {
      const replacement = findExternalToolPreset("desmos-graphing");
      if (!replacement || seen.has(replacement.id)) {
        return [];
      }
      seen.add(replacement.id);
      return [cloneExternalTool({ ...replacement, enabled: !!tool.enabled })];
    }
    if (tool.matchType === "regex" || typeof tool.allowedPattern === "string") {
      return [];
    }
    const label = tool.label?.trim();
    const youtubeUrl = normalizeYouTubeVideoUrl(tool.url);
    // Upgrade existing teacher-created YouTube watch/share links into the
    // bounded video policy when they are next read or saved.
    const isYoutubeVideo = tool.preset === YOUTUBE_VIDEO_TOOL_PRESET || !!youtubeUrl;
    const url = isYoutubeVideo ? youtubeUrl : normalizeToolUrl(tool.url);
    if (!label || !url) {
      return [];
    }
    if (!isYoutubeVideo && isYouTubeUrl(tool.url)) {
      return [];
    }
    const id = sanitizeToolId(tool.id || label || `tool-${index + 1}`);
    const uniqueId = seen.has(id) ? `${id}-${index + 1}` : id;
    if (isYoutubeVideo) {
      seen.add(uniqueId);
      return [
        {
          id: uniqueId,
          label,
          url,
          enabled: !!tool.enabled,
          preset: YOUTUBE_VIDEO_TOOL_PRESET,
          adminPresetId: tool.managedByAdmin === true && tool.adminPresetId ? sanitizeToolId(tool.adminPresetId) : null,
          managedByAdmin: tool.managedByAdmin === true,
          allowedRules: [],
          allowedDomains: []
        }
      ];
    }
    const allowedRules = normalizeExternalToolAccessRules(
      Array.isArray(tool.allowedRules) && tool.allowedRules.length
        ? tool.allowedRules
        : legacyToolAccessRules(tool, url)
    );
    seen.add(uniqueId);
    return [
      {
        id: uniqueId,
        label,
        url,
        enabled: !!tool.enabled,
        preset: findExternalToolPreset(requestedId, tool.preset)?.preset || null,
        adminPresetId: tool.managedByAdmin === true && tool.adminPresetId ? sanitizeToolId(tool.adminPresetId) : null,
        managedByAdmin: tool.managedByAdmin === true,
        allowedRules,
        allowedDomains: toolAllowlistEntries(allowedRules)
      }
    ];
  });
}

/** Normalizes a stored course catalog without restoring deleted entries. */
export function normalizeCourseExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  const normalized = normalizeExternalTools(input);
  return normalized.slice(0, 16);
}

/** Supplies the four templates only while initializing a legacy/new course. */
export function seedCourseExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  const normalized = normalizeExternalTools(input);
  const byPreset = new Map(
    normalized
      .map((tool) => [tool.preset || tool.id, tool] as const)
      .filter(([key]) => EXTERNAL_TOOL_PRESETS.some((preset) => preset.id === key || preset.preset === key))
  );
  const seeded = EXTERNAL_TOOL_PRESETS.map(
    (preset) => byPreset.get(preset.preset || preset.id) || cloneExternalTool(preset)
  );
  const presetIds = new Set(seeded.map((tool) => tool.id));
  return [...seeded, ...normalized.filter((tool) => !presetIds.has(tool.id))].slice(0, 16);
}

export function normalizeExternalToolIds(input?: string[] | null): string[] | null | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === null) {
    return null;
  }
  if (!Array.isArray(input)) {
    return null;
  }
  return uniqueStrings(
    input
      .slice(0, 16)
      .map((id) => sanitizeToolId(id))
      .filter(Boolean)
  );
}

export function resolveExternalToolsForAssessment(
  courseTools?: ExternalToolConfig[] | null,
  externalToolIds?: string[] | null,
  legacyTools?: ExternalToolConfig[] | null,
  usesCourseDefaults = true,
  quizOnlyTools?: ExternalToolConfig[] | null
): ExternalToolConfig[] {
  const catalog = normalizeCourseExternalTools(courseTools);
  let selectedCatalog: ExternalToolConfig[];
  if (externalToolIds === undefined) {
    selectedCatalog = usesCourseDefaults ? catalog : normalizeExternalTools(legacyTools);
  } else if (externalToolIds === null) {
    selectedCatalog = catalog;
  } else {
    const selected = new Set(normalizeExternalToolIds(externalToolIds) || []);
    selectedCatalog = catalog.map((tool) => ({ ...tool, enabled: selected.has(tool.id) }));
  }
  const selectedIds = new Set(selectedCatalog.map((tool) => tool.id));
  const quizOnly = normalizeExternalTools(quizOnlyTools)
    .filter((tool) => !selectedIds.has(tool.id))
    .map((tool) => ({ ...tool, enabled: true, managedByAdmin: false, adminPresetId: null }));
  return [...selectedCatalog, ...quizOnly].slice(0, 16);
}

export function enabledExternalTools(input?: ExternalToolConfig[] | null): ExternalToolConfig[] {
  return normalizeExternalTools(input).filter((tool) => tool.enabled);
}

export function allowlistEntriesForExternalTools(input?: ExternalToolConfig[] | null): string[] {
  const entries = new Set<string>();
  for (const tool of enabledExternalTools(input)) {
    const videoId = youtubeVideoId(tool);
    if (videoId) {
      entries.add(`youtube-video:${videoId}`);
      continue;
    }
    entries.add(`exact:${tool.url}`);
    for (const entry of toolAllowlistEntries(tool.allowedRules || [])) {
      entries.add(entry);
    }
  }
  return Array.from(entries);
}

export function normalizeExternalToolAccessRules(input?: ExternalToolAccessRule[] | null): ExternalToolAccessRule[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  return input.slice(0, 12).flatMap((rule, index) => {
    const match = rule?.match;
    const value = typeof rule?.value === "string" ? rule.value.trim() : "";
    const id = sanitizeToolId(rule?.id || `resource-${index + 1}`);
    let normalized: string | null = null;
    if (match === "exact") {
      normalized = normalizeToolResourceUrl(value);
    } else if (match === "path") {
      normalized = normalizeToolPathRule(value);
    } else if (match === "domain") {
      normalized = normalizeToolDomainRule(value);
    }
    if (!normalized) {
      return [];
    }
    const key = `${match}:${normalized}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [
      {
        id,
        value: normalized,
        match,
        ...(match === "domain" && rule.broadDomainConfirmed === true ? { broadDomainConfirmed: true } : {})
      }
    ];
  });
}

function legacyToolAccessRules(tool: ExternalToolConfig, url: string): ExternalToolAccessRule[] {
  if (tool.matchType === "domain") {
    return [{ id: "legacy-domain", value: url, match: "domain" }];
  }
  if (!Array.isArray(tool.allowedDomains)) {
    return [];
  }
  return tool.allowedDomains.flatMap<ExternalToolAccessRule>((entry, index): ExternalToolAccessRule[] => {
    const value = entry.trim();
    if (value.startsWith("domain:")) {
      return [{ id: `legacy-domain-${index + 1}`, value: value.slice("domain:".length), match: "domain" as const }];
    }
    if (value.startsWith("exact:")) {
      return [{ id: `legacy-exact-${index + 1}`, value: value.slice("exact:".length), match: "exact" as const }];
    }
    if (value.endsWith("/*")) {
      return [{ id: `legacy-path-${index + 1}`, value, match: "path" as const }];
    }
    return [{ id: `legacy-exact-${index + 1}`, value, match: "exact" as const }];
  });
}

function toolAllowlistEntries(input: ExternalToolAccessRule[]): string[] {
  return input.flatMap((rule) => {
    if (rule.match === "exact") {
      return [`exact:${rule.value}`];
    }
    if (rule.match === "path") {
      return [rule.value];
    }
    if (rule.match === "domain") {
      return [`domain:${rule.value}`];
    }
    return [];
  });
}

function cloneExternalTool(tool: ExternalToolConfig): ExternalToolConfig {
  const allowedRules = normalizeExternalToolAccessRules(tool.allowedRules);
  return {
    ...tool,
    allowedRules,
    allowedDomains: toolAllowlistEntries(allowedRules)
  };
}

function findExternalToolPreset(id: string, preset?: string | null): ExternalToolConfig | undefined {
  const requested = preset || id;
  const canonicalId = requested === "desmos-calculator" ? "desmos-graphing" : requested;
  return EXTERNAL_TOOL_PRESETS.find((entry) => entry.id === canonicalId || entry.preset === canonicalId);
}

function normalizeToolUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !normalizeConcreteHostname(parsed.hostname)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * A teacher may explicitly approve a resource hosted away from the tool's
 * start page (for example, a particular video or CDN asset). Tool start pages
 * use the same safe HTTPS normalization, so a teacher can intentionally make
 * that external site the tool itself.
 */
function normalizeToolResourceUrl(value?: string | null): string | null {
  return isYouTubeUrl(value) ? null : normalizeToolUrl(value);
}

function normalizeToolPathRule(value: string): string | null {
  const candidate = value.endsWith("/*") ? value.slice(0, -1) : value;
  const url = normalizeToolResourceUrl(candidate);
  if (!url) {
    return null;
  }
  const parsed = new URL(url);
  if (parsed.pathname === "/" || parsed.search || parsed.hash) {
    return null;
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}/*`;
}

function normalizeToolDomainRule(value: string): string | null {
  const candidate = value.includes("://")
    ? normalizeToolResourceUrl(value)
    : normalizeToolResourceUrl(`https://${value}`);
  if (!candidate) {
    return null;
  }
  const parsed = new URL(candidate);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return null;
  }
  return parsed.hostname;
}
