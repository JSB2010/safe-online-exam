import {
  AlertCircle,
  BookOpen,
  Calculator,
  Check,
  Clipboard,
  ExternalLink,
  Eye,
  EyeOff,
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
import type { ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { CourseSebDefaults, ExternalToolConfig, SebUrlRule, SebUrlRuleMatch } from "../shared/models.js";
import {
  EXTERNAL_TOOL_PRESETS,
  legacyDomainsToUrlRules,
  normalizeExternalTools,
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
}

type Toast = {
  id: string;
  tone: "success" | "error";
  message: string;
};

declare global {
  interface Window {
    __SEB_BOOTSTRAP__?: BootstrapPayload;
  }
}

const bootstrap = window.__SEB_BOOTSTRAP__ || { view: "teacher", data: {} };

export function App() {
  switch (bootstrap.view) {
    case "teacher":
      return <TeacherDashboard data={bootstrap.data} />;
    case "api-authorization":
      return <AuthorizationPage data={bootstrap.data} />;
    case "seb-required":
    case "seb-download":
      return <SebDownloadPage data={bootstrap.data} />;
    case "seb-exit":
      return <SebExitPage data={bootstrap.data} />;
    case "seb-quit":
      return <SebQuitPage data={bootstrap.data} />;
    case "oauth-error":
      return (
        <MessagePage
          icon={<AlertCircle />}
          title="Canvas Connection Error"
          message={String(bootstrap.data.error || "Canvas did not authorize access.")}
        />
      );
    case "student":
      return <StudentDashboard data={bootstrap.data} />;
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
  const [showSetup, setShowSetup] = useState(!!data.showSetupWizard);
  const [visiblePasswordId, setVisiblePasswordId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.title} ${item.quizTypeDisplay || ""}`.toLowerCase().includes(normalized));
  }, [items, query]);

  const activeCount = useMemo(
    () => Object.values(settings).filter((setting: any) => setting?.sebRequired).length,
    [settings]
  );

  const pushToast = (tone: Toast["tone"], message: string) => {
    const id = clientId("toast");
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  };

  async function toggleSeb(item: QuizView) {
    const enabled = !!settings[item.id]?.sebRequired;
    setBusyId(item.id);
    try {
      const body = await requestJson(
        `/api/quizzes/${encodeURIComponent(data.courseId)}/${encodeURIComponent(item.id)}/seb/${enabled ? "disable" : "enable"}`,
        { method: "POST", headers: actionHeaders(data.authToken) }
      );
      if (redirectForAuth(body)) return;
      if (!body.success) {
        pushToast("error", body.message || "The SEB setting could not be updated.");
      } else {
        setSettings((current) => ({
          ...current,
          [item.id]: body.setting || { ...current[item.id], sebRequired: !enabled }
        }));
        pushToast("success", enabled ? "SEB disabled." : "SEB enabled.");
      }
    } catch (error) {
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
        const launchUrl = new URL("/lti/launch", window.location.origin);
        launchUrl.searchParams.set("course_id", data.courseId);
        launchUrl.searchParams.set("user_id", data.userId);
        window.location.assign(`${launchUrl.pathname}${launchUrl.search}`);
      } else {
        pushToast("error", body.message || "Could not refresh Canvas content.");
      }
    } catch (error) {
      pushToast("error", errorMessage(error, "Could not refresh Canvas content."));
    } finally {
      setBusyId(null);
    }
  }

  async function saveCourseDefaults(next: CourseSebDefaults) {
    const body = await requestJson(`/api/quizzes/course/${encodeURIComponent(data.courseId)}/defaults`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
      body: JSON.stringify(next)
    });
    if (redirectForAuth(body)) return;
    if (!body.success) {
      throw new Error(body.message || "Course defaults could not be saved.");
    }
    setCourseDefaults(normalizeCourseDefaults(body.defaults, data.courseId));
    pushToast("success", "Course defaults saved.");
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
          <button className="icon-button" onClick={() => setShowDefaults(true)} title="Course defaults">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <section className="work-surface">
        <div className="list-header">
          <div>
            <h2>Quizzes</h2>
            <p>Choose which quizzes require SEB and manage passwords.</p>
          </div>
          <div className="search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search quizzes" />
          </div>
        </div>
        <div className="content-list">
          {filtered.map((item) => {
            const setting = settings[item.id] || {};
            const enabled = !!setting.sebRequired;
            const exitPassword = effectiveExitPassword(setting, courseDefaults);
            const startPassword = effectiveStartPassword(setting, courseDefaults);
            const passwordVisible = visiblePasswordId === item.id;
            return (
              <article className="content-row teacher-row" key={item.id}>
                <div className="content-main">
                  <span
                    className={clsx("status-dot", enabled && "on")}
                    title={enabled ? "SEB active" : "Not enabled"}
                    aria-label={enabled ? "SEB active" : "Not enabled"}
                  />
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.quizTypeDisplay || item.contentType || "Canvas content"}</p>
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
                    <div className="password-action">
                      <button
                        className="button secondary"
                        onClick={() => setVisiblePasswordId(passwordVisible ? null : item.id)}
                      >
                        {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                        Passwords
                      </button>
                      {passwordVisible && (
                        <div className="password-popover password-list">
                          <PasswordPopoverRow
                            label="Start password"
                            value={startPassword}
                            emptyLabel="No start password set"
                            onCopy={() => pushToast("success", "Start password copied.")}
                          />
                          <PasswordPopoverRow
                            label="Exit password"
                            value={exitPassword}
                            emptyLabel="No exit password set"
                            onCopy={() => pushToast("success", "Exit password copied.")}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {enabled && (
                    <button className="icon-button" onClick={() => setActiveItem(item)} title="Quiz settings">
                      <Settings size={17} />
                    </button>
                  )}
                  <button
                    className={clsx("button", enabled ? "danger" : "primary")}
                    onClick={() => toggleSeb(item)}
                    disabled={busyId === item.id}
                  >
                    {enabled ? <Unlock size={16} /> : <Lock size={16} />}
                    {enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && <EmptyState title="No quizzes found" message="Try a different search." />}
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
          onClose={() => setShowDefaults(false)}
          onSave={async (next) => {
            await saveCourseDefaults({ ...next, setupCompleted: true });
            setShowDefaults(false);
          }}
        />
      )}

      {showSetup && (
        <SetupWizard
          defaults={courseDefaults}
          onSave={async (next) => {
            await saveCourseDefaults({ ...next, setupCompleted: true });
            setShowSetup(false);
          }}
        />
      )}

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
    </main>
  );
}

function PasswordPopoverRow({
  label,
  value,
  emptyLabel,
  onCopy
}: {
  label: string;
  value: string;
  emptyLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="password-popover-row">
      <div>
        <strong>{label}</strong>
        <span>{value || emptyLabel}</span>
      </div>
      {value && (
        <button
          className="icon-button tiny"
          title={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            onCopy();
          }}
        >
          <Clipboard size={14} />
        </button>
      )}
    </div>
  );
}

function StudentDashboard({ data }: { data: Record<string, any> }) {
  const quizzes: StudentQuizView[] = data.quizzes || [];
  const [showSetupCheck, setShowSetupCheck] = useState(false);
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
              <a className="button primary" href={quiz.sebLaunchUrl}>
                <ExternalLink size={16} /> Launch
              </a>
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
          onClose={() => setShowSetupCheck(false)}
        />
      )}
    </main>
  );
}

function SebSetupCheckDialog({ launchUrl, onClose }: { launchUrl: string; onClose: () => void }) {
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
          <button className="icon-button" onClick={onClose} title="Close setup check">
            <X size={17} />
          </button>
        </header>
        <div className="setup-check-intro">
          <p>This opens a short SEB test on this computer before you take a real quiz.</p>
          <div className="instruction-list">
            <div>
              <strong>1</strong>
              <span>If macOS asks for your login keychain password, enter your Mac password.</span>
            </div>
            <div>
              <strong>2</strong>
              <span>Choose Always Allow so SEB can use the school configuration certificate next time.</span>
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
          <a className="button primary" href={launchUrl}>
            <PlayCircle size={16} /> Launch SEB check
          </a>
        </footer>
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
  const [usesDefaults, setUsesDefaults] = useState(setting.usesCourseDefaults !== false);
  const [urlRules, setUrlRules] = useState<SebUrlRule[]>(() => rulesForSetting(setting, courseDefaults));
  const [externalTools, setExternalTools] = useState<ExternalToolConfig[]>(() =>
    toolsForSetting(setting, courseDefaults)
  );
  const [passwordOverride, setPasswordOverride] = useState(setting.quitPasswordOverride === true);
  const [quitPassword, setQuitPassword] = useState(effectiveExitPassword(setting, courseDefaults));
  const [startPasswordOverride, setStartPasswordOverride] = useState(setting.startPasswordOverride === true);
  const [startPassword, setStartPassword] = useState(effectiveStartPassword(setting, courseDefaults));
  const [showPassword, setShowPassword] = useState(false);
  const [showStartPassword, setShowStartPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customizeUrlRules = (next: SebUrlRule[]) => {
    setUsesDefaults(false);
    setUrlRules(next);
  };
  const customizeExternalTools = (next: ExternalToolConfig[]) => {
    setUsesDefaults(false);
    setExternalTools(next);
  };
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
        externalTools: normalizeExternalTools(externalTools),
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
      setExternalTools(mergeToolPresets(courseDefaults.externalTools || []));
      setPasswordOverride(false);
      setQuitPassword(courseDefaults.quitPassword || "");
      setStartPasswordOverride(false);
      setStartPassword(courseDefaults.startPassword || "");
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

        <SettingsSections
          urlRules={urlRules}
          setUrlRules={customizeUrlRules}
          externalTools={externalTools}
          setExternalTools={customizeExternalTools}
          quitPassword={quitPassword}
          setQuitPassword={customizeQuitPassword}
          startPassword={startPassword}
          setStartPassword={customizeStartPassword}
          passwordOverride={passwordOverride}
          setPasswordOverride={customizePasswordOverride}
          startPasswordOverride={startPasswordOverride}
          setStartPasswordOverride={customizeStartPasswordOverride}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          showStartPassword={showStartPassword}
          setShowStartPassword={setShowStartPassword}
          defaultPassword={courseDefaults.quitPassword || ""}
          defaultStartPassword={courseDefaults.startPassword || ""}
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

function DefaultsDialog({
  defaults,
  onClose,
  onSave
}: {
  defaults: CourseSebDefaults;
  onClose: () => void;
  onSave: (defaults: CourseSebDefaults) => Promise<void>;
}) {
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <span className="section-kicker">Course defaults</span>
            <h2 id="defaults-title">Starting settings</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close defaults">
            <X size={17} />
          </button>
        </header>
        <DefaultsEditor draft={draft} setDraft={setDraft} />
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

function SetupWizard({
  defaults,
  onSave
}: {
  defaults: CourseSebDefaults;
  onSave: (defaults: CourseSebDefaults) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps = ["Passwords", "Allowed URLs", "Tools"];

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (saveError) {
      setError(errorMessage(saveError, "Setup could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="setup-header">
          <div className="brand-mark">
            <Shield size={22} />
          </div>
          <div>
            <h2 id="setup-title">Set course defaults</h2>
            <p>Choose the starting settings for SEB-enabled quizzes.</p>
          </div>
        </header>
        <nav className="stepper" aria-label="Setup steps">
          {steps.map((label, index) => (
            <span className={clsx("step", index === step && "current", index < step && "done")} key={label}>
              <span className="step-index">{index < step ? <Check size={14} /> : index + 1}</span>
              <span>{label}</span>
            </span>
          ))}
        </nav>
        <DefaultsEditor
          draft={draft}
          setDraft={setDraft}
          visibleSection={step === 0 ? "password" : step === 1 ? "urls" : "tools"}
        />
        {error && (
          <div className="notice error">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions">
          <button
            className="button secondary"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
          >
            Back
          </button>
          {step < steps.length - 1 ? (
            <button className="button primary" onClick={() => setStep((current) => current + 1)}>
              Next
            </button>
          ) : (
            <button className="button primary" onClick={finish} disabled={saving}>
              <Save size={16} /> Finish setup
            </button>
          )}
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [startPasswordVisible, setStartPasswordVisible] = useState(false);
  const [startPasswordEnabled, setStartPasswordEnabled] = useState(() => !!draft.startPassword);
  const [quitPasswordEnabled, setQuitPasswordEnabled] = useState(() => !!draft.quitPassword);

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
              <small>Students enter this before SEB opens a quiz.</small>
            </span>
          </label>
          <div className="password-field">
            <input
              type={startPasswordVisible ? "text" : "password"}
              value={draft.startPassword || ""}
              disabled={!startPasswordEnabled}
              onChange={(event) => setDraft((current) => ({ ...current, startPassword: event.target.value }))}
              placeholder="Start password"
            />
            <button
              className="icon-button"
              onClick={() => setStartPasswordVisible((current) => !current)}
              disabled={!startPasswordEnabled}
              title="Show or hide start password"
            >
              {startPasswordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          <SectionHeading title="Exit password" />
          <label className="toggle-row compact">
            <input
              type="checkbox"
              checked={quitPasswordEnabled}
              onChange={(event) => updateQuitPasswordEnabled(event.target.checked)}
            />
            <span>
              <strong>Use an exit password</strong>
              <small>SEB asks for this before students can quit during a quiz.</small>
            </span>
          </label>
          <div className="password-field">
            <input
              type={passwordVisible ? "text" : "password"}
              value={draft.quitPassword || ""}
              disabled={!quitPasswordEnabled}
              onChange={(event) => setDraft((current) => ({ ...current, quitPassword: event.target.value }))}
              placeholder="Exit password"
            />
            <button
              className="icon-button"
              onClick={() => setPasswordVisible((current) => !current)}
              disabled={!quitPasswordEnabled}
              title="Show or hide password"
            >
              {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
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
          <SectionHeading
            title="Education tools"
            actionLabel="Add tool"
            onAction={() =>
              setDraft((current) => ({ ...current, externalTools: [...current.externalTools, newCustomTool()] }))
            }
          />
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
  externalTools,
  setExternalTools,
  quitPassword,
  setQuitPassword,
  startPassword,
  setStartPassword,
  passwordOverride,
  setPasswordOverride,
  startPasswordOverride,
  setStartPasswordOverride,
  showPassword,
  setShowPassword,
  showStartPassword,
  setShowStartPassword,
  defaultPassword,
  defaultStartPassword
}: {
  urlRules: SebUrlRule[];
  setUrlRules: (rules: SebUrlRule[]) => void;
  externalTools: ExternalToolConfig[];
  setExternalTools: (tools: ExternalToolConfig[]) => void;
  quitPassword: string;
  setQuitPassword: (value: string) => void;
  startPassword: string;
  setStartPassword: (value: string) => void;
  passwordOverride: boolean;
  setPasswordOverride: (value: boolean) => void;
  startPasswordOverride: boolean;
  setStartPasswordOverride: (value: boolean) => void;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  showStartPassword: boolean;
  setShowStartPassword: (value: boolean) => void;
  defaultPassword: string;
  defaultStartPassword: string;
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
              {defaultStartPassword
                ? "Otherwise this quiz uses the course default."
                : "Otherwise this quiz has no start password."}
            </small>
          </span>
        </label>
        <div className="password-field">
          <input
            type={showStartPassword ? "text" : "password"}
            value={startPasswordOverride ? startPassword : defaultStartPassword}
            disabled={!startPasswordOverride}
            onChange={(event) => setStartPassword(event.target.value)}
            placeholder="Password students enter before SEB opens the quiz"
          />
          <button
            className="icon-button"
            onClick={() => setShowStartPassword(!showStartPassword)}
            title="Show or hide start password"
          >
            {showStartPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
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
              {defaultPassword
                ? "Otherwise this quiz uses the course default."
                : "Otherwise this quiz has no exit password."}
            </small>
          </span>
        </label>
        <div className="password-field">
          <input
            type={showPassword ? "text" : "password"}
            value={passwordOverride ? quitPassword : defaultPassword}
            disabled={!passwordOverride}
            onChange={(event) => setQuitPassword(event.target.value)}
            placeholder="Quiz exit password"
          />
          <button className="icon-button" onClick={() => setShowPassword(!showPassword)} title="Show or hide password">
            {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
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
        <SectionHeading
          title="Education tools"
          actionLabel="Add tool"
          onAction={() => setExternalTools([...externalTools, newCustomTool()])}
        />
        <ToolEditor tools={externalTools} onChange={setExternalTools} />
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
            <option value="regex">Advanced regex</option>
          </select>
          <input
            value={rule.value}
            disabled={disabled}
            onChange={(event) => update(rule.id, { value: event.target.value })}
            placeholder={rule.match === "regex" ? "^https://example\\.edu/.*$" : "example.edu"}
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
  const update = (id: string, patch: Partial<ExternalToolConfig>) =>
    onChange(tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool)));

  return (
    <div className="tool-list">
      {tools.map((tool) => (
        <div className={clsx("tool-row", tool.matchType === "regex" && "with-regex")} key={tool.id}>
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
          </label>
          <input
            className="tool-name-field"
            value={tool.label}
            disabled={disabled}
            onChange={(event) => update(tool.id, { label: event.target.value })}
            placeholder="Tool name"
          />
          <input
            className="tool-url-field"
            value={tool.url}
            disabled={disabled}
            onChange={(event) => update(tool.id, { url: event.target.value })}
            placeholder="https://example.edu/tool"
          />
          <select
            className="tool-match-field"
            value={tool.matchType || "exact"}
            disabled={disabled}
            onChange={(event) => update(tool.id, { matchType: event.target.value as SebUrlRuleMatch })}
          >
            <option value="exact">Exact URL</option>
            <option value="domain">Whole domain</option>
            <option value="regex">Advanced regex</option>
          </select>
          {tool.matchType === "regex" && (
            <input
              className="tool-regex-field"
              value={tool.allowedPattern || ""}
              disabled={disabled}
              onChange={(event) => update(tool.id, { allowedPattern: event.target.value })}
              placeholder="URL filter regex"
            />
          )}
          <button
            className="icon-button tool-remove-button"
            disabled={disabled || !!tool.preset}
            onClick={() => onChange(tools.filter((entry) => entry.id !== tool.id))}
            title="Remove tool"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {tools.length === 0 && <p className="empty-line">No tools configured.</p>}
    </div>
  );
}

function AuthorizationPage({ data }: { data: Record<string, any> }) {
  return (
    <MessagePage
      icon={<KeyRound />}
      title="Connect Canvas"
      message={data.message || "Authorize Canvas access so this tool can read quizzes and set access codes."}
      action={
        <a className="button primary" href={data.authUrl}>
          <KeyRound size={16} /> Connect Canvas
        </a>
      }
    />
  );
}

function SebDownloadPage({ data }: { data: Record<string, any> }) {
  const configUrl = data.sebConfigUrl || data.configUrl || data.configDownloadUrl;
  const launchUrl = data.sebLaunchUrl || configUrl;
  return (
    <MessagePage
      icon={<Shield />}
      title="Safe Exam Browser Required"
      message="Opening SEB now. If prompted, allow your browser to open Safe Exam Browser."
      action={
        <AutoRedirectAction
          url={launchUrl}
          label="Open SEB"
          icon={<ExternalLink size={16} />}
          seconds={2}
          statusLabel="Opening automatically"
          doneLabel="Opening now"
        />
      }
    />
  );
}

function SebExitPage({ data }: { data: Record<string, any> }) {
  const seconds = 2;
  return (
    <MessagePage
      icon={<Check />}
      title="Assessment Complete"
      message="SEB will close this session automatically. Use the button if it stays open."
      action={
        <AutoRedirectAction
          url={data.quitUrl}
          label="Quit Safe Exam Browser"
          icon={<LogOut size={16} />}
          seconds={seconds}
          linkId="sebQuitLink"
          statusLabel="Quitting automatically"
          doneLabel="Quitting now"
        />
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
    if (!url) {
      return;
    }
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

  const progress = ((seconds - remaining) / seconds) * 100;

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
          <span style={{ width: `${progress}%` }} />
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

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="empty-state">
      <BookOpen size={22} />
      <strong>{title}</strong>
      <span>{message}</span>
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

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, any>> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    throw new Error(body.message || body.error || `Request failed with status ${response.status}.`);
  }
  return body;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function useDefaultsDraft(
  defaults: CourseSebDefaults
): [CourseSebDefaults, (value: SetStateAction<CourseSebDefaults>) => void] {
  return useState<CourseSebDefaults>(() => ({
    ...defaults,
    urlRules: normalizeUrlRules(defaults.urlRules),
    externalTools: mergeToolPresets(defaults.externalTools || [])
  }));
}

function normalizeCourseDefaults(input: any, courseId: string): CourseSebDefaults {
  return {
    id: input?.id || courseId,
    courseId: input?.courseId || courseId,
    quitPassword: input?.quitPassword || "",
    startPassword: input?.startPassword || "",
    urlRules: normalizeUrlRules(input?.urlRules),
    externalTools: mergeToolPresets(input?.externalTools || []),
    setupCompleted: !!input?.setupCompleted,
    createdAt: input?.createdAt,
    updatedAt: input?.updatedAt
  };
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

function toolsForSetting(setting: Record<string, any>, defaults: CourseSebDefaults): ExternalToolConfig[] {
  if (setting.usesCourseDefaults !== false) {
    return mergeToolPresets(defaults.externalTools || []);
  }
  return mergeToolPresets(setting.externalTools || []);
}

function effectiveExitPassword(setting: Record<string, any>, defaults: CourseSebDefaults): string {
  if (setting.quitPasswordOverride === true) {
    return setting.quitPassword || "";
  }
  return setting.quitPassword || defaults.quitPassword || "";
}

function effectiveStartPassword(setting: Record<string, any>, defaults: CourseSebDefaults): string {
  if (setting.startPasswordOverride === true) {
    return setting.startPassword || "";
  }
  return setting.startPassword || defaults.startPassword || "";
}

function mergeToolPresets(value: ExternalToolConfig[]): ExternalToolConfig[] {
  const normalized = normalizeExternalTools(value);
  const presetTools = EXTERNAL_TOOL_PRESETS.map((preset) => {
    const existing = normalized.find((tool) => tool.preset === preset.preset || tool.id === preset.id);
    return {
      ...preset,
      ...existing,
      id: preset.id,
      label: existing?.label || preset.label,
      url: existing?.url || preset.url,
      preset: preset.preset,
      matchType: existing?.matchType || "exact"
    };
  });
  const presetIds = new Set(EXTERNAL_TOOL_PRESETS.map((preset) => preset.id));
  const presetNames = new Set(EXTERNAL_TOOL_PRESETS.map((preset) => preset.preset));
  return [
    ...presetTools,
    ...normalized.filter((tool) => !presetIds.has(tool.id) && (!tool.preset || !presetNames.has(tool.preset)))
  ];
}

function newCustomTool(): ExternalToolConfig {
  return {
    id: clientId("tool"),
    label: "",
    url: "",
    enabled: true,
    allowedDomains: [],
    matchType: "exact"
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
