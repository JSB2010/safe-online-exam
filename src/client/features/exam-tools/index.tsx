import { Calculator, ChevronDown, Copy, PlayCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import type {
  ExternalToolAccessRule,
  ExternalToolConfig,
  SebUrlRule,
  SebUrlRuleMatch
} from "../../../shared/models.js";
import {
  isYouTubeVideoTool,
  isYouTubeUrl,
  normalizeCourseExternalTools,
  normalizeYouTubeVideoUrl,
  normalizeUrlRules,
  YOUTUBE_VIDEO_TOOL_PRESET
} from "../../../shared/models.js";
import { newCustomTool, newToolAccessRule, newYoutubeVideoTool } from "../../lib/settings.js";

export function UrlRuleEditor({
  rules,
  onChange,
  disabled = false,
  showValidationErrors = false
}: {
  rules: SebUrlRule[];
  onChange: (rules: SebUrlRule[]) => void;
  disabled?: boolean;
  showValidationErrors?: boolean;
}) {
  const update = (id: string, patch: Partial<SebUrlRule>) =>
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  return (
    <div className="rule-list">
      {rules.map((rule) => {
        const validationError = urlRuleValidationMessage(rule, showValidationErrors);
        return (
          <div className="rule-row" key={rule.id}>
            <select
              value={rule.match}
              disabled={disabled}
              onChange={(event) => update(rule.id, { match: event.target.value as SebUrlRuleMatch })}
            >
              <option value="domain">Any URL on domain</option>
              <option value="exact">Exact URL</option>
            </select>
            <div className="rule-value-field">
              <input
                value={rule.value}
                disabled={disabled}
                aria-invalid={!!validationError}
                onChange={(event) => update(rule.id, { value: event.target.value })}
                placeholder={rule.match === "exact" ? "https://example.edu/resource" : "example.edu"}
              />
              {validationError && <small className="field-error">{validationError}</small>}
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={disabled}
              onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))}
              title="Remove URL"
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      {rules.length === 0 && <p className="empty-line">No extra URLs configured.</p>}
    </div>
  );
}

export function ToolEditor({
  tools,
  onChange,
  disabled = false,
  showValidationErrors = false,
  copyableToolIds,
  onCopyTool
}: {
  tools: ExternalToolConfig[];
  onChange: (tools: ExternalToolConfig[]) => void;
  disabled?: boolean;
  showValidationErrors?: boolean;
  copyableToolIds?: ReadonlySet<string>;
  onCopyTool?: (tool: ExternalToolConfig) => void;
}) {
  const [expandedToolIds, setExpandedToolIds] = useState<string[]>([]);
  const update = (id: string, patch: Partial<ExternalToolConfig>) =>
    onChange(tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool)));
  const toggleExpanded = (id: string) =>
    setExpandedToolIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  const addTool = () => {
    const tool = newCustomTool();
    onChange([...tools, tool]);
    setExpandedToolIds((current) => [...current, tool.id]);
  };
  const addYoutubeVideo = () => {
    const tool = newYoutubeVideoTool();
    onChange([...tools, tool]);
    setExpandedToolIds((current) => [...current, tool.id]);
  };

  return (
    <div className="tool-list">
      <div className="tool-list-intro">
        <p>
          Add the page students should open, then list only the extra pages or files that tool needs in Safe Exam
          Browser.
        </p>
        <div className="tool-list-actions">
          <button className="button secondary small" type="button" disabled={disabled} onClick={addTool}>
            <Plus size={14} /> Add tool
          </button>
          <button className="button secondary small" type="button" disabled={disabled} onClick={addYoutubeVideo}>
            <PlayCircle size={14} /> Add YouTube video
          </button>
        </div>
      </div>
      {tools.map((tool) => {
        const expanded = expandedToolIds.includes(tool.id);
        const definitionLocked = disabled || tool.managedByAdmin === true;
        const detailId = `tool-details-${tool.id}`;
        const youtubeVideo = isYouTubeVideoDefinition(tool);
        const startUrlError = youtubeVideo
          ? youtubeVideoValidationMessage(tool.url, showValidationErrors)
          : toolStartUrlValidationMessage(tool.url, showValidationErrors);
        return (
          <article className={clsx("tool-card", expanded && "expanded")} key={tool.id}>
            <header className="tool-card-header">
              <label className="tool-enabled">
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  disabled={disabled}
                  onChange={(event) => update(tool.id, { enabled: event.target.checked })}
                />
                <span className="tool-icon">{youtubeVideo ? <PlayCircle size={16} /> : <Calculator size={16} />}</span>
                <span>
                  <strong>{tool.label || "New custom tool"}</strong>
                  <small>{tool.enabled ? "Enabled by default" : "Disabled by default"}</small>
                </span>
              </label>
              <div className="tool-card-summary-actions">
                <span
                  className={clsx("tool-badge", tool.managedByAdmin ? "school" : tool.preset ? "preset" : "custom")}
                >
                  {tool.managedByAdmin
                    ? "School preset"
                    : youtubeVideo
                      ? "Video"
                      : tool.preset
                        ? "Preloaded"
                        : "Custom"}
                </span>
                <small className="tool-access-summary">{toolAccessSummary(tool)}</small>
                <button
                  className="tool-expand-button"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  onClick={() => toggleExpanded(tool.id)}
                >
                  {expanded ? "Close" : tool.managedByAdmin ? "View" : "Edit"} <ChevronDown size={16} />
                </button>
              </div>
            </header>

            {expanded && (
              <div className="tool-card-details" id={detailId}>
                <div className="tool-custom-fields">
                  <label>
                    Name
                    <input
                      value={tool.label}
                      disabled={definitionLocked}
                      onChange={(event) => update(tool.id, { label: event.target.value })}
                      placeholder="Tool name"
                    />
                  </label>
                  <label>
                    {youtubeVideo ? "YouTube video link" : "Start page"}
                    <input
                      value={tool.url}
                      disabled={definitionLocked}
                      aria-invalid={!!startUrlError}
                      onChange={(event) => update(tool.id, { url: event.target.value })}
                      placeholder={youtubeVideo ? "Paste a YouTube link" : "https://example.edu/tool"}
                    />
                    <small>
                      {youtubeVideo
                        ? "Paste a watch, share, Shorts, or embed link. Students can play this video, but cannot sign in or browse YouTube."
                        : "This is the page students open. It is allowed exactly as entered."}
                    </small>
                    {startUrlError && <small className="field-error">{startUrlError}</small>}
                  </label>
                </div>

                {youtubeVideo ? (
                  <section className="tool-access-list youtube-video-policy">
                    <div>
                      <strong>Video-only access</strong>
                      <small>
                        The secure browser permits only the embedded player, its video stream, and its thumbnails.
                      </small>
                    </div>
                    <p className="tool-launch-url">
                      <span>Video player</span>
                      <code>{normalizeYouTubeVideoUrl(tool.url) || "Paste a valid YouTube video link"}</code>
                    </p>
                    <p className="tool-blocked-note">
                      Private, age-restricted, or sign-in-required videos will not work during an exam.
                    </p>
                  </section>
                ) : (
                  <section className="tool-access-list">
                    <div className="tool-access-heading">
                      <div>
                        <strong>Extra pages students can use</strong>
                        <small>Add a page, file, or website only when this tool needs it after opening.</small>
                      </div>
                      <button
                        className="button secondary small"
                        type="button"
                        disabled={definitionLocked}
                        onClick={() =>
                          update(tool.id, {
                            allowedRules: [...(tool.allowedRules || []), newToolAccessRule()]
                          })
                        }
                      >
                        <Plus size={14} /> Add location
                      </button>
                    </div>
                    <p className="tool-launch-url">
                      <span>Start page</span>
                      <code>{tool.url || "Add a secure https:// address"}</code>
                    </p>
                    {(tool.allowedRules || []).map((rule) => (
                      <ToolAccessRuleEditor
                        disabled={definitionLocked}
                        key={rule.id}
                        rule={rule}
                        startUrl={tool.url}
                        showValidationErrors={showValidationErrors}
                        onChange={(patch) =>
                          update(tool.id, {
                            allowedRules: (tool.allowedRules || []).map((entry) =>
                              entry.id === rule.id ? { ...entry, ...patch } : entry
                            )
                          })
                        }
                        onRemove={() =>
                          update(tool.id, {
                            allowedRules: (tool.allowedRules || []).filter((entry) => entry.id !== rule.id)
                          })
                        }
                      />
                    ))}
                    {(tool.allowedRules || []).length === 0 && (
                      <p className="empty-line">No additional resource paths.</p>
                    )}
                    <p className="tool-blocked-note">
                      {tool.managedByAdmin
                        ? "This definition is managed by your Canvas administrator. You can enable or disable it for the course."
                        : "Anything not listed here is blocked, including unrelated pages and other websites."}
                    </p>
                  </section>
                )}

                {!tool.managedByAdmin && (
                  <footer className="tool-card-actions">
                    {onCopyTool && (
                      <button
                        className="button secondary small"
                        disabled={disabled || !copyableToolIds?.has(tool.id)}
                        type="button"
                        title={
                          copyableToolIds?.has(tool.id)
                            ? "Duplicate this tool in other instructor courses"
                            : "Save course defaults before duplicating a new or edited tool"
                        }
                        onClick={() => onCopyTool(tool)}
                      >
                        <Copy size={14} /> Duplicate to courses
                      </button>
                    )}
                    <button
                      className="button danger small"
                      disabled={disabled}
                      type="button"
                      onClick={() => onChange(tools.filter((entry) => entry.id !== tool.id))}
                    >
                      <Trash2 size={14} /> Remove tool
                    </button>
                  </footer>
                )}
              </div>
            )}
          </article>
        );
      })}
      {tools.length === 0 && <p className="empty-line">No tools configured.</p>}
    </div>
  );
}

