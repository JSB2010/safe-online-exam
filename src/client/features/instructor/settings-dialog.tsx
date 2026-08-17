import { AlertCircle, Check, Eye, EyeOff, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { CourseSebDefaults, ExternalToolConfig, SebUrlRule } from "../../../shared/models.js";
import { canEnableSebAssessment, normalizeCourseExternalTools, normalizeUrlRules } from "../../../shared/models.js";
import {
  evaluateSebPasswordRequirements,
  normalizeSebPassword,
  SEB_PASSWORD_MAX_LENGTH,
  SEB_PASSWORD_MIN_LENGTH,
  sebPasswordPolicyMessage,
  sebPasswordPolicyViolation
} from "../../../shared/seb-password-policy.js";
import type { SebPasswordPurpose } from "../../../shared/seb-password-policy.js";
import { actionHeaders, apiMessage, errorMessage, redirectForAuth, requestJson } from "../../lib/api.js";
import { useDialogInitialFocus, useEscapeToClose } from "../../hooks/dialog.js";
import { externalToolsValidationMessage, urlRulesValidationMessage } from "../exam-tools/index.js";
import { SettingsSections } from "./settings-sections.js";
import { rulesForSetting } from "../../lib/settings.js";
import { QuizView, RevealedPasswordValue } from "../../types.js";

export function SettingsDialog({
  item,
  courseId,
  userId,
  authToken,
  setting,
  courseDefaults,
  onClose,
  onSaved,
  onReset
}: {
  item: QuizView;
  courseId: string;
  userId: string;
  authToken?: string;
  setting: Record<string, any>;
  courseDefaults: CourseSebDefaults;
  onClose: () => void;
  onSaved: (body: any) => void;
  onReset: (body: any) => void;
}) {
  useEscapeToClose(onClose);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogInitialFocus(closeButtonRef);
  const [usesDefaults, setUsesDefaults] = useState(setting.usesCourseDefaults !== false);
  const [urlRules, setUrlRules] = useState<SebUrlRule[]>(() => rulesForSetting(setting, courseDefaults));
  const [externalToolIds, setExternalToolIds] = useState<string[] | null>(() =>
    Array.isArray(setting.externalToolIds)
      ? setting.externalToolIds.filter((id: unknown) => typeof id === "string")
      : null
  );
  const [quizOnlyTools, setQuizOnlyTools] = useState<ExternalToolConfig[]>(() =>
    normalizeCourseExternalTools(setting.quizOnlyExternalTools).map((tool) => ({ ...tool, enabled: true }))
  );
  const [passwordOverride, setPasswordOverride] = useState(setting.quitPasswordOverride === true);
  const [quitPassword, setQuitPassword] = useState("");
  const [startPasswordOverride, setStartPasswordOverride] = useState(setting.startPasswordOverride === true);
  const [startPassword, setStartPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPasswordValidationErrors, setShowPasswordValidationErrors] = useState(false);
  const [showUrlValidationErrors, setShowUrlValidationErrors] = useState(false);
  const [showToolValidationErrors, setShowToolValidationErrors] = useState(false);

  useEffect(() => {
    setError(null);
  }, [externalToolIds, passwordOverride, quitPassword, quizOnlyTools, startPassword, startPasswordOverride, urlRules]);

  const customizeUrlRules = (next: SebUrlRule[]) => {
    setUsesDefaults(false);
    setUrlRules(next);
  };
  const customizeExternalToolIds = (next: string[] | null) => setExternalToolIds(next);
  const customizePasswordOverride = (next: boolean) => {
    setUsesDefaults(false);
    setPasswordOverride(next);
  };
  const customizeQuitPassword = (next: string) => {
    setUsesDefaults(false);
    setQuitPassword(next);
  };
  const customizeStartPasswordOverride = (next: boolean) => {
    setUsesDefaults(false);
    setStartPasswordOverride(next);
  };
  const customizeStartPassword = (next: string) => {
    setUsesDefaults(false);
    setStartPassword(next);
  };

  async function save() {
    setSaving(true);
    setError(null);
    const startPasswordError = startPasswordOverride
      ? passwordValidationMessage(startPassword, "start", {
          required: !(setting.startPasswordOverride === true && setting.hasStartPassword === true),
          otherPassword: passwordOverride ? quitPassword : null
        })
      : null;
    const exitPasswordError = passwordOverride
      ? passwordValidationMessage(quitPassword, "exit", {
          required: !(setting.quitPasswordOverride === true && setting.hasQuitPassword === true),
          otherPassword: startPasswordOverride ? startPassword : null
        })
      : null;
    if (startPasswordError || exitPasswordError) {
      setShowPasswordValidationErrors(true);
      setError("Review the highlighted quiz password requirements before saving.");
      setSaving(false);
      return;
    }
    const urlError = urlRulesValidationMessage(urlRules);
    if (urlError) {
      setShowUrlValidationErrors(true);
      setError(`Review the website access settings before saving. ${urlError}`);
      setSaving(false);
      return;
    }
    const toolError = externalToolsValidationMessage(quizOnlyTools);
    if (toolError) {
      setShowToolValidationErrors(true);
      setError(`Fix this tool before saving: ${toolError}`);
      setSaving(false);
      return;
    }
    try {
      const body = {
        quizId: item.id,
        contentId: item.id.startsWith("newquiz:") ? item.id : undefined,
        courseId,
        ssoDomains: [],
        educationalToolDomains: [],
        urlRules,
        externalToolIds,
        quizOnlyExternalTools: quizOnlyTools,
        quitPassword: passwordOverride ? quitPassword : null,
        startPassword: startPasswordOverride ? startPassword : null,
        usesCourseDefaults: usesDefaults,
        quitPasswordOverride: passwordOverride,
        startPasswordOverride
      };
      const saved = await requestJson(`/api/quizzes/seb-config-structured?userId=${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...actionHeaders(authToken) },
        body: JSON.stringify(body)
      });
      if (redirectForAuth(saved)) return;
      if (!saved.success && !saved.setting) {
        setError(apiMessage(saved, "Safe Online Exam settings could not be saved."));
        return;
      }
      onSaved(saved);
    } catch (saveError) {
      setError(errorMessage(saveError, "Safe Online Exam settings could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    setSaving(true);
    setError(null);
    try {
      const saved = await requestJson(
        `/api/quizzes/${encodeURIComponent(courseId)}/${encodeURIComponent(item.id)}/seb/reset-defaults`,
        { method: "POST", headers: actionHeaders(authToken) }
      );
      if (redirectForAuth(saved)) return;
      if (!saved.success && !saved.setting) {
        setError(apiMessage(saved, "Could not reset quiz defaults."));
        return;
      }
      setUsesDefaults(true);
      setUrlRules(normalizeUrlRules(courseDefaults.urlRules));
      setExternalToolIds(null);
      setQuizOnlyTools([]);
      setPasswordOverride(false);
      setQuitPassword("");
      setStartPasswordOverride(false);
      setStartPassword("");
      onReset(saved);
    } catch (resetError) {
      setError(errorMessage(resetError, "Could not reset quiz defaults."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog large" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Quiz settings</span>
            <h2 id="settings-title">{item.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close settings">
            <X size={17} />
          </button>
        </header>

        <SavedPasswordReveal
          endpoint={`/api/quizzes/${encodeURIComponent(courseId)}/${encodeURIComponent(item.id)}/passwords/reveal`}
          authToken={authToken}
        />

        <SettingsSections
          urlRules={urlRules}
          setUrlRules={customizeUrlRules}
          courseTools={courseDefaults.externalTools}
          externalToolIds={externalToolIds}
          setExternalToolIds={customizeExternalToolIds}
          quizOnlyTools={quizOnlyTools}
          setQuizOnlyTools={(tools) => {
            setUsesDefaults(false);
            setShowToolValidationErrors(false);
            setQuizOnlyTools(tools.map((tool) => ({ ...tool, enabled: true })));
          }}
          showToolValidationErrors={showToolValidationErrors}
          quitPassword={quitPassword}
          setQuitPassword={customizeQuitPassword}
          startPassword={startPassword}
          setStartPassword={customizeStartPassword}
          passwordOverride={passwordOverride}
          setPasswordOverride={customizePasswordOverride}
          startPasswordOverride={startPasswordOverride}
          setStartPasswordOverride={customizeStartPasswordOverride}
          hasSavedPasswordOverride={setting.quitPasswordOverride === true && setting.hasQuitPassword === true}
          hasSavedStartPasswordOverride={setting.startPasswordOverride === true && setting.hasStartPassword === true}
          hasDefaultPassword={canEnableSebAssessment(undefined, courseDefaults)}
          hasDefaultStartPassword={courseDefaults.hasStartPassword === true}
          showPasswordValidationErrors={showPasswordValidationErrors}
          showUrlValidationErrors={showUrlValidationErrors}
        />

        {error && (
          <div className="notice error">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions">
          <button className="button secondary" onClick={resetDefaults} disabled={saving}>
            Reset to defaults
          </button>
          <div className="dialog-action-group">
            <button className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" onClick={save} disabled={saving}>
              <Save size={16} /> Save settings
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function SavedPasswordReveal({ endpoint, authToken }: { endpoint: string; authToken?: string }) {
  const [passwords, setPasswords] = useState<{
    start: RevealedPasswordValue;
    exit: RevealedPasswordValue;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passwords) return;
    const timer = window.setTimeout(() => setPasswords(null), 30_000);
    return () => window.clearTimeout(timer);
  }, [passwords]);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const body = await requestJson(endpoint, { method: "POST", headers: actionHeaders(authToken) });
      setPasswords(body.passwords || null);
    } catch (revealError) {
      setError(errorMessage(revealError, "Saved passwords could not be revealed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="saved-password-reveal" aria-live="polite">
      <div>
        <strong>Saved passwords</strong>
        <small>Instructor-only. Revealed values hide automatically after 30 seconds.</small>
      </div>
      {!passwords ? (
        <button className="button secondary" type="button" onClick={reveal} disabled={busy}>
          <Eye size={16} /> {busy ? "Revealing…" : "Reveal saved passwords"}
        </button>
      ) : (
        <div className="saved-password-values">
          <PasswordRevealValue label="Start" password={passwords.start} />
          <PasswordRevealValue label="Exit" password={passwords.exit} />
          <button className="icon-button" type="button" onClick={() => setPasswords(null)} title="Hide passwords">
            <EyeOff size={16} />
          </button>
        </div>
      )}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </section>
  );
}

function PasswordRevealValue({ label, password }: { label: string; password: RevealedPasswordValue }) {
  const source =
    password.source === "assessment"
      ? "quiz"
      : password.source === "course"
        ? "course default"
        : password.source === "managed"
          ? "managed by server"
          : "not set";
  return (
    <span className="saved-password-value">
      <strong>{label}</strong>
      <span>{password.value || (password.source === "managed" ? "Hidden managed default" : "Not set")}</span>
      <small>{source}</small>
    </span>
  );
}

export function PasswordRequirements({
  value,
  purpose,
  otherPassword,
  hasSavedOtherPassword = false,
  id
}: {
  value: string;
  purpose: SebPasswordPurpose;
  otherPassword?: string | null;
  hasSavedOtherPassword?: boolean;
  id: string;
}) {
  if (!value) return null;
  const state = evaluateSebPasswordRequirements(value, otherPassword);
  const otherLabel = purpose === "exit" ? "start" : "exit";
  const hasTypedOtherPassword = !!normalizeSebPassword(otherPassword);
  const requirements = [
    {
      label: `${SEB_PASSWORD_MIN_LENGTH}–${SEB_PASSWORD_MAX_LENGTH} characters after surrounding spaces are removed`,
      met: state.hasAllowedLength
    },
    { label: "At least 5 different letters or numbers", met: state.hasEnoughDistinctCharacters },
    { label: "No common words, sequences, or repeated patterns", met: state.avoidsPredictablePatterns },
    { label: "No control or invisible formatting characters", met: state.hasNoControlCharacters },
    {
      label:
        hasSavedOtherPassword && !hasTypedOtherPassword
          ? `Different from the saved ${otherLabel} password (checked when you save)`
          : `Different from the ${otherLabel} password`,
      met: state.differsFromOtherPassword && (!hasSavedOtherPassword || hasTypedOtherPassword),
      pending: hasSavedOtherPassword && !hasTypedOtherPassword
    }
  ];
  return (
    <div className="password-requirements" id={id} aria-live="polite">
      <strong>Password requirements</strong>
      <ul>
        {requirements.map((requirement) => (
          <li className={clsx(requirement.met && "met", requirement.pending && "pending")} key={requirement.label}>
            <span aria-hidden="true">{requirement.met ? <Check size={13} /> : null}</span>
            {requirement.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function passwordValidationMessage(
  value: string | null | undefined,
  purpose: SebPasswordPurpose,
  options: {
    required?: boolean;
    otherPassword?: string | null;
  } = {}
): string | null {
  const violation = sebPasswordPolicyViolation(value);
  const normalized = normalizeSebPassword(value);
  if (violation === "control-character") {
    return sebPasswordPolicyMessage(purpose, violation);
  }
  if (!normalized) {
    return options.required
      ? `Enter a ${purpose === "exit" ? "course exit" : "start"} password before continuing.`
      : null;
  }
  if (violation) {
    return sebPasswordPolicyMessage(purpose, violation);
  }
  if (!evaluateSebPasswordRequirements(normalized, options.otherPassword).differsFromOtherPassword) {
    return "Start and exit passwords must be different. Use the exit password only when a student needs permission to leave Safe Exam Browser.";
  }
  return null;
}

export function coursePasswordValidationMessage(
  draft: CourseSebDefaults,
  startPasswordEnabled: boolean,
  requireExitPassword = false
): string | null {
  const hasSavedStartPassword = draft.hasStartPassword === true;
  const hasSavedExitPassword = draft.hasEffectiveQuitPassword === true || draft.hasQuitPassword === true;
  if (startPasswordEnabled) {
    const startError = passwordValidationMessage(draft.startPassword, "start", {
      required: !hasSavedStartPassword,
      otherPassword: draft.quitPassword
    });
    if (startError) return startError;
  }
  return passwordValidationMessage(draft.quitPassword, "exit", {
    required: requireExitPassword && !hasSavedExitPassword,
    otherPassword: startPasswordEnabled ? draft.startPassword : null
  });
}
