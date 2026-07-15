import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Calculator,
  Check,
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
import type { ReactNode, SetStateAction } from "react";
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

type Toast = {
  id: string;
  tone: "success" | "error";
  message: string;
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
  const needsExitPassword = useMemo(
    () =>
      items.some(
        (item) => !settings[item.id]?.sebRequired && !canEnableSebAssessment(settings[item.id], courseDefaults)
      ),
    [courseDefaults, items, settings]
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
    if (!enabled && !canEnableSebAssessment(settings[item.id], courseDefaults)) {
      pushToast("error", "Set an exit password in Course defaults before enabling SEB.");
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
        window.location.assign("/lti/launch");
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
          <button className="button secondary" onClick={() => setShowDefaults(true)}>
            <Settings size={16} /> Course settings
          </button>
        </div>
      </header>

      <section className="work-surface">
        <div className="list-header">
          <div>
            <h2>Quizzes</h2>
            <p>Choose which quizzes require SEB and select the course tools they may use.</p>
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
          courseId={data.courseId}
          authToken={data.authToken}
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
        />
      )}
    </main>
  );
}

function SebSetupCheckDialog({
  launchUrl,
  readinessUrl,
  authToken,
  onClose
}: {
  launchUrl: string;
  readinessUrl: string;
  authToken?: string;
  onClose: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const launchCheck = async () => {
    if (checking) return;
    setChecking(true);
    setError("");
    try {
      const result = await requestJson(readinessUrl, {
        method: "POST",
        headers: actionHeaders(authToken)
      });
      if (!result.success) {
        throw new Error(result.message || "Canvas connection could not be verified.");
      }
      window.location.assign(launchUrl);
    } catch (launchError) {
      if ((launchError as { code?: unknown }).code === "CANVAS_SESSION_AUTHORIZATION_REQUIRED") {
        window.location.assign("/lti/launch");
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
          <button className="icon-button" onClick={onClose} title="Close setup check">
            <X size={17} />
          </button>
        </header>
        <div className="setup-check-intro">
          <p>This confirms your Canvas connection, then opens a short SEB test on this computer.</p>
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
          <button className="button primary" type="button" disabled={checking} onClick={() => void launchCheck()}>
            <PlayCircle size={16} /> {checking ? "Checking Canvas…" : "Launch SEB check"}
          </button>
        </footer>
        {error && <p className="field-error">{error}</p>}
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
      {error && <small className="field-error">{error}</small>}
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
  onClose,
  onSave
}: {
  defaults: CourseSebDefaults;
  courseId: string;
  authToken?: string;
  onClose: () => void;
  onSave: (defaults: CourseSebDefaults) => Promise<void>;
}) {
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<"password" | "urls" | "tools">("password");

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
          <button className="icon-button" onClick={onClose} title="Close defaults">
            <X size={17} />
          </button>
        </header>
        <SavedPasswordReveal
          endpoint={`/api/quizzes/course/${encodeURIComponent(courseId)}/passwords/reveal`}
          authToken={authToken}
        />
        <nav className="settings-tabs" aria-label="Course settings">
          {[
            ["password", "Security"],
            ["urls", "Allowed URLs"],
            ["tools", "Exam tools"]
          ].map(([id, label]) => (
            <button
              className={clsx("settings-tab", section === id && "active")}
              key={id}
              type="button"
              aria-selected={section === id}
              onClick={() => setSection(id as "password" | "urls" | "tools")}
            >
              {label}
            </button>
          ))}
        </nav>
        <DefaultsEditor draft={draft} setDraft={setDraft} visibleSection={section} />
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
              <small>Students enter this before SEB opens a quiz.</small>
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

          <SectionHeading title="Exit password" />
          <label className="toggle-row compact">
            <input
              type="checkbox"
              checked={quitPasswordEnabled}
              onChange={(event) => updateQuitPasswordEnabled(event.target.checked)}
            />
            <span>
              <strong>Set a course exit password</strong>
              <small>
                An exit password is required before SEB can be enabled unless the server supplies a managed default.
              </small>
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
          <SectionHeading
            title="Exam tools"
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
  const update = (id: string, patch: Partial<ExternalToolConfig>) =>
    onChange(tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool)));

  return (
    <div className="tool-list">
      {tools.map((tool) => (
        <article className="tool-card" key={tool.id}>
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
                <small>{tool.enabled ? "Enabled by default for new SEB quizzes" : "Disabled by default"}</small>
              </span>
            </label>
            <span className={clsx("tool-badge", tool.preset ? "preset" : "custom")}>
              {tool.preset ? "Preloaded" : "Custom"}
            </span>
          </header>

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
                <small>The launch page plus these exact resources are the only extra pages this tool can use.</small>
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
                  update(tool.id, { allowedRules: (tool.allowedRules || []).filter((entry) => entry.id !== rule.id) })
                }
              />
            ))}
            {(tool.allowedRules || []).length === 0 && <p className="empty-line">No additional resource paths.</p>}
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
        </article>
      ))}
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
      message={data.message || "Authorize Canvas access so this tool can read quizzes and set access codes."}
      action={
        <a className="button primary" href={data.authUrl}>
          <KeyRound size={16} /> Connect Canvas
        </a>
      }
    />
  );
}

const STUDENT_SESSION_CONNECTED_MESSAGE = "seb-canvas-session-connected";

function StudentSessionAuthorizationPage({ data }: { data: Record<string, any> }) {
  const [connecting, setConnecting] = useState(false);
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
      popupRef.current?.close();
      window.location.reload();
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
      }
    }, 400);
    return () => window.clearInterval(timer);
  }, [connecting]);

  const connect = () => {
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
      message="Connect Canvas once to open Safe Exam Browser quizzes without signing in again."
      action={
        <button className="button primary" type="button" disabled={connecting} onClick={connect}>
          <KeyRound size={16} /> {connecting ? "Connecting…" : "Connect Canvas"}
        </button>
      }
    />
  );
}

function StudentSessionConnectedPage({ data }: { data: Record<string, any> }) {
  const returnUrl = typeof data.returnUrl === "string" ? data.returnUrl : "/lti/launch";

  useEffect(() => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: STUDENT_SESSION_CONNECTED_MESSAGE }, window.location.origin);
      window.setTimeout(() => window.close(), 100);
      return;
    }
    window.location.replace(returnUrl);
  }, [returnUrl]);

  return <MessagePage icon={<Check />} title="Canvas Connected" message="Returning to Safe Exam Browser Quizzes." />;
}

function SebDownloadPage({ data }: { data: Record<string, any> }) {
  return (
    <MessagePage
      icon={<Shield />}
      title="Safe Exam Browser Required"
      message="Open this assessment in Safe Exam Browser when you are ready. If prompted, allow your browser to open the app."
      action={
        <>
          <button className="button secondary" type="button" onClick={() => window.history.back()}>
            <ArrowLeft size={16} /> Back
          </button>
          <SebLaunchButton grantUrl={data.configGrantUrl} token={data.configGrantToken} label="Open SEB" />
        </>
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
      setError(launchError instanceof Error ? launchError.message : "Unable to prepare Safe Exam Browser");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <span>
      <button className="button primary" type="button" disabled={launching} onClick={() => void launch()}>
        <ExternalLink size={16} /> {launching ? "Preparing…" : label}
      </button>
      {error && <span className="field-error">{error}</span>}
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
