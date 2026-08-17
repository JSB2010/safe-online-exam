import { AlertCircle, Calculator, Save, Shield, SlidersHorizontal, X } from "lucide-react";
import type { SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { CourseSebDefaults, ExternalToolConfig } from "../../../shared/models.js";
import { normalizeCourseExternalTools, normalizeUrlRules } from "../../../shared/models.js";
import { SEB_PASSWORD_MAX_LENGTH, SEB_PASSWORD_MIN_LENGTH } from "../../../shared/seb-password-policy.js";
import { errorMessage } from "../../lib/api.js";
import { useDialogInitialFocus, useEscapeToClose } from "../../hooks/dialog.js";
import {
  ToolEditor,
  UrlRuleEditor,
  externalToolsValidationMessage,
  urlRulesValidationMessage
} from "../exam-tools/index.js";
import { SectionHeading } from "../../components/feedback.js";
import { CourseToolCopyDialog, courseToolCopySignature } from "./course-tool-copy.js";
import {
  PasswordRequirements,
  SavedPasswordReveal,
  coursePasswordValidationMessage,
  passwordValidationMessage
} from "./settings-dialog.js";
import { newUrlRule } from "../../lib/settings.js";

export function DefaultsDialog({
  defaults,
  courseId,
  authToken,
  initialSection = "password",
  onClose,
  onSave
}: {
  defaults: CourseSebDefaults;
  courseId: string;
  authToken?: string;
  initialSection?: "password" | "urls" | "tools";
  onClose: () => void;
  onSave: (defaults: CourseSebDefaults) => Promise<void>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [startPasswordEnabled, setStartPasswordEnabled] = useState(
    () => !!draft.startPassword || draft.hasStartPassword === true
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<"password" | "urls" | "tools">(initialSection);
  const [showPasswordValidationErrors, setShowPasswordValidationErrors] = useState(false);
  const [showUrlValidationErrors, setShowUrlValidationErrors] = useState(false);
  const [showToolValidationErrors, setShowToolValidationErrors] = useState(false);
  const [toolToCopy, setToolToCopy] = useState<ExternalToolConfig | null>(null);
  useEscapeToClose(toolToCopy ? () => undefined : onClose);
  useDialogInitialFocus(closeButtonRef);
  const copyableToolIds = useMemo(
    () =>
      new Set(
        draft.externalTools.flatMap((tool) => {
          const saved = defaults.externalTools.find((entry) => entry.id === tool.id);
          return !tool.managedByAdmin && saved && courseToolCopySignature(tool) === courseToolCopySignature(saved)
            ? [tool.id]
            : [];
        })
      ),
    [defaults.externalTools, draft.externalTools]
  );

  useEffect(() => {
    setError(null);
  }, [draft, startPasswordEnabled]);

  async function save() {
    setSaving(true);
    setError(null);
    const passwordError = coursePasswordValidationMessage(draft, startPasswordEnabled);
    if (passwordError) {
      setSection("password");
      setShowPasswordValidationErrors(true);
      setError("Review the highlighted password requirements before saving.");
      setSaving(false);
      return;
    }
    const urlError = urlRulesValidationMessage(draft.urlRules);
    if (urlError) {
      setSection("urls");
      setShowUrlValidationErrors(true);
      setError(`Review the website access settings before saving. ${urlError}`);
      setSaving(false);
      return;
    }
    const toolError = externalToolsValidationMessage(draft.externalTools);
    if (toolError) {
      setSection("tools");
      setShowToolValidationErrors(true);
      setError(`Fix this tool before saving: ${toolError}`);
      setSaving(false);
      return;
    }
    try {
      await onSave(draft);
    } catch (saveError) {
      setError(errorMessage(saveError, "Course defaults could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog large" role="dialog" aria-modal="true" aria-labelledby="defaults-title">
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Course settings</span>
            <h2 id="defaults-title">Safe Online Exam course policy</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            title="Close defaults"
            aria-label="Close course settings"
          >
            <X size={17} />
          </button>
        </header>
        <SavedPasswordReveal
          endpoint={`/api/quizzes/course/${encodeURIComponent(courseId)}/passwords/reveal`}
          authToken={authToken}
        />
        <div className="settings-layout">
          <nav className="settings-navigation" aria-label="Course settings sections">
            <button
              className={clsx("settings-navigation-item", section === "password" && "active")}
              type="button"
              aria-current={section === "password" ? "page" : undefined}
              onClick={() => setSection("password")}
            >
              <Shield size={17} />
              <span>
                <strong>Security</strong>
                <small>Passwords and exits</small>
              </span>
            </button>
            <button
              className={clsx("settings-navigation-item", section === "urls" && "active")}
              type="button"
              aria-current={section === "urls" ? "page" : undefined}
              onClick={() => setSection("urls")}
            >
              <SlidersHorizontal size={17} />
              <span>
                <strong>Advanced</strong>
                <small>Website access rules</small>
              </span>
            </button>
            <button
              className={clsx("settings-navigation-item", section === "tools" && "active")}
              type="button"
              aria-current={section === "tools" ? "page" : undefined}
              onClick={() => setSection("tools")}
            >
              <Calculator size={17} />
              <span>
                <strong>Exam tools</strong>
                <small>Approved student tools</small>
              </span>
            </button>
          </nav>
          <DefaultsEditor
            draft={draft}
            setDraft={setDraft}
            startPasswordEnabled={startPasswordEnabled}
            setStartPasswordEnabled={setStartPasswordEnabled}
            visibleSection={section}
            showPasswordValidationErrors={showPasswordValidationErrors}
            showUrlValidationErrors={showUrlValidationErrors}
            showToolValidationErrors={showToolValidationErrors}
            copyableToolIds={copyableToolIds}
            onCopyTool={setToolToCopy}
          />
        </div>
        {error && (
          <div className="notice error">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions">
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={save} disabled={saving}>
            <Save size={16} /> Save defaults
          </button>
        </footer>
      </section>
      {toolToCopy && (
        <CourseToolCopyDialog
          courseId={courseId}
          authToken={authToken}
          tool={toolToCopy}
          onClose={() => setToolToCopy(null)}
        />
      )}
    </div>
  );
}

export function DefaultsEditor({
  draft,
  setDraft,
  startPasswordEnabled,
  setStartPasswordEnabled,
  visibleSection = "all",
  requireExitPassword = false,
  showPasswordValidationErrors = false,
  showUrlValidationErrors = false,
  showToolValidationErrors = false,
  copyableToolIds,
  onCopyTool
}: {
  draft: CourseSebDefaults;
  setDraft: (value: SetStateAction<CourseSebDefaults>) => void;
  startPasswordEnabled: boolean;
  setStartPasswordEnabled: (enabled: boolean) => void;
  visibleSection?: "all" | "password" | "urls" | "tools";
  requireExitPassword?: boolean;
  showPasswordValidationErrors?: boolean;
  showUrlValidationErrors?: boolean;
  showToolValidationErrors?: boolean;
  copyableToolIds?: ReadonlySet<string>;
  onCopyTool?: (tool: ExternalToolConfig) => void;
}) {
  const showPassword = visibleSection === "all" || visibleSection === "password";
  const showUrls = visibleSection === "all" || visibleSection === "urls";
  const showTools = visibleSection === "all" || visibleSection === "tools";
  const updateStartPasswordEnabled = (enabled: boolean) => {
    setStartPasswordEnabled(enabled);
    if (!enabled) {
      setDraft((current) => ({ ...current, startPassword: null }));
    }
  };
  const hasSavedStartPassword = draft.hasStartPassword === true;
  const hasSavedExitPassword = draft.hasEffectiveQuitPassword === true || draft.hasQuitPassword === true;
  const startPasswordError = startPasswordEnabled
    ? passwordValidationMessage(draft.startPassword, "start", {
        required: !hasSavedStartPassword,
        otherPassword: draft.quitPassword
      })
    : null;
  const exitPasswordError = passwordValidationMessage(draft.quitPassword, "exit", {
    required: requireExitPassword && !hasSavedExitPassword,
    otherPassword: startPasswordEnabled ? draft.startPassword : null
  });

  return (
    <div className="settings-stack">
      {showPassword && (
        <section className="settings-section">
          <SectionHeading title="Start password" />
          <label className="toggle-row compact">
            <input
              type="checkbox"
              checked={startPasswordEnabled}
              onChange={(event) => updateStartPasswordEnabled(event.target.checked)}
            />
            <span>
              <strong>Require a start password</strong>
              <small>Add a second check before an assessment opens in Safe Online Exam.</small>
            </span>
          </label>
          <div className="password-input-group">
            <input
              id="course-start-password"
              type="password"
              value={draft.startPassword || ""}
              disabled={!startPasswordEnabled}
              aria-invalid={showPasswordValidationErrors && !!startPasswordError}
              aria-describedby={draft.startPassword ? "course-start-password-requirements" : undefined}
              onChange={(event) => setDraft((current) => ({ ...current, startPassword: event.target.value }))}
              placeholder={
                startPasswordEnabled ? "Enter a replacement password, or leave blank to keep it" : "Disabled"
              }
              autoComplete="new-password"
              minLength={SEB_PASSWORD_MIN_LENGTH}
              maxLength={SEB_PASSWORD_MAX_LENGTH}
            />
            {startPasswordEnabled && (
              <PasswordRequirements
                id="course-start-password-requirements"
                value={draft.startPassword || ""}
                purpose="start"
                otherPassword={draft.quitPassword}
                hasSavedOtherPassword={hasSavedExitPassword}
              />
            )}
            {showPasswordValidationErrors && startPasswordError && (
              <small className="field-error" role="alert">
                {startPasswordError}
              </small>
            )}
          </div>

          <SectionHeading title="Exit password" />
          <p className="field-help">
            This course password is required before you can enable Safe Online Exam.{" "}
            {requireExitPassword ? "Enter one to continue." : "Leave this blank to keep the current protection."}
          </p>
          <div className="password-input-group">
            <input
              id="course-exit-password"
              type="password"
              value={draft.quitPassword || ""}
              aria-invalid={showPasswordValidationErrors && !!exitPasswordError}
              aria-describedby={draft.quitPassword ? "course-exit-password-requirements" : undefined}
              onChange={(event) => setDraft((current) => ({ ...current, quitPassword: event.target.value }))}
              placeholder={requireExitPassword ? "Enter an exit password" : "Enter a replacement password"}
              autoComplete="new-password"
              minLength={SEB_PASSWORD_MIN_LENGTH}
              maxLength={SEB_PASSWORD_MAX_LENGTH}
              required={requireExitPassword}
            />
            <PasswordRequirements
              id="course-exit-password-requirements"
              value={draft.quitPassword || ""}
              purpose="exit"
              otherPassword={startPasswordEnabled ? draft.startPassword : null}
              hasSavedOtherPassword={startPasswordEnabled && hasSavedStartPassword}
            />
            {showPasswordValidationErrors && exitPasswordError && (
              <small className="field-error" role="alert">
                {exitPasswordError}
              </small>
            )}
          </div>
        </section>
      )}
      {showUrls && (
        <section className="settings-section">
          <SectionHeading
            title="Advanced website access"
            actionLabel="Add URL"
            onAction={() => setDraft((current) => ({ ...current, urlRules: [...current.urlRules, newUrlRule()] }))}
          />
          <UrlRuleEditor
            rules={draft.urlRules}
            onChange={(urlRules) => setDraft((current) => ({ ...current, urlRules }))}
            showValidationErrors={showUrlValidationErrors}
          />
          <p className="field-help">
            Use exam tools for student resources whenever possible. Add URLs only when needed.
          </p>
        </section>
      )}
      {showTools && (
        <section className="settings-section">
          <SectionHeading title="Exam tools" />
          <ToolEditor
            tools={draft.externalTools}
            onChange={(externalTools) => setDraft((current) => ({ ...current, externalTools }))}
            showValidationErrors={showToolValidationErrors}
            copyableToolIds={copyableToolIds}
            onCopyTool={onCopyTool}
          />
        </section>
      )}
    </div>
  );
}

export function useDefaultsDraft(
  defaults: CourseSebDefaults
): [CourseSebDefaults, (value: SetStateAction<CourseSebDefaults>) => void] {
  return useState<CourseSebDefaults>(() => ({
    ...defaults,
    urlRules: normalizeUrlRules(defaults.urlRules),
    externalTools: normalizeCourseExternalTools(defaults.externalTools)
  }));
}
