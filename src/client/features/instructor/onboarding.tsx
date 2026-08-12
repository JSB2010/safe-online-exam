import { AlertCircle, ArrowLeft, Calculator, Check, Lock, Shield, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { CourseSebDefaults } from "../../../shared/models.js";
import { errorMessage } from "../../lib/api.js";
import { useDialogInitialFocus, useEscapeToClose } from "../../hooks/dialog.js";
import { externalToolsValidationMessage } from "../exam-tools/index.js";
import { DefaultsEditor, useDefaultsDraft } from "./defaults.js";
import { coursePasswordValidationMessage } from "./settings-dialog.js";
import { InstructorSetupStep } from "../../types.js";

export function InstructorSetupWizard({
  courseName,
  defaults,
  securityReady,
  enabledAssessmentCount,
  required,
  onClose,
  onComplete
}: {
  courseName: string;
  defaults: CourseSebDefaults;
  securityReady: boolean;
  enabledAssessmentCount: number;
  required: boolean;
  onClose: () => void;
  onComplete: (defaults: CourseSebDefaults) => Promise<void>;
}) {
  useEscapeToClose(required ? undefined : onClose);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogInitialFocus(dialogRef);
  const [step, setStep] = useState<InstructorSetupStep>("welcome");
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [startPasswordEnabled, setStartPasswordEnabled] = useState(
    () => !!draft.startPassword || draft.hasStartPassword === true
  );
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const [showPasswordValidationErrors, setShowPasswordValidationErrors] = useState(false);
  const [showToolValidationErrors, setShowToolValidationErrors] = useState(false);
  const steps: Array<{ id: InstructorSetupStep; label: string }> = [
    { id: "welcome", label: "Welcome" },
    { id: "security", label: "Exit password" },
    { id: "tools", label: "Exam tools" },
    { id: "enable", label: "First assessment" }
  ];
  const stepIndex = steps.findIndex((candidate) => candidate.id === step);
  const previousStep = stepIndex > 0 ? steps[stepIndex - 1].id : null;
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1].id : null;
  const hasExistingExitSecurity = securityReady;

  useEffect(() => {
    setError("");
  }, [draft, startPasswordEnabled]);

  const validateStep = (candidate: InstructorSetupStep): boolean => {
    if (candidate === "security") {
      const passwordError = coursePasswordValidationMessage(draft, startPasswordEnabled, !hasExistingExitSecurity);
      setShowPasswordValidationErrors(!!passwordError);
      if (passwordError) {
        setError("Review the highlighted password requirements before continuing.");
        return false;
      }
    }
    if (candidate === "tools") {
      const toolError = externalToolsValidationMessage(draft.externalTools);
      setShowToolValidationErrors(!!toolError);
      if (toolError) {
        setError(`Review the exam tool settings before continuing. ${toolError}`);
        return false;
      }
    }
    return true;
  };

  const advance = () => {
    if (!nextStep || !validateStep(step)) return;
    setError("");
    setStep(nextStep);
  };

  const finish = async () => {
    const passwordError = coursePasswordValidationMessage(draft, startPasswordEnabled, !hasExistingExitSecurity);
    const toolError = externalToolsValidationMessage(draft.externalTools);
    if (passwordError || toolError) {
      setShowPasswordValidationErrors(!!passwordError);
      setShowToolValidationErrors(!!toolError);
      setStep(passwordError ? "security" : toolError ? "tools" : "security");
      setError(
        passwordError
          ? "Review the highlighted password requirements before finishing setup."
          : `Review the exam tool settings. ${toolError}`
      );
      return;
    }
    setFinishing(true);
    setError("");
    try {
      await onComplete(draft);
    } catch (completeError) {
      setError(errorMessage(completeError, "Course setup could not be completed."));
    } finally {
      setFinishing(false);
    }
  };

  const content = {
    welcome: {
      title: "Let’s get your course ready",
      description:
        "You will set one required exit password, choose any exam tools students need, then enable an assessment."
    },
    security: {
      title: "Set your course exit password",
      description: "Students need this password to leave a Safe Online Exam session."
    },
    tools: {
      title: "Choose course exam tools",
      description: "Add the approved tools students need during an assessment. You can skip this if they need none."
    },
    enable: {
      title: "Enable the first assessment",
      description:
        enabledAssessmentCount > 0
          ? `${enabledAssessmentCount} assessment${enabledAssessmentCount === 1 ? " is" : "s are"} already enabled. Finish this guide, then use the course list whenever you need to adjust one.`
          : "Finish this guide, then choose an assessment from the course list to enable Safe Online Exam."
    }
  }[step];

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog instructor-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-wizard-title"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Guided course setup</span>
            <h2 id="setup-wizard-title">Set up Safe Online Exam</h2>
          </div>
          {!required && (
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              title="Close setup"
              aria-label="Close setup"
            >
              <X size={17} />
            </button>
          )}
        </header>
        <p className="setup-wizard-course">
          {required
            ? `${courseName} is connected to Canvas. Complete the required course policy before managing assessments.`
            : `${courseName} is connected to Canvas. Review these steps, then manage future changes from Settings.`}
        </p>
        <ol className="setup-wizard-progress" aria-label="Course setup progress">
          {steps.map((candidate, index) => (
            <li className={clsx(index === stepIndex && "active", index < stepIndex && "complete")} key={candidate.id}>
              <button
                type="button"
                disabled={index > stepIndex}
                onClick={() => {
                  setError("");
                  setStep(candidate.id);
                }}
              >
                <span>{index < stepIndex ? <Check size={14} /> : index + 1}</span>
                {candidate.label}
              </button>
            </li>
          ))}
        </ol>
        <section className="setup-wizard-body" aria-live="polite">
          <span className="section-kicker">
            Step {stepIndex + 1} of {steps.length}
          </span>
          <h3>{content.title}</h3>
          <p>{content.description}</p>
          {step === "welcome" && (
            <div className="setup-wizard-welcome" aria-label="What you will set up">
              <div>
                <Shield size={18} />
                <span>
                  <strong>Exit password</strong>
                  <small>Required before an assessment can be enabled.</small>
                </span>
              </div>
              <div>
                <Calculator size={18} />
                <span>
                  <strong>Exam tools</strong>
                  <small>Optional tools students can use during the assessment.</small>
                </span>
              </div>
            </div>
          )}
          {(step === "security" || step === "tools") && (
            <div className="setup-wizard-editor">
              <DefaultsEditor
                draft={draft}
                setDraft={setDraft}
                startPasswordEnabled={startPasswordEnabled}
                setStartPasswordEnabled={setStartPasswordEnabled}
                visibleSection={step === "security" ? "password" : "tools"}
                requireExitPassword={step === "security" && !hasExistingExitSecurity}
                showPasswordValidationErrors={showPasswordValidationErrors}
                showToolValidationErrors={showToolValidationErrors}
              />
            </div>
          )}
          <p className="setup-wizard-reassurance">
            You can always change these later in Course Settings or for an individual quiz.
          </p>
        </section>
        <footer className="dialog-actions setup-wizard-actions">
          {!required && (
            <button className="button secondary" type="button" onClick={onClose}>
              Finish later
            </button>
          )}
          {previousStep && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setError("");
                setStep(previousStep);
              }}
            >
              <ArrowLeft size={16} /> Back
            </button>
          )}
          {step === "enable" ? (
            <button className="button primary" type="button" disabled={finishing} onClick={() => void finish()}>
              <Check size={16} /> {finishing ? "Saving…" : "Save and finish"}
            </button>
          ) : nextStep ? (
            <button className="button primary" type="button" onClick={advance}>
              {step === "security" ? <Lock size={16} /> : <Check size={16} />} Continue
            </button>
          ) : null}
        </footer>
        {error && (
          <div className="notice error setup-validation-error" role="alert">
            <AlertCircle size={17} /> <span>{error}</span>
          </div>
        )}
      </section>
    </div>
  );
}
