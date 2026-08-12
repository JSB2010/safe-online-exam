import { AlertCircle, Calculator, ChevronDown, PlayCircle, Plus, RefreshCw, Save, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { ExternalToolConfig } from "../../../shared/models.js";
import { EXTERNAL_TOOL_PRESETS } from "../../../shared/models.js";
import { actionHeaders, errorMessage, requestJson } from "../../lib/api.js";
import { useDialogInitialFocus, useEscapeToClose } from "../../hooks/dialog.js";
import {
  ToolAccessRuleEditor,
  externalToolsValidationMessage,
  isYouTubeVideoDefinition,
  toolStartUrlValidationMessage,
  youtubeVideoValidationMessage
} from "../exam-tools/index.js";
import { newToolAccessRule, newYoutubeVideoTool } from "../../lib/settings.js";
import { AdminCourseView, AdminTermView, AdminToolPresetView } from "../../types.js";

export function AdminConnectCoursesDialog({
  authToken,
  onClose,
  onConnected
}: {
  authToken?: string;
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  useEscapeToClose(onClose);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogInitialFocus(closeButtonRef);
  const [terms, setTerms] = useState<AdminTermView[]>([]);
  const [termId, setTermId] = useState("");
  const [query, setQuery] = useState("");
  const [includeUnpublished, setIncludeUnpublished] = useState(true);
  const [courses, setCourses] = useState<Array<AdminCourseView & { connected?: boolean }>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [directInput, setDirectInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [catalogReady, setCatalogReady] = useState(false);

  const loadCatalog = async (append = false, cursor?: string | null) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        includeUnpublished: String(includeUnpublished),
        withEnrollments: "true"
      });
      if (termId) params.set("termId", termId);
      if (query.trim()) params.set("search", query.trim());
      if (cursor) params.set("cursor", cursor);
      const body = await requestJson(`/api/admin/course-catalog?${params.toString()}`);
      setCourses((current) => (append ? [...current, ...(body.courses || [])] : body.courses || []));
      setNextCursor(body.nextCursor || null);
    } catch (value) {
      setError(errorMessage(value, "Active Canvas courses could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void requestJson("/api/admin/terms")
      .then((body) => {
        const values = (body.terms || []) as typeof terms;
        setTerms(values);
        setTermId(String(body.operationalTerm?.id || values[0]?.id || ""));
      })
      .catch(() => undefined)
      .finally(() => setCatalogReady(true));
  }, []);

  useEffect(() => {
    if (!catalogReady) return;
    const timer = window.setTimeout(() => void loadCatalog(false), 350);
    return () => window.clearTimeout(timer);
  }, [catalogReady, query, termId, includeUnpublished]);

  const connect = async (courseIds?: string[]) => {
    setSaving(true);
    setError("");
    try {
      const body = await requestJson("/api/admin/courses/connect", {
        method: "POST",
        headers: { "content-type": "application/json", ...actionHeaders(authToken) },
        body: JSON.stringify(courseIds?.length ? { courseIds } : { input: directInput })
      });
      const failures = (body.results || []).filter((result: any) => result.success !== true);
      if (failures.length) {
        setError(
          failures
            .slice(0, 4)
            .map((failure: any) => `Course ${failure.courseId}: ${failure.error || "could not connect"}`)
            .join(" ")
        );
      }
      if (Number(body.connectedCount || 0) > 0) {
        await onConnected();
      }
    } catch (value) {
      setError(errorMessage(value, "The selected courses could not be connected."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog large admin-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
      >
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Course connections</span>
            <h2 id="connect-title">Connect Canvas courses</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </header>
        <div className="admin-connect-filters">
          <label>
            Term
            <select value={termId} onChange={(event) => setTermId(event.target.value)}>
              <option value="">All non-completed terms</option>
              {terms.map((term) => (
                <option value={term.id} key={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-connect-search">
            Search active courses
            <span className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, code, teacher, SIS ID, or Canvas ID"
              />
            </span>
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={includeUnpublished}
              onChange={(event) => setIncludeUnpublished(event.target.checked)}
            />
            Include unpublished course shells
          </label>
        </div>
        <div className="admin-connect-results">
          {courses.map((course) => (
            <label className={clsx("admin-connect-course", course.connected && "connected")} key={course.id}>
              <input
                type="checkbox"
                checked={selected.has(course.id)}
                disabled={course.connected}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(course.id);
                    else next.delete(course.id);
                    return next;
                  })
                }
              />
              <span>
                <strong>{course.name}</strong>
                <small>
                  {course.courseCode || `Course ${course.id}`} · {course.termName || "No term"}
                </small>
              </span>
              {course.connected && <em>Connected</em>}
            </label>
          ))}
          {loading && (
            <div className="admin-loading">
              <RefreshCw className="spin" size={17} /> Loading courses…
            </div>
          )}
          {!loading && !courses.length && <div className="empty-line">No active courses match these filters.</div>}
          {nextCursor && (
            <button
              className="button secondary"
              type="button"
              disabled={loading}
              onClick={() => void loadCatalog(true, nextCursor)}
            >
              <ChevronDown size={15} /> Load more
            </button>
          )}
        </div>
        <div className="admin-direct-connect">
          <strong>Connect by URL or ID</strong>
          <small>Paste one or more Canvas course URLs or IDs, separated by spaces or new lines.</small>
          <div>
            <textarea
              value={directInput}
              onChange={(event) => setDirectInput(event.target.value)}
              placeholder={"https://canvas.school.edu/courses/18492\n18493"}
            />
            <button
              className="button secondary"
              type="button"
              disabled={saving || !directInput.trim()}
              onClick={() => void connect()}
            >
              Connect entered courses
            </button>
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving || selected.size === 0}
            onClick={() => void connect([...selected])}
          >
            <Plus size={16} /> {saving ? "Connecting…" : `Connect selected (${selected.size})`}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AdminPresetRolloutDialog({
  preset,
  onClose,
  onApply
}: {
  preset: AdminToolPresetView;
  onClose: () => void;
  onApply: (assigned: boolean, all: boolean, courseIds: string[]) => Promise<void>;
}) {
  useEscapeToClose(onClose);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogInitialFocus(closeButtonRef);
  const [courses, setCourses] = useState<AdminCourseView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [assigned, setAssigned] = useState(true);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadAll = async () => {
      const values: AdminCourseView[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const body = await requestJson(`/api/admin/courses?${params.toString()}`);
        values.push(...(body.courses || []));
        cursor = body.nextCursor || null;
      } while (cursor && values.length < 2_000);
      setCourses(values);
      setLoading(false);
    };
    void loadAll().catch((value) => {
      setError(errorMessage(value, "Connected courses could not be loaded."));
      setLoading(false);
    });
  }, []);

  const visible = courses.filter((course) =>
    `${course.name} ${course.courseCode || ""} ${course.id}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  const apply = async (all: boolean) => {
    setSaving(true);
    setError("");
    try {
      await onApply(assigned, all, [...selected]);
    } catch (value) {
      setError(errorMessage(value, "The course rollout could not be completed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog large admin-rollout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rollout-title"
      >
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Institution exam tool</span>
            <h2 id="rollout-title">Assign {preset.name}</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </header>
        <div className="admin-rollout-controls">
          <div className="segmented">
            <button className={clsx(assigned && "active")} type="button" onClick={() => setAssigned(true)}>
              Assign
            </button>
            <button className={clsx(!assigned && "active")} type="button" onClick={() => setAssigned(false)}>
              Remove
            </button>
          </div>
          <div className="search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter connected courses"
            />
          </div>
        </div>
        <div className="admin-rollout-list">
          {visible.map((course) => (
            <label key={course.id} className="admin-connect-course">
              <input
                type="checkbox"
                checked={selected.has(course.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(course.id);
                    else next.delete(course.id);
                    return next;
                  })
                }
              />
              <span>
                <strong>{course.name}</strong>
                <small>{course.courseCode || `Course ${course.id}`}</small>
              </span>
              {preset.assignedCourseIds.includes(course.id) && <em>Currently assigned</em>}
            </label>
          ))}
          {loading && (
            <div className="admin-loading">
              <RefreshCw className="spin" size={17} /> Loading courses…
            </div>
          )}
        </div>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions admin-rollout-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={saving || loading}
            onClick={() => void apply(true)}
          >
            {assigned ? "Assign to all connected courses" : "Remove from all connected courses"}
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving || selected.size === 0}
            onClick={() => void apply(false)}
          >
            {saving ? "Applying…" : `${assigned ? "Assign" : "Remove"} selected (${selected.size})`}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function AdminToolPresetDialog({
  preset,
  onClose,
  onSave
}: {
  preset?: AdminToolPresetView;
  onClose: () => void;
  onSave: (input: { name: string; description: string; tool: ExternalToolConfig }) => Promise<void>;
}) {
  useEscapeToClose(onClose);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogInitialFocus(closeButtonRef);
  const [name, setName] = useState(preset?.name || "");
  const [description, setDescription] = useState(preset?.description || "");
  const [tool, setTool] = useState<ExternalToolConfig>(
    preset?.tool || { id: "school-preset-template", label: "", url: "", enabled: false, allowedRules: [] }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showToolValidationErrors, setShowToolValidationErrors] = useState(false);
  const youtubeVideo = isYouTubeVideoDefinition(tool);
  const startUrlError = youtubeVideo
    ? youtubeVideoValidationMessage(tool.url, showToolValidationErrors)
    : toolStartUrlValidationMessage(tool.url, showToolValidationErrors);

  const save = async () => {
    setSaving(true);
    setError("");
    const toolError = externalToolsValidationMessage([tool]);
    if (toolError) {
      setShowToolValidationErrors(true);
      setError(`Fix this tool before saving: ${toolError}`);
      setSaving(false);
      return;
    }
    try {
      await onSave({
        name,
        description,
        tool: {
          id: tool.id,
          label: name,
          url: tool.url,
          enabled: false,
          preset: tool.preset || null,
          allowedRules: tool.allowedRules || []
        }
      });
    } catch (value) {
      setError(errorMessage(value, "The school tool preset could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog large" role="dialog" aria-modal="true" aria-labelledby="admin-preset-title">
        <header className="dialog-header">
          <div>
            <span className="section-kicker">School exam tool</span>
            <h2 id="admin-preset-title">{preset ? `Edit ${preset.name}` : "Create tool preset"}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close tool preset"
          >
            <X size={17} />
          </button>
        </header>
        <div className="settings-stack">
          <section className="settings-section admin-preset-editor">
            <div className="admin-preset-templates">
              <strong>Start from an approved template</strong>
              <div>
                {EXTERNAL_TOOL_PRESETS.map((template) => (
                  <button
                    className="button secondary small"
                    type="button"
                    key={template.id}
                    onClick={() => {
                      setName(template.label);
                      setTool(structuredClone(template));
                    }}
                  >
                    <Calculator size={14} /> {template.label}
                  </button>
                ))}
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() => {
                    setName("YouTube video");
                    setTool(newYoutubeVideoTool("school-preset-template"));
                  }}
                >
                  <PlayCircle size={14} /> YouTube video
                </button>
              </div>
            </div>
            <div className="tool-custom-fields">
              <label>
                Preset name
                <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
              </label>
              <label>
                {youtubeVideo ? "YouTube video link" : "Start page"}
                <input
                  value={tool.url}
                  aria-invalid={!!startUrlError}
                  onChange={(event) => setTool((current) => ({ ...current, url: event.target.value }))}
                  placeholder={youtubeVideo ? "Paste a YouTube link" : "https://www.desmos.com/calculator"}
                />
                <small>
                  {youtubeVideo
                    ? "Paste a watch, share, Shorts, or embed link. Students get only the video player; YouTube sign-in and browsing stay blocked."
                    : "This is the page students open. It is always allowed exactly as entered."}
                </small>
                {startUrlError && <small className="field-error">{startUrlError}</small>}
              </label>
            </div>
            <label>
              Teacher-facing description
              <input
                value={description}
                maxLength={240}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Approved graphing calculator"
              />
            </label>
            {!youtubeVideo && (
              <div className="tool-access-heading">
                <div>
                  <strong>Extra pages students can use</strong>
                  <small>Add a page, file, or website only when this tool needs it after opening.</small>
                </div>
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() =>
                    setTool((current) => ({
                      ...current,
                      allowedRules: [...(current.allowedRules || []), newToolAccessRule()]
                    }))
                  }
                >
                  <Plus size={14} /> Add location
                </button>
              </div>
            )}
            <p className="tool-launch-url">
              <span>{youtubeVideo ? "Video player" : "Start page"}</span>
              <code>{tool.url || "Add a secure https:// address"}</code>
            </p>
            {youtubeVideo ? (
              <p className="tool-blocked-note">
                Only this public video and the player resources it requires are available.
              </p>
            ) : (
              (tool.allowedRules || []).map((rule) => (
                <ToolAccessRuleEditor
                  key={rule.id}
                  rule={rule}
                  startUrl={tool.url}
                  showValidationErrors={showToolValidationErrors}
                  disabled={false}
                  onChange={(patch) =>
                    setTool((current) => ({
                      ...current,
                      allowedRules: (current.allowedRules || []).map((entry) =>
                        entry.id === rule.id ? { ...entry, ...patch } : entry
                      )
                    }))
                  }
                  onRemove={() =>
                    setTool((current) => ({
                      ...current,
                      allowedRules: (current.allowedRules || []).filter((entry) => entry.id !== rule.id)
                    }))
                  }
                />
              ))
            )}
          </section>
        </div>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="button"
            disabled={saving || !name.trim() || !tool.url.trim()}
            onClick={() => void save()}
          >
            <Save size={16} /> {saving ? "Saving…" : "Save preset"}
          </button>
        </footer>
      </section>
    </div>
  );
}