export function ToolAccessRuleEditor({
  rule,
  startUrl,
  showValidationErrors = false,
  onChange,
  onRemove,
  disabled
}: {
  rule: ExternalToolAccessRule;
  startUrl: string;
  showValidationErrors?: boolean;
  onChange: (patch: Partial<ExternalToolAccessRule>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const changeMatch = (match: ExternalToolAccessRule["match"]) => {
    onChange({
      match,
      ...(match === "domain" ? { broadDomainConfirmed: false } : { broadDomainConfirmed: undefined })
    });
  };

  const changeValue = (value: string) => onChange({ value });
  const addressLabel = rule.match === "domain" ? "Website address" : "Address to allow";
  const addressPlaceholder =
    rule.match === "domain"
      ? "example.edu"
      : rule.match === "path"
        ? "https://example.edu/help"
        : "https://example.edu/page";
  const validationMessage = toolAccessValidationMessage(rule, showValidationErrors);
  const addressIsValid = validationMessage === null;
  const externalHost = externalResourceHost(rule, startUrl);

  return (
    <fieldset className={clsx("tool-access-rule", rule.match === "domain" && "broad")}>
      <legend>What should students be able to open?</legend>
      <div className="tool-access-scope-options">
        <label className={clsx("tool-access-scope", rule.match === "exact" && "selected")}>
          <input
            type="radio"
            name={`tool-access-scope-${rule.id}`}
            checked={rule.match === "exact"}
            disabled={disabled}
            onChange={() => changeMatch("exact")}
          />
          <span>
            <strong>This one page or file</strong>
            <small>One specific link</small>
          </span>
        </label>
        <label className={clsx("tool-access-scope", rule.match === "path" && "selected")}>
          <input
            type="radio"
            name={`tool-access-scope-${rule.id}`}
            checked={rule.match === "path"}
            disabled={disabled}
            onChange={() => changeMatch("path")}
          />
          <span>
            <strong>This address and related links</strong>
            <small>Anything under one web address</small>
          </span>
        </label>
        <label className={clsx("tool-access-scope", rule.match === "domain" && "selected", "broad")}>
          <input
            type="radio"
            name={`tool-access-scope-${rule.id}`}
            checked={rule.match === "domain"}
            disabled={disabled}
            onChange={() => changeMatch("domain")}
          />
          <span>
            <strong>This whole website</strong>
            <small>Use only when one link is not enough</small>
          </span>
        </label>
      </div>
      <div className="tool-access-address">
        <label>
          {addressLabel}
          <input
            value={displayToolAccessValue(rule)}
            disabled={disabled}
            aria-invalid={!addressIsValid}
            onChange={(event) => changeValue(event.target.value)}
            placeholder={addressPlaceholder}
          />
        </label>
        {!disabled && (
          <button
            className="icon-button"
            type="button"
            onClick={onRemove}
            title="Remove this location"
            aria-label="Remove this location"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {!!rule.value && !addressIsValid && <p className="field-error">{validationMessage}</p>}
      <p className="tool-access-preview">{toolAccessPreview(rule)}</p>
      {externalHost && (
        <p className="tool-access-external-note" role="status">
          This is hosted by <strong>{externalHost}</strong>, not the start page’s website. Students will be able to open
          it during the exam.
        </p>
      )}
      {rule.match === "domain" && (
        <label className="tool-access-confirmation">
          <input
            type="checkbox"
            checked={rule.broadDomainConfirmed === true}
            disabled={disabled}
            onChange={(event) => onChange({ broadDomainConfirmed: event.target.checked })}
          />
          <span>I understand this lets students open any HTTPS page on this website during the exam.</span>
        </label>
      )}
    </fieldset>
  );
}

function displayToolAccessValue(rule: ExternalToolAccessRule): string {
  return rule.match === "path" ? rule.value.replace(/\/\*$/u, "") : rule.value;
}

function urlRuleValidationMessage(rule: SebUrlRule, required = false): string | null {
  const value = rule.value.trim();
  if (!value) {
    return required ? "Enter the website or exact page students may open." : null;
  }
  if (rule.match === "regex" || value.includes("*")) {
    return "Use a concrete website or exact HTTPS page without wildcards or regular expressions.";
  }
  if (rule.match === "exact") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
        return "Use a complete HTTPS address without a username, password, or port.";
      }
    } catch {
      return "Enter a complete HTTPS address, such as https://example.edu/resource.";
    }
  }
  if (rule.match === "domain" && (value.includes("://") || value.includes("/") || value.includes(":"))) {
    return "Enter only a concrete hostname, such as example.edu.";
  }
  return normalizeUrlRules([rule]).length === 1
    ? null
    : rule.match === "domain"
      ? "Enter a concrete public hostname, such as example.edu."
      : "Enter a complete HTTPS address, such as https://example.edu/resource.";
}

export function urlRulesValidationMessage(rules: SebUrlRule[]): string | null {
  for (const [index, rule] of rules.entries()) {
    const error = urlRuleValidationMessage(rule, true);
    if (error) return `Allowed website ${index + 1}: ${error}`;
  }
  return null;
}

export function toolStartUrlValidationMessage(value: string, required = false): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? "Enter the HTTPS page students should open." : null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return "Use a complete HTTPS address without a username, password, or port.";
    }
    if (isYouTubeUrl(value)) {
      return "Use “Add YouTube video” for a video instead of adding a general YouTube page.";
    }
    return null;
  } catch {
    return "Enter a complete HTTPS address, such as https://example.edu/tool.";
  }
}

