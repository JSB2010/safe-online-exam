import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Calculator,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Lock,
  LogOut,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Trash2,
  Unlock,
  X
} from "lucide-react";
import type { ReactNode, RefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type {
  CourseSebDefaults,
  ExternalToolAccessRule,
  ExternalToolConfig,
  SebUrlRule,
  SebUrlRuleMatch
} from "../shared/models.js";
import {
  canEnableSebAssessment,
  legacyDomainsToUrlRules,
  normalizeCourseExternalTools,
  normalizeUrlRules
} from "../shared/models.js";

interface BootstrapPayload {
  view: string;
  data: Record<string, any>;
}

interface QuizView {
  id: string;
  title: string;
  description?: string | null;
  htmlUrl?: string | null;
  contentType?: string | null;
  quizTypeDisplay?: string | null;
  updatedAt?: string | null;
}

interface StudentQuizView extends QuizView {
  sebLaunchUrl: string;
  configUrl?: string;
  configGrantUrl?: string;
}

interface OnboardingContext {
  connection?: "required" | "connected";
  resumeAssessment?: boolean;
  readinessRecommended?: boolean;
  showReadinessPrompt?: boolean;
  canvasConnection?: "connected";
  courseSecurityReady?: boolean;
  courseSetupComplete?: boolean;
  enabledAssessmentCount?: number;
}

type InstructorSetupStep = "security" | "tools" | "urls" | "enable";

type Toast = {
  id: string;
  tone: "success" | "error";
  message: string;
};

type OnboardingRecovery = {
  message: string;
  actionLabel?: string;
  actionUrl?: string;
};

function readBootstrap(): BootstrapPayload {
  const element = document.getElementById("seb-bootstrap");
  if (!element?.textContent) {
    return { view: "teacher", data: {} };
  }
  try {
    const value = JSON.parse(element.textContent) as Partial<BootstrapPayload>;
    return typeof value.view === "string" && value.data && typeof value.data === "object"
      ? { view: value.view, data: value.data }
      : { view: "teacher", data: {} };
  } catch {
    return { view: "teacher", data: {} };
  }
}

const bootstrap = readBootstrap();

export function App() {
  switch (bootstrap.view) {
    case "teacher":
      return <TeacherDashboard data={bootstrap.data} />;
    case "api-authorization":
      return <AuthorizationPage data={bootstrap.data} />;
    case "student-session-authorization":
      return <StudentSessionAuthorizationPage data={bootstrap.data} />;
    case "student-session-connected":
      return <StudentSessionConnectedPage data={bootstrap.data} />;
    case "seb-required":
    case "seb-download":
      return <SebDownloadPage data={bootstrap.data} />;
    case "seb-launching":
      return <SebLaunchingPage data={bootstrap.data} />;
    case "seb-exit":
      return <SebExitPage data={bootstrap.data} />;
    case "seb-quit":
      return <SebQuitPage data={bootstrap.data} />;
    case "oauth-error":
      return <OAuthErrorPage data={bootstrap.data} />;
    case "student":
      return <StudentDashboard data={bootstrap.data} />;
    case "admin-setup":
      return <AdminSetupPage data={bootstrap.data} />;
    case "seb-check":
      return <SebSetupCheckPage data={bootstrap.data} />;
    case "service-status":
      return <ServiceStatusPage />;
    default:
      return <MessagePage icon={<Shield />} title="Safe Exam Browser" message="This service is running." />;
  }
}

function ServiceStatusPage() {
  return (
    <main className="app-shell service-shell">
      <header className="topbar">
        <div className="topbar-title">
          <div className="brand-mark">
            <Shield size={20} />
          </div>
          <div>
            <h1>Canvas SEB LTI</h1>
            <p>Safe Exam Browser integration service</p>
          </div>
        </div>
        <div className="stat-pill active">
          <span>Status</span>
          <strong>UP</strong>
        </div>
      </header>
      <section className="work-surface service-status-panel">
        <div className="service-status-main">
          <div className="message-icon">
            <Check size={22} />
          </div>
          <span className="section-kicker">Service status</span>
          <h2>Canvas SEB LTI service is running</h2>
          <p>Launch from Canvas to manage quizzes or open SEB assessments.</p>
        </div>
      </section>
    </main>
  );
}

function TeacherDashboard({ data }: { data: Record<string, any> }) {
  const [items] = useState<QuizView[]>(data.quizzes || []);
  const [settings, setSettings] = useState<Record<string, any>>(data.quizSebSettings || {});
  const [courseDefaults, setCourseDefaults] = useState<CourseSebDefaults>(() =>
    normalizeCourseDefaults(data.courseDefaults, data.courseId)
  );
  const [query, setQuery] = useState("");
  const [activeItem, setActiveItem] = useState<QuizView | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const [defaultsInitialSection, setDefaultsInitialSection] = useState<"password" | "urls" | "tools">("password");
  const [showSetupWizard, setShowSetupWizard] = useState(data.showSetupWizard === true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [recovery, setRecovery] = useState<OnboardingRecovery | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.title} ${item.quizTypeDisplay || ""}`.toLowerCase().includes(normalized));
  }, [items, query]);

  const activeCount = useMemo(
    () => Object.values(settings).filter((setting: any) => setting?.sebRequired).length,
    [settings]
  );
  const needsExitPassword = useMemo(
    () =>
      items.some(
        (item) => !settings[item.id]?.sebRequired && !canEnableSebAssessment(settings[item.id], courseDefaults)
      ),
    [courseDefaults, items, settings]
  );
  const onboarding = (data.onboarding || {}) as OnboardingContext;
  const courseSecurityReady =
    onboarding.courseSecurityReady === true || canEnableSebAssessment(undefined, courseDefaults);

  const openCourseSettings = (section: "password" | "urls" | "tools" = "password") => {
    setDefaultsInitialSection(section);
    setShowDefaults(true);
  };
  const handleRecovery = (value: unknown) => {
    const next = onboardingRecovery(value, "instructor");
    if (next) {
      setRecovery(next);
      pushToast("error", next.message);
    }
  };

  const pushToast = (tone: Toast["tone"], message: string) => {
    const id = clientId("toast");
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  };

  async function toggleSeb(item: QuizView) {
    const enabled = !!settings[item.id]?.sebRequired;
    if (!enabled && !canEnableSebAssessment(settings[item.id], courseDefaults)) {
      openCourseSettings("password");
      pushToast("error", "Set an exit password in Settings before enabling SEB.");
      return;
    }
    setBusyId(item.id);
    try {
      const body = await requestJson(
        `/api/quizzes/${encodeURIComponent(data.courseId)}/${encodeURIComponent(item.id)}/seb/${enabled ? "disable" : "enable"}`,
        { method: "POST", headers: actionHeaders(data.authToken) }
      );
      if (redirectForAuth(body)) return;
      if (!body.success) {
        handleRecovery(body);
        pushToast("error", body.message || "The SEB setting could not be updated.");
      } else {
        setSettings((current) => ({
          ...current,
          [item.id]: body.setting || { ...current[item.id], sebRequired: !enabled }
        }));
        pushToast("success", enabled ? "SEB disabled." : "SEB enabled.");
      }
    } catch (error) {
      handleRecovery(error);
      pushToast("error", errorMessage(error, "The SEB setting could not be updated."));
    } finally {
      setBusyId(null);
    }
  }

  async function refresh() {
    setBusyId("refresh");
    try {
      const body = await requestJson(`/api/quizzes/course/${encodeURIComponent(data.courseId)}/refresh`, {
        method: "POST",
        headers: actionHeaders(data.authToken)
      });
      if (redirectForAuth(body)) return;
      if (body.success) {
        window.location.assign("/lti/launch");
      } else {
        handleRecovery(body);
        pushToast("error", body.message || "Could not refresh Canvas content.");
      }
    } catch (error) {
      handleRecovery(error);
      pushToast("error", errorMessage(error, "Could not refresh Canvas content."));
    } finally {
      setBusyId(null);
    }
  }

  async function saveCourseDefaults(next: CourseSebDefaults, successMessage = "Course defaults saved.") {
    const body = await requestJson(`/api/quizzes/course/${encodeURIComponent(data.courseId)}/defaults`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
      body: JSON.stringify(next)
    });
    if (redirectForAuth(body)) return;
    if (!body.success) {
      handleRecovery(body);
      throw new Error(body.message || "Course defaults could not be saved.");
    }
    setCourseDefaults(normalizeCourseDefaults(body.defaults, data.courseId));
    if (successMessage) {
      pushToast("success", successMessage);
    }
  }

  async function completeSetupWizard(next: CourseSebDefaults) {
    await saveCourseDefaults({ ...next, setupCompleted: true }, "");
    setShowSetupWizard(false);
    pushToast("success", "Course setup complete. You can now enable your first assessment.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <div className="brand-mark">
            <Shield size={20} />
          </div>
          <div>
            <h1>Safe Exam Browser</h1>
            <p>{data.courseName || `Course ${data.courseId}`}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="stat-pill">
            <span>Total</span>
            <strong>{items.length}</strong>
          </div>
          <div className="stat-pill active">
            <span>Active</span>
            <strong>{activeCount}</strong>
          </div>
          <button
            className="icon-button"
            onClick={refresh}
            disabled={busyId === "refresh"}
            title="Refresh Canvas content"
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="button secondary header-settings-button"
            type="button"
            onClick={() => openCourseSettings()}
          >
            <Settings size={16} /> Settings
          </button>
        </div>
      </header>

      {showSetupWizard && (
        <InstructorSetupWizard
          courseName={data.courseName || `Course ${data.courseId}`}
          defaults={courseDefaults}
          securityReady={courseSecurityReady}
          enabledAssessmentCount={onboarding.enabledAssessmentCount || activeCount}
          required={onboarding.courseSetupComplete !== true && courseDefaults.setupCompleted !== true}
          onClose={() => setShowSetupWizard(false)}
          onComplete={completeSetupWizard}
        />
      )}

      {recovery && <RecoveryNotice recovery={recovery} onDismiss={() => setRecovery(null)} />}

      <section className="work-surface assessment-surface">
        <div className="list-header">
          <div>
            <span className="section-kicker">Assessment access</span>
            <h2>Assessments</h2>
            <p>Turn Safe Exam Browser on only for the quizzes that need it.</p>
          </div>
          <div className="search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search quizzes" />
          </div>
        </div>
        {needsExitPassword && (
          <div className="notice error">
            <Lock size={17} /> Set an exit password in Course defaults before enabling SEB for these quizzes.
          </div>
        )}
        <div className="content-list">
          {filtered.map((item) => {
            const setting = settings[item.id] || {};
            const enabled = !!setting.sebRequired;
            const canEnable = enabled || canEnableSebAssessment(setting, courseDefaults);
            return (
              <article className="content-row teacher-row" key={item.id}>
                <div className="content-main">
                  <span className={clsx("assessment-icon", enabled && "enabled")} aria-hidden="true">
                    {enabled ? <ShieldCheck size={18} /> : <BookOpen size={18} />}
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>
                      {item.quizTypeDisplay || item.contentType || "Canvas content"}
                      <span className={clsx("assessment-status", enabled && "enabled")}>
                        {enabled ? "SEB enabled" : "SEB off"}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="row-actions">
                  {item.htmlUrl && (
                    <a
                      className="icon-button"
                      href={item.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open in Canvas"
                    >
                      <ExternalLink size={17} />
                    </a>
                  )}
                  {enabled && (
                    <button className="icon-button" onClick={() => setActiveItem(item)} title="Quiz settings">
                      <Settings size={17} />
                    </button>
                  )}
                  <button
                    className={clsx("button", enabled ? "danger" : "primary")}
                    onClick={() => toggleSeb(item)}
                    disabled={busyId === item.id || !canEnable}
                    title={
                      canEnable
                        ? enabled
                          ? "Disable SEB"
                          : "Enable SEB"
                        : "Set an exit password in Course defaults before enabling SEB"
                    }
                  >
                    {enabled ? <Unlock size={16} /> : <Lock size={16} />}
                    {enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && (
            <EmptyState
              title={items.length === 0 ? "No quizzes in this course" : "No quizzes found"}
              message={items.length === 0 ? undefined : "Try a different search."}
            />
          )}
        </div>
      </section>

      {activeItem && (
        <SettingsDialog
          item={activeItem}
          courseId={data.courseId}
          userId={data.userId}
          authToken={data.authToken}
          setting={settings[activeItem.id] || {}}
          courseDefaults={courseDefaults}
          onClose={() => setActiveItem(null)}
          onSaved={(saved) => {
            setSettings((current) => ({ ...current, [activeItem.id]: saved.setting || saved }));
            setActiveItem(null);
            pushToast("success", "Quiz settings saved.");
          }}
          onReset={(saved) => {
            setSettings((current) => ({ ...current, [activeItem.id]: saved.setting || saved }));
            pushToast("success", "Quiz reset to course defaults.");
          }}
        />
      )}

      {showDefaults && (
        <DefaultsDialog
          defaults={courseDefaults}
          courseId={data.courseId}
          authToken={data.authToken}
          initialSection={defaultsInitialSection}
          onClose={() => setShowDefaults(false)}
          onSave={async (next) => {
            await saveCourseDefaults({ ...next, setupCompleted: courseDefaults.setupCompleted === true });
            setShowDefaults(false);
          }}
        />
      )}

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
    </main>
  );
}

function StudentDashboard({ data }: { data: Record<string, any> }) {
  const quizzes: StudentQuizView[] = data.quizzes || [];
  const onboarding = (data.onboarding || {}) as OnboardingContext;
  const [showSetupCheck, setShowSetupCheck] = useState(onboarding.showReadinessPrompt === true);
  const [showReadinessBanner, setShowReadinessBanner] = useState(onboarding.readinessRecommended !== false);
  const [dismissingReadinessBanner, setDismissingReadinessBanner] = useState(false);
  const [readinessBannerError, setReadinessBannerError] = useState("");

  const dismissReadinessBanner = async () => {
    if (dismissingReadinessBanner) return;
    setDismissingReadinessBanner(true);
    setReadinessBannerError("");
    try {
      await persistStudentReadinessPromptDismissal(data.configGrantToken);
      setShowReadinessBanner(false);
    } catch (error) {
      setReadinessBannerError(errorMessage(error, "The reminder could not be dismissed. Try again."));
    } finally {
      setDismissingReadinessBanner(false);
    }
  };

  return (
    <main className="app-shell student-shell">
      <header className="topbar">
        <div className="topbar-title">
          <div className="brand-mark">
            <Shield size={20} />
          </div>
          <div>
            <h1>Safe Exam Browser Quizzes</h1>
            <p>{data.courseName || `Course ${data.courseId || ""}`}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="stat-pill active">
            <span>Available</span>
            <strong>{quizzes.length}</strong>
          </div>
          <button className="button secondary" onClick={() => setShowSetupCheck(true)}>
            <ShieldCheck size={16} /> Setup check
          </button>
        </div>
      </header>

      {showReadinessBanner && (
        <section className="onboarding-card student-onboarding-card" aria-labelledby="student-ready-title">
          <div>
            <span className="section-kicker">Before your first quiz</span>
            <h2 id="student-ready-title">Check this computer when you have a few minutes</h2>
            <p>
              The optional check confirms your Canvas connection and that Safe Exam Browser can open the school setup
              file.
            </p>
            {readinessBannerError && (
              <p className="field-error" role="alert">
                {readinessBannerError}
              </p>
            )}
          </div>
          <div className="student-onboarding-actions">
            <button className="button secondary" type="button" onClick={() => setShowSetupCheck(true)}>
              <ShieldCheck size={16} /> Run setup check
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void dismissReadinessBanner()}
              disabled={dismissingReadinessBanner}
              title="Dismiss setup-check reminder"
              aria-label="Dismiss setup-check reminder"
            >
              <X size={17} />
            </button>
          </div>
        </section>
      )}

      <section className="work-surface">
        <div className="list-header">
          <div>
            <h2>Quizzes</h2>
            <p>Open each quiz in Safe Exam Browser.</p>
          </div>
        </div>
        <div className="content-list">
          {quizzes.map((quiz) => (
            <article className="content-row student-row" key={quiz.id}>
              <div className="content-main">
                <span className="status-dot on" />
                <div>
                  <h3>{quiz.title}</h3>
                  <p>{quiz.quizTypeDisplay || "Canvas quiz"}</p>
                </div>
              </div>
              <span className="status-pill enabled">SEB required</span>
              <SebLaunchButton
                grantUrl={quiz.configGrantUrl || quiz.configUrl}
                token={data.configGrantToken}
                label="Launch"
              />
            </article>
          ))}
          {quizzes.length === 0 && (
            <EmptyState
              title="No SEB quizzes are active"
              message="Your instructor has not enabled Safe Exam Browser for a quiz in this course."
            />
          )}
        </div>
      </section>
      {showSetupCheck && (
        <SebSetupCheckDialog
          launchUrl={data.setupCheckLaunchUrl || data.setupCheckConfigUrl || "/seb/check/config.seb"}
          readinessUrl={data.sessionReadinessUrl || "/api/seb/session-readiness"}
          authToken={data.configGrantToken}
          onClose={() => setShowSetupCheck(false)}
          onCompleted={dismissReadinessBanner}
        />
      )}
    </main>
  );
}

function InstructorSetupWizard({
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
  const [step, setStep] = useState<InstructorSetupStep>("security");
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const steps: Array<{ id: InstructorSetupStep; label: string }> = [
    { id: "security", label: "Exit security" },
    { id: "tools", label: "Exam tools" },
    { id: "urls", label: "Advanced URLs" },
    { id: "enable", label: "First assessment" }
  ];
  const stepIndex = steps.findIndex((candidate) => candidate.id === step);
  const previousStep = stepIndex > 0 ? steps[stepIndex - 1].id : null;
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1].id : null;
  const hadCourseExitPassword =
    (defaults as CourseSebDefaults & { hasQuitPassword?: boolean }).hasQuitPassword === true;
  const retainsExistingCourseExitPassword = !hadCourseExitPassword || draft.quitPassword !== null;
  const hasExitSecurity = (securityReady && retainsExistingCourseExitPassword) || !!draft.quitPassword?.trim();

  const finish = async () => {
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
    security: {
      title: hasExitSecurity ? "Exit security is ready" : "Set the required exit security",
      description: hasExitSecurity
        ? "This course already has effective exit security. You can leave it as-is or set a replacement course password."
        : "Every enabled assessment needs an exit password from this course or a managed school default."
    },
    tools: {
      title: "Review the default exam tools",
      description: "Choose the approved tools that assessments inherit. Keeping the existing safe defaults is fine."
    },
    urls: {
      title: "Add allowed URLs only when needed",
      description: "Most courses can leave this empty. Add only resources students must use during an assessment."
    },
    enable: {
      title: "Enable the first assessment",
      description:
        enabledAssessmentCount > 0
          ? `${enabledAssessmentCount} assessment${enabledAssessmentCount === 1 ? " is" : "s are"} already enabled. Finish this guide, then use the course list whenever you need to adjust one.`
          : "Finish this guide, then choose an assessment from the course list to enable Safe Exam Browser."
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
            <h2 id="setup-wizard-title">Set up Safe Exam Browser</h2>
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
              <button type="button" disabled={index > stepIndex} onClick={() => setStep(candidate.id)}>
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
          {step !== "enable" && (
            <div className="setup-wizard-editor">
              <DefaultsEditor
                draft={draft}
                setDraft={setDraft}
                visibleSection={step === "security" ? "password" : step === "tools" ? "tools" : "urls"}
              />
            </div>
          )}
        </section>
        <footer className="dialog-actions setup-wizard-actions">
          {!required && (
            <button className="button secondary" type="button" onClick={onClose}>
              Finish later
            </button>
          )}
          {previousStep && (
            <button className="button secondary" type="button" onClick={() => setStep(previousStep)}>
              <ArrowLeft size={16} /> Back
            </button>
          )}
          {step === "enable" ? (
            <button
              className="button primary"
              type="button"
              disabled={finishing || !hasExitSecurity}
              onClick={() => void finish()}
            >
              <Check size={16} /> {finishing ? "Saving…" : "Save and finish"}
            </button>
          ) : nextStep ? (
            <button
              className="button primary"
              type="button"
              disabled={step === "security" && !hasExitSecurity}
              onClick={() => setStep(nextStep)}
            >
              {step === "security" ? <Lock size={16} /> : <Check size={16} />} Continue
            </button>
          ) : null}
        </footer>
        {!hasExitSecurity && step === "security" && (
          <p className="field-error" role="alert">
            Set an exit password before continuing.
          </p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

function AdminSetupPage({ data }: { data: Record<string, any> }) {
  const detailed = data.detailed === true;
  const checks = [
    ["Health", data.healthUrl],
    ["LTI configuration", data.ltiConfigUrl],
    ["Public signing keys", data.jwksUrl],
    ["Canvas detector script", data.detectorUrl]
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string");

  return (
    <main className="app-shell service-shell setup-center">
      <header className="topbar">
        <div className="topbar-title">
          <div className="brand-mark">
            <Shield size={20} />
          </div>
          <div>
            <h1>Canvas SEB setup</h1>
            <p>A role-by-role rollout guide for the Canvas integration.</p>
          </div>
        </div>
        <a className="button secondary" href={detailed ? "/setup" : "/setup/guide"}>
          <BookOpen size={16} /> {detailed ? "Setup overview" : "Detailed guide"}
        </a>
      </header>

      <section className="onboarding-card admin-intro" aria-labelledby="setup-start-title">
        <div>
          <span className="section-kicker">Start here</span>
          <h2 id="setup-start-title">Each role completes a different part of setup</h2>
          <p>
            These checks confirm this service is reachable. Canvas installation, Developer Key scopes, and theme
            activation still need an administrator to verify in Canvas.
          </p>
        </div>
        <div className="setup-link-list">
          {checks.map(([label, href]) => (
            <a className="button secondary compact" href={href} target="_blank" rel="noreferrer" key={label}>
              <ExternalLink size={15} /> {label}
            </a>
          ))}
        </div>
      </section>

      <section className="setup-role-grid" aria-label="Setup responsibilities">
        <article className="work-surface setup-role-card">
          <span className="section-kicker">Role</span>
          <h2>Canvas administrator</h2>
          <strong>Install and verify</strong>
          <p>
            Create the API and LTI Developer Keys, install by Client ID, record the deployment ID, and add the detector
            script to the active Canvas theme.
          </p>
          <strong>Required student scope</strong>
          <code>url:GET|/api/v1/login/session_token</code>
        </article>
        <article className="work-surface setup-role-card">
          <span className="section-kicker">Role</span>
          <h2>Instructor</h2>
          <strong>Prepare each course</strong>
          <p>
            Launch the course tool, connect Canvas, set the exit-password policy, choose course tools, then enable the
            intended quizzes.
          </p>
        </article>
        <article className="work-surface setup-role-card">
          <span className="section-kicker">Role</span>
          <h2>Student</h2>
          <strong>Connect and check</strong>
          <p>
            Connect Canvas once from course navigation. The optional setup check confirms that SEB can open the school
            configuration on that computer.
          </p>
        </article>
      </section>

      {detailed && (
        <section className="work-surface setup-guide-detail">
          <h2>Detailed rollout order</h2>
          <ol>
            <li>
              Deploy the service and open each public check above. Do not treat a passing service check as proof that
              Canvas installation is complete.
            </li>
            <li>
              Create the Canvas API Developer Key with the quiz access-code scopes and the student session-token scope,
              then configure the OAuth callback at <code>{data.toolUrl}/api/oauth2callback</code>.
            </li>
            <li>
              Create or refresh the LTI 1.3 Developer Key from the public LTI configuration URL, install it by Client
              ID, and store the Canvas deployment ID in the deployment configuration.
            </li>
            <li>
              Load the detector script through the active Canvas theme, then test a Classic Quiz and New Quiz in a
              non-production course.
            </li>
            <li>
              Have an instructor configure course defaults and a student complete connection, setup check, and a real
              SEB launch before broader rollout.
            </li>
          </ol>
        </section>
      )}
    </main>
  );
}

function SebSetupCheckDialog({
  launchUrl,
  readinessUrl,
  authToken,
  reconnectUrl = "/api/student-session-authorize",
  onClose,
  onCompleted
}: {
  launchUrl: string;
  readinessUrl: string;
  authToken?: string;
  reconnectUrl?: string;
  onClose: () => void;
  onCompleted?: () => Promise<void>;
}) {
  useEscapeToClose(onClose);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogInitialFocus(closeButtonRef);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [reconnectRequired, setReconnectRequired] = useState(false);

  const launchCheck = async () => {
    if (checking) return;
    setChecking(true);
    setError("");
    setReconnectRequired(false);
    try {
      const result = await requestJson(readinessUrl, {
        method: "POST",
        headers: actionHeaders(authToken)
      });
      if (!result.success) {
        throw new Error(result.message || "Canvas connection could not be verified.");
      }
      await onCompleted?.();
      window.location.assign(launchUrl);
    } catch (launchError) {
      if ((launchError as { code?: unknown }).code === "CANVAS_SESSION_AUTHORIZATION_REQUIRED") {
        setError("Your Canvas connection needs to be renewed before this device check can run.");
        setReconnectRequired(true);
        setChecking(false);
        return;
      }
      setError(launchError instanceof Error ? launchError.message : "Canvas connection could not be verified.");
      setChecking(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog setup-check-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-check-title"
      >
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Device setup</span>
            <h2 id="setup-check-title">Safe Exam Browser setup check</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            title="Close setup check"
            aria-label="Close setup check"
          >
            <X size={17} />
          </button>
        </header>
        <div className="setup-check-intro">
          <p>This confirms your Canvas connection, then opens a short SEB test on this computer.</p>
          <div className="instruction-list">
            <div>
              <strong>1</strong>
              <span>If your computer asks to approve the school configuration certificate, complete that prompt.</span>
            </div>
            <div>
              <strong>2</strong>
              <span>Keep the SEB check open until every item has finished.</span>
            </div>
            <div>
              <strong>3</strong>
              <span>Wait for the check page to say SEB is checked and working, then quit SEB.</span>
            </div>
          </div>
        </div>
        <footer className="dialog-actions">
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="button" disabled={checking} onClick={() => void launchCheck()}>
            <PlayCircle size={16} /> {checking ? "Checking Canvas…" : "Launch SEB check"}
          </button>
        </footer>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {reconnectRequired && (
          <button className="button secondary" type="button" onClick={() => window.location.assign(reconnectUrl)}>
            <KeyRound size={16} /> Reconnect Canvas
          </button>
        )}
      </section>
    </div>
  );
}

function SettingsDialog({
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
  const [passwordOverride, setPasswordOverride] = useState(setting.quitPasswordOverride === true);
  const [quitPassword, setQuitPassword] = useState("");
  const [startPasswordOverride, setStartPasswordOverride] = useState(setting.startPasswordOverride === true);
  const [startPassword, setStartPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const body = {
        quizId: item.id,
        contentId: item.id.startsWith("newquiz:") ? item.id : undefined,
        courseId,
        ssoDomains: [],
        educationalToolDomains: [],
        urlRules,
        externalToolIds,
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
        setError(saved.message || "SEB settings could not be saved.");
        return;
      }
      onSaved(saved);
    } catch (saveError) {
      setError(errorMessage(saveError, "SEB settings could not be saved."));
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
        setError(saved.message || "Could not reset quiz defaults.");
        return;
      }
      setUsesDefaults(true);
      setUrlRules(normalizeUrlRules(courseDefaults.urlRules));
      setExternalToolIds(null);
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
          quitPassword={quitPassword}
          setQuitPassword={customizeQuitPassword}
          startPassword={startPassword}
          setStartPassword={customizeStartPassword}
          passwordOverride={passwordOverride}
          setPasswordOverride={customizePasswordOverride}
          startPasswordOverride={startPasswordOverride}
          setStartPasswordOverride={customizeStartPasswordOverride}
          hasDefaultPassword={canEnableSebAssessment(undefined, courseDefaults)}
          hasDefaultStartPassword={
            !!(courseDefaults as CourseSebDefaults & { hasStartPassword?: boolean }).hasStartPassword
          }
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

type RevealedPasswordValue = {
  value: string | null;
  source: "assessment" | "course" | "managed" | "none";
};

function SavedPasswordReveal({ endpoint, authToken }: { endpoint: string; authToken?: string }) {
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

function passwordRequirementText(otherPassword: "exit" | "start"): string {
  return `Use 8–128 characters with at least 5 different letters or numbers. Letters-only and numbers-only are allowed; avoid common words, sequences, and repeated patterns. It must differ from the ${otherPassword} password.`;
}

function DefaultsDialog({
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
  useEscapeToClose(onClose);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogInitialFocus(closeButtonRef);
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<"password" | "urls" | "tools">(initialSection);

  async function save() {
    setSaving(true);
    setError(null);
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
            <h2 id="defaults-title">SEB course policy</h2>
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
              <ExternalLink size={17} />
              <span>
                <strong>Allowed URLs</strong>
                <small>Extra assessment resources</small>
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
          <DefaultsEditor draft={draft} setDraft={setDraft} visibleSection={section} />
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
    </div>
  );
}

function DefaultsEditor({
  draft,
  setDraft,
  visibleSection = "all"
}: {
  draft: CourseSebDefaults;
  setDraft: (value: SetStateAction<CourseSebDefaults>) => void;
  visibleSection?: "all" | "password" | "urls" | "tools";
}) {
  const showPassword = visibleSection === "all" || visibleSection === "password";
  const showUrls = visibleSection === "all" || visibleSection === "urls";
  const showTools = visibleSection === "all" || visibleSection === "tools";
  const [startPasswordEnabled, setStartPasswordEnabled] = useState(
    () => !!draft.startPassword || !!(draft as CourseSebDefaults & { hasStartPassword?: boolean }).hasStartPassword
  );
  const [quitPasswordEnabled, setQuitPasswordEnabled] = useState(
    () => !!draft.quitPassword || !!(draft as CourseSebDefaults & { hasQuitPassword?: boolean }).hasQuitPassword
  );

  const updateStartPasswordEnabled = (enabled: boolean) => {
    setStartPasswordEnabled(enabled);
    if (!enabled) {
      setDraft((current) => ({ ...current, startPassword: null }));
    }
  };

  const updateQuitPasswordEnabled = (enabled: boolean) => {
    setQuitPasswordEnabled(enabled);
    if (!enabled) {
      setDraft((current) => ({ ...current, quitPassword: null }));
    }
  };

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
              <small>Add a second check before an assessment opens in Safe Exam Browser.</small>
            </span>
          </label>
          <input
            type="password"
            value={draft.startPassword || ""}
            disabled={!startPasswordEnabled}
            onChange={(event) => setDraft((current) => ({ ...current, startPassword: event.target.value }))}
            placeholder={startPasswordEnabled ? "Enter a replacement password, or leave blank to keep it" : "Disabled"}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
          />
          {startPasswordEnabled && <small>{passwordRequirementText("exit")}</small>}

          <SectionHeading title="Exit security" />
          <label className="toggle-row compact">
            <input
              type="checkbox"
              checked={quitPasswordEnabled}
              onChange={(event) => updateQuitPasswordEnabled(event.target.checked)}
            />
            <span>
              <strong>Protect exits with a course password</strong>
              <small>An exit password is required before SEB can be enabled unless your school supplies one.</small>
            </span>
          </label>
          <input
            type="password"
            value={draft.quitPassword || ""}
            disabled={!quitPasswordEnabled}
            onChange={(event) => setDraft((current) => ({ ...current, quitPassword: event.target.value }))}
            placeholder={quitPasswordEnabled ? "Enter a replacement password, or leave blank to keep it" : "Disabled"}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
          />
          {quitPasswordEnabled && <small>{passwordRequirementText("start")}</small>}
        </section>
      )}
      {showUrls && (
        <section className="settings-section">
          <SectionHeading
            title="Allowed URLs"
            actionLabel="Add URL"
            onAction={() => setDraft((current) => ({ ...current, urlRules: [...current.urlRules, newUrlRule()] }))}
          />
          <UrlRuleEditor
            rules={draft.urlRules}
            onChange={(urlRules) => setDraft((current) => ({ ...current, urlRules }))}
          />
        </section>
      )}
      {showTools && (
        <section className="settings-section">
          <SectionHeading title="Exam tools" />
          <ToolEditor
            tools={draft.externalTools}
            onChange={(externalTools) => setDraft((current) => ({ ...current, externalTools }))}
          />
        </section>
      )}
    </div>
  );
}

function SettingsSections({
  urlRules,
  setUrlRules,
  courseTools,
  externalToolIds,
  setExternalToolIds,
  quitPassword,
  setQuitPassword,
  startPassword,
  setStartPassword,
  passwordOverride,
  setPasswordOverride,
  startPasswordOverride,
  setStartPasswordOverride,
  hasDefaultPassword,
  hasDefaultStartPassword
}: {
  urlRules: SebUrlRule[];
  setUrlRules: (rules: SebUrlRule[]) => void;
  courseTools: ExternalToolConfig[];
  externalToolIds: string[] | null;
  setExternalToolIds: (ids: string[] | null) => void;
  quitPassword: string;
  setQuitPassword: (value: string) => void;
  startPassword: string;
  setStartPassword: (value: string) => void;
  passwordOverride: boolean;
  setPasswordOverride: (value: boolean) => void;
  startPasswordOverride: boolean;
  setStartPasswordOverride: (value: boolean) => void;
  hasDefaultPassword: boolean;
  hasDefaultStartPassword: boolean;
}) {
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
        <input
          type="password"
          value={startPasswordOverride ? startPassword : ""}
          disabled={!startPasswordOverride}
          onChange={(event) => setStartPassword(event.target.value)}
          placeholder={
            startPasswordOverride ? "Enter a replacement password, or leave blank to keep it" : "Using course default"
          }
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
        />
        {startPasswordOverride && <small>{passwordRequirementText("exit")}</small>}
      </section>

      <section className="settings-section">
        <SectionHeading title="Exit password" />
        <label className="toggle-row compact">
          <input
            type="checkbox"
            checked={passwordOverride}
            onChange={(event) => setPasswordOverride(event.target.checked)}
          />
          <span>
            <strong>Set a quiz-specific exit password</strong>
            <small>
              {hasDefaultPassword
                ? "Otherwise this quiz uses the course or managed server default."
                : "A course, quiz, or managed server exit password is required while SEB is enabled."}
            </small>
          </span>
        </label>
        <input
          type="password"
          value={passwordOverride ? quitPassword : ""}
          disabled={!passwordOverride}
          onChange={(event) => setQuitPassword(event.target.value)}
          placeholder={
            passwordOverride ? "Enter a replacement password, or leave blank to keep it" : "Using course default"
          }
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
        />
        {passwordOverride && <small>{passwordRequirementText("start")}</small>}
      </section>

      <section className="settings-section">
        <SectionHeading
          title="Allowed URLs"
          actionLabel="Add URL"
          onAction={() => setUrlRules([...urlRules, newUrlRule()])}
        />
        <UrlRuleEditor rules={urlRules} onChange={setUrlRules} />
      </section>

      <section className="settings-section">
        <SectionHeading title="Exam tools" />
        <QuizToolSelector tools={courseTools} selectedIds={externalToolIds} onChange={setExternalToolIds} />
      </section>
    </div>
  );
}

function UrlRuleEditor({
  rules,
  onChange,
  disabled = false
}: {
  rules: SebUrlRule[];
  onChange: (rules: SebUrlRule[]) => void;
  disabled?: boolean;
}) {
  const update = (id: string, patch: Partial<SebUrlRule>) =>
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  return (
    <div className="rule-list">
      {rules.map((rule) => (
        <div className="rule-row" key={rule.id}>
          <select
            value={rule.match}
            disabled={disabled}
            onChange={(event) => update(rule.id, { match: event.target.value as SebUrlRuleMatch })}
          >
            <option value="domain">Any URL on domain</option>
            <option value="exact">Exact URL</option>
          </select>
          <input
            value={rule.value}
            disabled={disabled}
            onChange={(event) => update(rule.id, { value: event.target.value })}
            placeholder={rule.match === "exact" ? "https://example.edu/resource" : "example.edu"}
          />
          <button
            className="icon-button"
            disabled={disabled}
            onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))}
            title="Remove URL"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {rules.length === 0 && <p className="empty-line">No extra URLs configured.</p>}
    </div>
  );
}

function ToolEditor({
  tools,
  onChange,
  disabled = false
}: {
  tools: ExternalToolConfig[];
  onChange: (tools: ExternalToolConfig[]) => void;
  disabled?: boolean;
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

  return (
    <div className="tool-list">
      <div className="tool-list-intro">
        <p>
          Choose which course tools are available by default. Open a tool only when you need to edit its launch URL or
          allowed resources.
        </p>
        <button className="button secondary small" type="button" disabled={disabled} onClick={addTool}>
          <Plus size={14} /> Add tool
        </button>
      </div>
      {tools.map((tool) => {
        const expanded = expandedToolIds.includes(tool.id);
        const detailId = `tool-details-${tool.id}`;
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
                <span className="tool-icon">
                  <Calculator size={16} />
                </span>
                <span>
                  <strong>{tool.label || "New custom tool"}</strong>
                  <small>{tool.enabled ? "Enabled by default" : "Disabled by default"}</small>
                </span>
              </label>
              <div className="tool-card-summary-actions">
                <span className={clsx("tool-badge", tool.preset ? "preset" : "custom")}>
                  {tool.preset ? "Preloaded" : "Custom"}
                </span>
                <button
                  className="tool-expand-button"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  onClick={() => toggleExpanded(tool.id)}
                >
                  {expanded ? "Close" : "Edit"} <ChevronDown size={16} />
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
                      disabled={disabled}
                      onChange={(event) => update(tool.id, { label: event.target.value })}
                      placeholder="Tool name"
                    />
                  </label>
                  <label>
                    Exact launch URL
                    <input
                      value={tool.url}
                      disabled={disabled}
                      onChange={(event) => update(tool.id, { url: event.target.value })}
                      placeholder="https://example.edu/tool"
                    />
                  </label>
                </div>

                <section className="tool-access-list">
                  <div className="tool-access-heading">
                    <div>
                      <strong>Allowed in SEB</strong>
                      <small>
                        The launch page plus these exact resources are the only extra pages this tool can use.
                      </small>
                    </div>
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        update(tool.id, {
                          allowedRules: [...(tool.allowedRules || []), newToolAccessRule()]
                        })
                      }
                    >
                      <Plus size={14} /> Add resource
                    </button>
                  </div>
                  <p className="tool-launch-url">
                    <code>{tool.url || "Exact launch URL required"}</code>
                  </p>
                  {(tool.allowedRules || []).map((rule) => (
                    <ToolAccessRuleEditor
                      disabled={disabled}
                      key={rule.id}
                      rule={rule}
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
                    Everything else—including sign-in, saved work, sharing, and other sites—is blocked.
                  </p>
                </section>

                <footer className="tool-card-actions">
                  <button
                    className="button danger small"
                    disabled={disabled}
                    type="button"
                    onClick={() => onChange(tools.filter((entry) => entry.id !== tool.id))}
                  >
                    <Trash2 size={14} /> Remove tool
                  </button>
                </footer>
              </div>
            )}
          </article>
        );
      })}
      {tools.length === 0 && <p className="empty-line">No tools configured.</p>}
    </div>
  );
}

function ToolAccessRuleEditor({
  rule,
  onChange,
  onRemove,
  disabled
}: {
  rule: ExternalToolAccessRule;
  onChange: (patch: Partial<ExternalToolAccessRule>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const changeMatch = (match: ExternalToolAccessRule["match"]) => {
    if (
      match === "domain" &&
      !window.confirm("Allow every HTTPS page on this domain? This is broader than an exact URL or resource path.")
    ) {
      return;
    }
    onChange({
      match,
      ...(match === "domain" ? { broadDomainConfirmed: true } : { broadDomainConfirmed: undefined })
    });
  };
  return (
    <div className={clsx("tool-access-rule", rule.match === "domain" && "broad")}>
      <select
        value={rule.match}
        disabled={disabled}
        onChange={(event) => changeMatch(event.target.value as ExternalToolAccessRule["match"])}
      >
        <option value="exact">Exact URL</option>
        <option value="path">Path and children</option>
        <option value="domain">Whole domain (broad)</option>
      </select>
      <input
        value={rule.value}
        disabled={disabled}
        onChange={(event) => onChange({ value: event.target.value })}
        placeholder={
          rule.match === "domain"
            ? "assets.example.edu"
            : rule.match === "path"
              ? "https://example.edu/assets/*"
              : "https://example.edu/resource"
        }
      />
      {!disabled && (
        <button className="icon-button" type="button" onClick={onRemove} title="Remove allowed resource">
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

function QuizToolSelector({
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
            : "This quiz has its own tool selection. Only checked tools will be included in its SEB file."}
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

function AuthorizationPage({ data }: { data: Record<string, any> }) {
  return (
    <MessagePage
      icon={<KeyRound />}
      title="Connect Canvas"
      message={
        data.message || "Authorize Canvas access so this tool can read quizzes and set access codes for this course."
      }
      action={
        <div className="student-action-stack">
          <a className="button primary" href={data.authUrl}>
            <KeyRound size={16} /> Connect Canvas
          </a>
        </div>
      }
    />
  );
}

const STUDENT_SESSION_CONNECTED_MESSAGE = "seb-canvas-session-connected";

function StudentSessionAuthorizationPage({ data }: { data: Record<string, any> }) {
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const popupRef = useRef<Window | null>(null);
  const authUrl = typeof data.authUrl === "string" ? data.authUrl : "/api/student-session-authorize";

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popupRef.current ||
        !event.data ||
        typeof event.data !== "object" ||
        (event.data as { type?: unknown }).type !== STUDENT_SESSION_CONNECTED_MESSAGE
      ) {
        return;
      }
      const returnUrl = (event.data as { returnUrl?: unknown }).returnUrl;
      popupRef.current?.close();
      window.location.assign(
        typeof returnUrl === "string" && returnUrl.startsWith("/") ? returnUrl : "/lti/launch?connected=1"
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!connecting) return;
    const timer = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setConnecting(false);
        setConnectionError("The Canvas connection window was closed before it finished. Try again when you are ready.");
      }
    }, 400);
    return () => window.clearInterval(timer);
  }, [connecting]);

  const connect = () => {
    setConnectionError("");
    const popup = window.open(authUrl, "seb_canvas_session_authorization", "popup,width=560,height=720");
    if (!popup) {
      window.location.assign(authUrl);
      return;
    }
    popupRef.current = popup;
    popup.focus();
    setConnecting(true);
  };

  return (
    <MessagePage
      icon={<KeyRound />}
      title="Connect Canvas"
      message={
        (data.onboarding as OnboardingContext | undefined)?.resumeAssessment
          ? "Connect Canvas once, then return to the Safe Exam Browser quiz you selected."
          : "Connect Canvas once to open Safe Exam Browser quizzes without signing in again."
      }
      action={
        <div className="student-action-stack">
          <button className="button primary" type="button" disabled={connecting} onClick={connect}>
            <KeyRound size={16} /> {connecting ? "Connecting…" : "Connect Canvas"}
          </button>
          {connectionError && (
            <span className="field-error" role="alert">
              {connectionError}
            </span>
          )}
        </div>
      }
    />
  );
}

function StudentSessionConnectedPage({ data }: { data: Record<string, any> }) {
  const returnUrl = typeof data.returnUrl === "string" ? data.returnUrl : "/lti/launch";

  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: STUDENT_SESSION_CONNECTED_MESSAGE, returnUrl }, window.location.origin);
      window.setTimeout(() => window.close(), 100);
      return;
    }
    window.location.replace(returnUrl);
  }, [returnUrl]);

  return <MessagePage icon={<Check />} title="Canvas Connected" message="Returning to Safe Exam Browser Quizzes." />;
}

function SebDownloadPage({ data }: { data: Record<string, any> }) {
  const [showSetupCheck, setShowSetupCheck] = useState(data.showReadinessPrompt === true);
  return (
    <>
      <MessagePage
        icon={<Shield />}
        title="Safe Exam Browser Required"
        message={
          data.showReadinessPrompt
            ? "Canvas is connected. You can optionally check this computer before opening your quiz."
            : "Open this assessment in Safe Exam Browser when you are ready. If prompted, allow your browser to open the app."
        }
        action={
          <>
            <button className="button secondary" type="button" onClick={() => window.history.back()}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="button secondary" type="button" onClick={() => setShowSetupCheck(true)}>
              <ShieldCheck size={16} /> Setup check
            </button>
            <SebLaunchButton grantUrl={data.configGrantUrl} token={data.configGrantToken} label="Open SEB" />
          </>
        }
      />
      {showSetupCheck && (
        <SebSetupCheckDialog
          launchUrl={data.setupCheckLaunchUrl || "/seb/check/config.seb"}
          readinessUrl={data.sessionReadinessUrl || "/api/seb/session-readiness"}
          authToken={data.configGrantToken}
          onClose={() => setShowSetupCheck(false)}
          onCompleted={() => persistStudentReadinessPromptDismissal(data.configGrantToken).catch(() => undefined)}
        />
      )}
    </>
  );
}

function OAuthErrorPage({ data }: { data: Record<string, any> }) {
  const description = typeof data.description === "string" && data.description ? ` ${data.description}` : "";
  return (
    <MessagePage
      icon={<AlertCircle />}
      title="Canvas connection was not completed"
      message={`Canvas did not authorize this connection.${description} Return to the course tool and select Connect Canvas to try again.`}
      action={
        <a className="button primary" href="/lti/launch">
          <ArrowLeft size={16} /> Return to Canvas tool
        </a>
      }
    />
  );
}

function SebLaunchButton({ grantUrl, token, label }: { grantUrl?: string; token?: string; label: string }) {
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  const launch = async () => {
    if (!grantUrl || !token || launching) {
      setError("Reopen the Safe Exam Browser tool from Canvas and try again.");
      return;
    }
    setLaunching(true);
    setError("");
    let broker: Window | null = null;
    try {
      const uniqueName = `seb_config_launch_${window.crypto.randomUUID()}`;
      broker = window.open("about:blank", uniqueName);
      if (broker) {
        broker.opener = null;
        if (broker.opener !== null) {
          broker.close();
          broker = null;
        }
      }
    } catch {
      try {
        broker?.close();
      } catch {
        // Best-effort cleanup when a browser blocks opener isolation.
      }
      broker = null;
    }
    try {
      const response = await fetch(grantUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "x-auth-token": token }
      });
      const payload = (await response.json()) as { sebLaunchUrl?: unknown; message?: unknown };
      if (!response.ok || typeof payload.sebLaunchUrl !== "string" || !/^sebs?:\/\//iu.test(payload.sebLaunchUrl)) {
        throw new Error(typeof payload.message === "string" ? payload.message : "Unable to prepare Safe Exam Browser");
      }
      if (broker && !broker.closed) {
        broker.location.replace(payload.sebLaunchUrl);
      } else {
        const fallback = window.open(payload.sebLaunchUrl, "_blank", "noopener,noreferrer");
        if (!fallback) {
          window.location.assign(payload.sebLaunchUrl);
        }
      }
    } catch (launchError) {
      broker?.close();
      const recovery = onboardingRecovery(launchError, "student");
      setError(
        recovery?.message ||
          (launchError instanceof Error ? launchError.message : "Unable to prepare Safe Exam Browser")
      );
    } finally {
      setLaunching(false);
    }
  };

  return (
    <span>
      <button className="button primary" type="button" disabled={launching} onClick={() => void launch()}>
        <ExternalLink size={16} /> {launching ? "Preparing…" : label}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function SebLaunchingPage({ data }: { data: Record<string, any> }) {
  const sebLaunchUrl = typeof data.sebLaunchUrl === "string" ? data.sebLaunchUrl : "";
  const returnUrl = typeof data.browserReturnUrl === "string" ? data.browserReturnUrl : "";

  useEffect(() => {
    if (!/^sebs?:\/\//iu.test(sebLaunchUrl)) return;
    window.location.assign(sebLaunchUrl);
  }, [sebLaunchUrl]);

  return (
    <MessagePage
      icon={<Shield />}
      title="Opening Safe Exam Browser"
      message="Approve the browser prompt to open SEB. You can return to your Canvas course with the button below."
      action={
        <>
          {sebLaunchUrl && (
            <a className="button primary" href={sebLaunchUrl}>
              <ExternalLink size={16} /> Open SEB
            </a>
          )}
          {returnUrl && (
            <a className="button secondary" href={returnUrl}>
              <ArrowLeft size={16} /> Return to course
            </a>
          )}
        </>
      }
    />
  );
}

function SebExitPage({ data }: { data: Record<string, any> }) {
  const quitUrl = typeof data.quitUrl === "string" ? data.quitUrl : "";
  return (
    <MessagePage
      icon={<Check />}
      title="Assessment Complete"
      message={
        quitUrl
          ? "SEB will close this session automatically. Use the button if it stays open."
          : "Return to the submitted assessment results page to finish closing Safe Exam Browser."
      }
      action={
        quitUrl ? (
          <AutoRedirectAction
            url={quitUrl}
            label="Quit Safe Exam Browser"
            icon={<LogOut size={16} />}
            seconds={2}
            linkId="sebQuitLink"
            statusLabel="Quitting automatically"
            doneLabel="Quitting now"
          />
        ) : undefined
      }
    />
  );
}

function AutoRedirectAction({
  url,
  label,
  icon,
  seconds,
  linkId,
  statusLabel,
  doneLabel
}: {
  url?: string;
  label: string;
  icon: ReactNode;
  seconds: number;
  linkId?: string;
  statusLabel: string;
  doneLabel: string;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!url) return;
    const interval = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    const timeout = window.setTimeout(() => {
      window.location.assign(url);
    }, seconds * 1000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [seconds, url]);

  return (
    <div className="countdown-action">
      <div className="countdown-status" aria-live="polite">
        <div className="countdown-row">
          <div>
            <strong>{statusLabel}</strong>
            <span>{remaining > 0 ? `${remaining}s remaining` : doneLabel}</span>
          </div>
          <a className="button primary countdown-button" id={linkId} href={url}>
            {icon} {label}
          </a>
        </div>
        <div className="countdown-track" aria-hidden="true">
          <span style={{ animationDuration: `${seconds}s` }} />
        </div>
      </div>
    </div>
  );
}

function SebQuitPage({ data }: { data: Record<string, any> }) {
  return (
    <MessagePage
      icon={<LogOut />}
      title="Safe Exam Browser Closing"
      message="SEB should close this session. Use the button again if this window remains open."
      action={
        <a className="button primary" id="sebLegacyQuitLink" href={data.legacyQuitUrl || data.quitUrl}>
          Quit again
        </a>
      }
    />
  );
}

type SetupCheckStatus = "pending" | "pass" | "fail";

interface SetupCheckItem {
  id: string;
  label: string;
  detail: string;
  status: SetupCheckStatus;
}

function SebSetupCheckPage({ data }: { data: Record<string, any> }) {
  const [checks, setChecks] = useState<SetupCheckItem[]>([
    {
      id: "config-opened",
      label: "SEB setup configuration opened",
      detail: data.configEncryptionEnabled
        ? "The certificate-protected setup file opened successfully."
        : "The setup file opened successfully. Certificate encryption is disabled for this environment.",
      status: "pending"
    },
    {
      id: "seb-runtime",
      label: "Safe Exam Browser detected",
      detail: "Checking the SEB runtime and browser identity.",
      status: "pending"
    },
    {
      id: "storage",
      label: "Browser storage is available",
      detail: "Checking session storage used during exam redirects.",
      status: "pending"
    },
    {
      id: "connectivity",
      label: "LTI service is reachable",
      detail: "Checking secure connectivity to the SEB integration service.",
      status: "pending"
    },
    {
      id: "config-key",
      label: "SEB Config Key verified",
      detail: "Checking that this exact setup configuration can be verified by the server.",
      status: "pending"
    }
  ]);

  const updateCheck = (id: string, status: SetupCheckStatus, detail: string) => {
    setChecks((current) => current.map((check) => (check.id === id ? { ...check, status, detail } : check)));
  };

  useEffect(() => {
    let cancelled = false;
    const update = (id: string, status: SetupCheckStatus, detail: string) => {
      if (!cancelled) {
        updateCheck(id, status, detail);
      }
    };

    void (async () => {
      update(
        "config-opened",
        "pass",
        data.configEncryptionEnabled
          ? "The certificate-protected setup file decrypted and loaded."
          : "The setup file loaded. Certificate encryption is disabled for this environment."
      );

      const sebDetected = detectSebRuntime();
      update(
        "seb-runtime",
        sebDetected ? "pass" : "fail",
        sebDetected ? "SEB runtime signals are present." : "This page is not running inside Safe Exam Browser."
      );

      try {
        const key = `seb-setup-check-${Date.now()}`;
        sessionStorage.setItem(key, "ok");
        const stored = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        if (stored !== "ok") {
          throw new Error("Session storage round trip failed.");
        }
        update("storage", "pass", "Session storage is working.");
      } catch {
        update("storage", "fail", "Session storage is unavailable in this SEB session.");
      }

      try {
        const response = await fetch("/health", { credentials: "same-origin" });
        const health = (await response.json()) as { status?: string };
        if (!response.ok || health.status !== "UP") {
          throw new Error("Health check failed.");
        }
        update("connectivity", "pass", "The SEB integration service responded normally.");
      } catch {
        update("connectivity", "fail", "The SEB integration service could not be reached from this session.");
      }

      try {
        const configKeyHash = await readSebConfigKeyHash();
        if (!configKeyHash) {
          throw new Error("Config Key unavailable.");
        }
        const response = await fetch(data.proofUrl || "/api/seb/check-proof", {
          method: "POST",
          credentials: "include",
          headers: {
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            configKeyHash,
            url: window.location.href.split("#")[0]
          })
        });
        if (!response.ok) {
          throw new Error("Config Key proof rejected.");
        }
        update("config-key", "pass", "The server verified this exact SEB setup configuration.");
      } catch {
        update(
          "config-key",
          "fail",
          "The server could not verify this setup configuration. Reopen the setup check from Canvas."
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data.configEncryptionEnabled, data.proofUrl]);

  const complete = checks.every((check) => check.status !== "pending");
  const passed = checks.every((check) => check.status === "pass");
  const quitUrl = data.quitUrl || "/seb/check/quit";

  return (
    <main className="message-shell">
      <section className="message-panel setup-check-panel">
        <div className={clsx("message-icon", passed && "success", complete && !passed && "error")}>
          <ShieldCheck size={22} />
        </div>
        <h1>{passed ? "SEB is checked and working" : "Checking Safe Exam Browser"}</h1>
        <p>
          {passed
            ? "This computer can open encrypted SEB configurations and verify them with the Canvas SEB integration."
            : "Keep this window open while the setup checks run."}
        </p>
        <div className="check-list" role="list">
          {checks.map((check) => (
            <div className={clsx("check-row", check.status)} role="listitem" key={check.id}>
              <span className="check-status" aria-hidden="true" />
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="message-actions">
          <a className={clsx("button", passed ? "primary" : "secondary")} id="sebSetupCheckQuitLink" href={quitUrl}>
            <LogOut size={16} /> Quit Safe Exam Browser
          </a>
        </div>
      </section>
    </main>
  );
}

function MessagePage({
  icon,
  title,
  message,
  action
}: {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <main className="message-shell">
      <section className="message-panel">
        <div className="message-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{message}</p>
        {action && <div className="message-actions">{action}</div>}
      </section>
    </main>
  );
}

function useEscapeToClose(onClose?: () => void) {
  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

function useDialogInitialFocus(ref?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref) return;
    const timer = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [ref]);
}

function detectSebRuntime(): boolean {
  const userAgent = navigator.userAgent || "";
  return (
    /SafeExamBrowser|Safe Exam Browser|SEB[/; _-]|SEB$/iu.test(userAgent) ||
    !!((window as any).SafeExamBrowser || (window as any).SEB)
  );
}

async function readSebConfigKeyHash(): Promise<string | null> {
  const seb = (window as any).SafeExamBrowser;
  if (!seb?.security) {
    return null;
  }
  if (typeof seb.security.updateKeys === "function") {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      try {
        seb.security.updateKeys(finish);
        window.setTimeout(finish, 1500);
      } catch {
        finish();
      }
    });
  }
  return readSebConfigKeyValue(seb.security.configKey);
}

function readSebConfigKeyValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "function") {
    try {
      const result = value();
      return typeof result === "string" && result.length > 0 ? result : null;
    } catch {
      return null;
    }
  }
  return null;
}

function SectionHeading({
  title,
  actionLabel,
  onAction
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title-row">
      <h3>{title}</h3>
      {actionLabel && onAction && (
        <button className="button secondary compact" onClick={onAction}>
          <Plus size={15} /> {actionLabel}
        </button>
      )}
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="empty-state">
      <BookOpen size={22} />
      <strong>{title}</strong>
      {message && <span>{message}</span>}
    </div>
  );
}

function RecoveryNotice({ recovery, onDismiss }: { recovery: OnboardingRecovery; onDismiss: () => void }) {
  return (
    <div className="notice error onboarding-recovery" role="alert">
      <AlertCircle size={17} />
      <span>{recovery.message}</span>
      {recovery.actionUrl && recovery.actionLabel && (
        <a className="button secondary compact" href={recovery.actionUrl}>
          {recovery.actionLabel}
        </a>
      )}
      <button className="icon-button tiny" type="button" onClick={onDismiss} title="Dismiss guidance">
        <X size={14} />
      </button>
    </div>
  );
}

function ToastRegion({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={clsx("toast", toast.tone)} key={toast.id}>
          <AlertCircle size={17} />
          <span>{toast.message}</span>
          <button onClick={() => onDismiss(toast.id)} title="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function redirectForAuth(body: Record<string, any>): boolean {
  if (body.requiresAuth && body.authUrl) {
    window.location.href = body.authUrl;
    return true;
  }
  return false;
}

function actionHeaders(authToken?: string): HeadersInit {
  return authToken ? { "x-auth-token": authToken } : {};
}

async function persistStudentReadinessPromptDismissal(authToken?: string): Promise<void> {
  const body = await requestJson("/api/seb/session-readiness/dismiss", {
    method: "POST",
    headers: actionHeaders(authToken)
  });
  if (!body.success) {
    throw new Error(body.message || "The reminder could not be dismissed.");
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, any>> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    const error = new Error(body.message || body.error || `Request failed with status ${response.status}.`) as Error & {
      code?: unknown;
    };
    error.code = body.error_code;
    throw error;
  }
  return body;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function onboardingRecovery(value: unknown, audience: "instructor" | "student"): OnboardingRecovery | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const code =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.error_code === "string"
        ? candidate.error_code
        : "";
  const authUrl = typeof candidate.authUrl === "string" ? candidate.authUrl : "";
  if (candidate.requiresAuth === true || code === "CANVAS_AUTHORIZATION_REQUIRED") {
    return {
      message: "Canvas needs to be reconnected before this course can be updated.",
      actionLabel: "Reconnect Canvas",
      actionUrl: authUrl || "/api/oauth2reauthorize"
    };
  }
  if (code === "CANVAS_PERMISSION_DENIED") {
    return {
      message:
        "Canvas accepted your connection but blocked this update. A Canvas administrator needs to confirm the Developer Key scopes.",
      actionLabel: "Open setup guide",
      actionUrl: "/setup/guide"
    };
  }
  if (code === "CANVAS_SESSION_AUTHORIZATION_REQUIRED") {
    return audience === "student"
      ? {
          message: "Your Canvas connection needs to be renewed before Safe Exam Browser can open this quiz.",
          actionLabel: "Reconnect Canvas",
          actionUrl: "/api/student-session-authorize"
        }
      : null;
  }
  if (code === "CANVAS_SESSION_READINESS_FAILED") {
    return {
      message: "Canvas could not verify the connection right now. Try again, or return to Canvas and reconnect later."
    };
  }
  if (code === "INVALID_SEB_CONFIG_PROOF" || code === "SEB_CONFIGURATION_UNAVAILABLE") {
    return {
      message: "This SEB configuration is no longer current. Return to Canvas and reopen the quiz from the course tool."
    };
  }
  return null;
}

function useDefaultsDraft(
  defaults: CourseSebDefaults
): [CourseSebDefaults, (value: SetStateAction<CourseSebDefaults>) => void] {
  return useState<CourseSebDefaults>(() => ({
    ...defaults,
    urlRules: normalizeUrlRules(defaults.urlRules),
    externalTools: normalizeCourseExternalTools(defaults.externalTools)
  }));
}

function normalizeCourseDefaults(input: any, courseId: string): CourseSebDefaults {
  const normalized = {
    id: input?.id || courseId,
    courseId: input?.courseId || courseId,
    quitPassword: input?.quitPassword || "",
    startPassword: input?.startPassword || "",
    urlRules: normalizeUrlRules(input?.urlRules),
    externalTools: normalizeCourseExternalTools(input?.externalTools),
    setupCompleted: !!input?.setupCompleted,
    createdAt: input?.createdAt,
    updatedAt: input?.updatedAt,
    hasQuitPassword: input?.hasQuitPassword === true,
    hasEffectiveQuitPassword: input?.hasEffectiveQuitPassword === true,
    hasStartPassword: input?.hasStartPassword === true
  };
  return normalized;
}

function rulesForSetting(setting: Record<string, any>, defaults: CourseSebDefaults): SebUrlRule[] {
  if (setting.usesCourseDefaults !== false) {
    return normalizeUrlRules(defaults.urlRules);
  }
  const explicit = normalizeUrlRules(setting.urlRules);
  if (explicit.length) {
    return explicit;
  }
  return legacyDomainsToUrlRules(setting.customDomains || []);
}

function newCustomTool(): ExternalToolConfig {
  return {
    id: clientId("tool"),
    label: "",
    url: "",
    enabled: false,
    allowedRules: []
  };
}

function newToolAccessRule(): ExternalToolAccessRule {
  return {
    id: clientId("tool-resource"),
    value: "",
    match: "path"
  };
}

function newUrlRule(): SebUrlRule {
  return {
    id: clientId("url"),
    value: "",
    match: "domain"
  };
}

function clientId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}
