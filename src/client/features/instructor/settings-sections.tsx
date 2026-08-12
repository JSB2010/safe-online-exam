import { ChevronDown } from "lucide-react";
import type { ExternalToolConfig, SebUrlRule } from "../../../shared/models.js";
import { SEB_PASSWORD_MAX_LENGTH, SEB_PASSWORD_MIN_LENGTH } from "../../../shared/seb-password-policy.js";
import { QuizToolSelector, ToolEditor, UrlRuleEditor } from "../exam-tools/index.js";
import { SectionHeading } from "../../components/feedback.js";
import { PasswordRequirements, passwordValidationMessage } from "./settings-dialog.js";
import { newUrlRule } from "../../lib/settings.js";

export function SettingsSections({
  urlRules,
  setUrlRules,
  courseTools,
  externalToolIds,
  setExternalToolIds,
  quizOnlyTools,
  setQuizOnlyTools,
  quitPassword,
  setQuitPassword,
  startPassword,
  setStartPassword,
  passwordOverride,
  setPasswordOverride,
  startPasswordOverride,
  setStartPasswordOverride,
  hasSavedPasswordOverride,
  hasSavedStartPasswordOverride,
  hasDefaultPassword,
  hasDefaultStartPassword,
  showPasswordValidationErrors = false,
  showUrlValidationErrors = false,
  showToolValidationErrors = false
}: {
  urlRules: SebUrlRule[];
  setUrlRules: (rules: SebUrlRule[]) => void;
  courseTools: ExternalToolConfig[];
  externalToolIds: string[] | null;
  setExternalToolIds: (ids: string[] | null) => void;
  quizOnlyTools: ExternalToolConfig[];
  setQuizOnlyTools: (tools: ExternalToolConfig[]) => void;
  quitPassword: string;
  setQuitPassword: (value: string) => void;
  startPassword: string;
  setStartPassword: (value: string) => void;
  passwordOverride: boolean;
  setPasswordOverride: (value: boolean) => void;
  startPasswordOverride: boolean;
  setStartPasswordOverride: (value: boolean) => void;
  hasSavedPasswordOverride: boolean;
  hasSavedStartPasswordOverride: boolean;
  hasDefaultPassword: boolean;
  hasDefaultStartPassword: boolean;
  showPasswordValidationErrors?: boolean;
  showUrlValidationErrors?: boolean;
  showToolValidationErrors?: boolean;
}) {
  const startPasswordError = startPasswordOverride
    ? passwordValidationMessage(startPassword, "start", {
        required: !hasSavedStartPasswordOverride,
        otherPassword: passwordOverride ? quitPassword : null
      })
    : null;
  const exitPasswordError = passwordOverride
    ? passwordValidationMessage(quitPassword, "exit", {
        required: !hasSavedPasswordOverride,
        otherPassword: startPasswordOverride ? startPassword : null
      })
    : null;
  return (
    <div className="settings-stack">
      <section className="settings-section">
        <SectionHeading title="Exam start password" />
        <label className="toggle-row compact">
          <input
            type="checkbox"
            checked={startPasswordOverride}
            onChange={(event) => setStartPasswordOverride(event.target.checked)}
          />
          <span>
            <strong>Set a quiz-specific start password</strong>
            <small>
              {hasDefaultStartPassword
                ? "Otherwise this quiz uses the course default."
                : "Otherwise this quiz has no start password."}
            </small>
          </span>
        </label>
        <div className="password-input-group">
          <input
            id="quiz-start-password"
            type="password"
            value={startPasswordOverride ? startPassword : ""}
            disabled={!startPasswordOverride}
            aria-invalid={showPasswordValidationErrors && !!startPasswordError}
            aria-describedby={startPassword ? "quiz-start-password-requirements" : undefined}
            onChange={(event) => setStartPassword(event.target.value)}
            placeholder={
              startPasswordOverride ? "Enter a replacement password, or leave blank to keep it" : "Using course default"
            }
            autoComplete="new-password"
            minLength={SEB_PASSWORD_MIN_LENGTH}
            maxLength={SEB_PASSWORD_MAX_LENGTH}
          />
          {startPasswordOverride && (
            <PasswordRequirements
              id="quiz-start-password-requirements"
              value={startPassword}
              purpose="start"
              otherPassword={passwordOverride ? quitPassword : null}
              hasSavedOtherPassword={hasSavedPasswordOverride}
            />
          )}
          {showPasswordValidationErrors && startPasswordError && (
            <small className="field-error" role="alert">
              {startPasswordError}
            </small>
          )}
        </div>
      </section>

      <section className="settings-section">
        <SectionHeading title="Exit password" />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={passwordOverride}
            onChange={(event) => setPasswordOverride(event.target.checked)}
          />
          <span>
            <strong>Use a different exit password for this quiz</strong>
            <small>
              {hasDefaultPassword
                ? "Otherwise this quiz uses the course or managed server default."
                : "A course, quiz, or managed server exit password is required while Safe Online Exam is enabled."}
            </small>
          </span>
        </label>
        <div className="password-input-group">
          <input
            id="quiz-exit-password"
            type="password"
            value={passwordOverride ? quitPassword : ""}
            disabled={!passwordOverride}
            aria-invalid={showPasswordValidationErrors && !!exitPasswordError}
            aria-describedby={quitPassword ? "quiz-exit-password-requirements" : undefined}
            onChange={(event) => setQuitPassword(event.target.value)}
            placeholder={
              passwordOverride ? "Enter a replacement password, or leave blank to keep it" : "Using course default"
            }
            autoComplete="new-password"
            minLength={SEB_PASSWORD_MIN_LENGTH}
            maxLength={SEB_PASSWORD_MAX_LENGTH}
          />
          {passwordOverride && (
            <PasswordRequirements
              id="quiz-exit-password-requirements"
              value={quitPassword}
              purpose="exit"
              otherPassword={startPasswordOverride ? startPassword : null}
              hasSavedOtherPassword={hasSavedStartPasswordOverride}
            />
          )}
          {showPasswordValidationErrors && exitPasswordError && (
            <small className="field-error" role="alert">
              {exitPasswordError}
            </small>
          )}
        </div>
      </section>

      <details className="advanced-settings-disclosure">
        <summary>
          <span>
            <strong>Advanced website access</strong>
            <small>Use this only when an exam tool cannot cover the resource.</small>
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="advanced-settings-content">
          <SectionHeading
            title="Allowed URLs"
            actionLabel="Add URL"
            onAction={() => setUrlRules([...urlRules, newUrlRule()])}
          />
          <UrlRuleEditor rules={urlRules} onChange={setUrlRules} showValidationErrors={showUrlValidationErrors} />
        </div>
      </details>

      <section className="settings-section">
        <SectionHeading title="Exam tools" />
        <QuizToolSelector tools={courseTools} selectedIds={externalToolIds} onChange={setExternalToolIds} />
        <div className="quiz-only-tools">
          <div>
            <strong>Tools for this quiz only</strong>
            <small>
              Add a tool here when it should not appear in the course catalog. Its URL policy applies only to this quiz.
            </small>
          </div>
          <ToolEditor
            tools={quizOnlyTools}
            onChange={setQuizOnlyTools}
            showValidationErrors={showToolValidationErrors}
          />
        </div>
      </section>
    </div>
  );
}