export function isYouTubeVideoDefinition(tool: Pick<ExternalToolConfig, "preset">): boolean {
  return tool.preset === YOUTUBE_VIDEO_TOOL_PRESET;
}

export function youtubeVideoValidationMessage(value: string, required = false): string | null {
  if (!value.trim()) {
    return required ? "Paste a YouTube watch, share, Shorts, or embed link." : null;
  }
  return normalizeYouTubeVideoUrl(value)
    ? null
    : "Use one YouTube video link, such as https://youtu.be/VIDEO_ID or https://www.youtube.com/watch?v=VIDEO_ID.";
}

function toolAccessValidationMessage(rule: ExternalToolAccessRule, required = false): string | null {
  const value = displayToolAccessValue(rule).trim();
  if (!value) {
    return required ? "Enter the page, file, or website students may use." : null;
  }
  try {
    const candidate = rule.match === "domain" && !value.includes("://") ? `https://${value}` : value;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return "Use a complete HTTPS address without a username, password, or port.";
    }
    if (isYouTubeUrl(value)) {
      return "Use “Add YouTube video” for a video instead of adding it as an extra location.";
    }
    if (rule.match === "path" && (parsed.pathname === "/" || parsed.search || parsed.hash)) {
      return "Choose a specific address below the website, such as https://example.edu/help.";
    }
    if (rule.match === "domain" && (parsed.pathname !== "/" || parsed.search || parsed.hash)) {
      return "For a whole website, enter only its address, such as example.edu.";
    }
    if (rule.match === "domain" && rule.broadDomainConfirmed !== true) {
      return "Confirm that students may use this whole website during the exam.";
    }
    return null;
  } catch {
    return "Enter a complete HTTPS address, such as https://example.edu/page.";
  }
}

export function externalToolsValidationMessage(tools: ExternalToolConfig[]): string | null {
  for (const tool of tools) {
    const label = tool.label.trim() || "This tool";
    const startError = isYouTubeVideoDefinition(tool)
      ? youtubeVideoValidationMessage(tool.url, true)
      : toolStartUrlValidationMessage(tool.url, true);
    if (startError) {
      return `${label}: ${startError}`;
    }
    for (const rule of tool.allowedRules || []) {
      const accessError = toolAccessValidationMessage(rule, true);
      if (accessError) {
        return `${label}: ${accessError}`;
      }
    }
  }
  return null;
}

function toolAccessPreview(rule: ExternalToolAccessRule): string {
  const value = displayToolAccessValue(rule).trim() || "the address above";
  if (rule.match === "exact") {
    return `Students can open only ${value}.`;
  }
  if (rule.match === "path") {
    return `Students can open ${value} and links below that address.`;
  }
  return `Students can open any HTTPS page on ${value}.`;
}

function externalResourceHost(rule: ExternalToolAccessRule, startUrl: string): string | null {
  const resourceValue = displayToolAccessValue(rule).trim();
  if (!resourceValue || !startUrl.trim()) {
    return null;
  }
  try {
    const startHost = new URL(startUrl).hostname.replace(/^www\./u, "").toLowerCase();
    const resourceUrl =
      rule.match === "domain" && !resourceValue.includes("://") ? `https://${resourceValue}` : resourceValue;
    const resourceHost = new URL(resourceUrl).hostname.replace(/^www\./u, "").toLowerCase();
    return resourceHost && resourceHost !== startHost ? resourceHost : null;
  } catch {
    return null;
  }
}

function toolAccessSummary(tool: ExternalToolConfig): string {
  if (isYouTubeVideoTool(tool)) {
    return "One public video";
  }
  const count = tool.allowedRules?.length || 0;
  return count === 0 ? "Start page only" : `${count} additional location${count === 1 ? "" : "s"}`;
}

export function QuizToolSelector({
  tools,
  selectedIds,
  onChange
}: {
  tools: ExternalToolConfig[];
  selectedIds: string[] | null;
  onChange: (ids: string[] | null) => void;
}) {
  const catalog = normalizeCourseExternalTools(tools);
  const selected = new Set(selectedIds || catalog.filter((tool) => tool.enabled).map((tool) => tool.id));
  const update = (tool: ExternalToolConfig, enabled: boolean) => {
    const next = new Set(selected);
    if (enabled) next.add(tool.id);
    else next.delete(tool.id);
    onChange(Array.from(next));
  };

  return (
    <div className="quiz-tool-selector">
      <div className="quiz-tool-selector-copy">
        <p>
          {selectedIds === null
            ? "This quiz uses the course defaults. Check a box to make a quiz-specific selection."
            : "This quiz has its own tool selection. Only checked tools will be included in its Safe Online Exam configuration."}
        </p>
        {selectedIds !== null && (
          <button className="button secondary small" type="button" onClick={() => onChange(null)}>
            Reset to course defaults
          </button>
        )}
      </div>
      <div className="quiz-tool-list">
        {catalog.map((tool) => (
          <label className="quiz-tool-option" key={tool.id}>
            <input
              type="checkbox"
              checked={selected.has(tool.id)}
              onChange={(event) => update(tool, event.target.checked)}
            />
            <span>
              <strong>{tool.label}</strong>
              <small>
                {selectedIds === null
                  ? tool.enabled
                    ? "Course default: enabled"
                    : "Course default: disabled"
                  : tool.url}
              </small>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
