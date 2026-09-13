import { BookOpen, ExternalLink, Lock, RefreshCw, Search, Settings, Shield, ShieldCheck, Unlock } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import clsx from "clsx";
import type { CourseSebDefaults } from "../../../shared/models.js";
import { canEnableSebAssessment } from "../../../shared/models.js";
import {
  actionHeaders,
  apiErrorDetail,
  apiMessage,
  clientRequestError,
  errorMessage,
  onboardingRecovery,
  redirectForAuth,
  requestJson
} from "../../lib/api.js";
import { BrandMark } from "../../components/brand-mark.js";
import { EmptyState, RecoveryNotice, ToastRegion } from "../../components/feedback.js";
import { clientId } from "../../lib/id.js";
import { normalizeCourseDefaults } from "../../lib/settings.js";
import { OnboardingContext, OnboardingRecovery, QuizView, Toast } from "../../types.js";

const DefaultsDialog = lazy(async () => ({
  default: (await import("./defaults.js")).DefaultsDialog
}));
const InstructorSetupWizard = lazy(async () => ({
  default: (await import("./onboarding.js")).InstructorSetupWizard
}));
const SettingsDialog = lazy(async () => ({
  default: (await import("./settings-dialog.js")).SettingsDialog
}));

export function TeacherDashboard({ data }: { data: Record<string, any> }) {
  const [items, setItems] = useState<QuizView[]>(data.quizzes || []);
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

  const configuredCount = useMemo(
    () => items.filter((item) => settings[item.id]?.sebRequired).length,
    [items, settings]
  );
  const readyCount = useMemo(
    () => items.filter((item) => settings[item.id]?.sebRequired && item.readiness?.status === "ready").length,
    [items, settings]
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
      pushToast("error", "Set an exit password in Settings before enabling Safe Online Exam.");
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
        pushToast("error", apiMessage(body, "The Safe Online Exam setting could not be updated."));
      } else {
        setSettings((current) => ({
          ...current,
          [item.id]: body.setting || { ...current[item.id], sebRequired: !enabled }
        }));
        if (body.readiness) {
          setItems((current) =>
            current.map((candidate) =>
              candidate.id === item.id ? applyReadiness(candidate, body.readiness as QuizView["readiness"]) : candidate
            )
          );
        }
        pushToast(
          "success",
          enabled
            ? "Safe Online Exam disabled."
            : apiMessage(
                body,
                item.published === true
                  ? "Safe Online Exam enabled."
                  : "Safe Online Exam configured. Publish and check readiness in Canvas before students begin."
              )
        );
      }
    } catch (error) {
      handleRecovery(error);
      pushToast("error", errorMessage(error, "The Safe Online Exam setting could not be updated."));
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
        const readinessById = new Map<string, QuizView["readiness"]>(
          (Array.isArray(body.readiness) ? body.readiness : []).map((value: any) => [String(value.id), value])
        );
        setItems((current) =>
          Array.isArray(body.assessments)
            ? (body.assessments as QuizView[])
            : current.map((item) => {
                const readiness = readinessById.get(item.id);
                return readiness ? applyReadiness(item, readiness) : item;
              })
        );
        const blockedReadiness = (Array.isArray(body.readiness) ? body.readiness : []).filter(
          (value: any) => settings[String(value.id)]?.sebRequired && value.status !== "ready"
        );
        const onlyScheduled =
          blockedReadiness.length > 0 && blockedReadiness.every((value: any) => value.status === "not_yet_open");
        pushToast(
          body.blockedCount > 0 && !onlyScheduled ? "error" : "success",
          onlyScheduled
            ? `${body.readyCount || 0} ready; ${body.blockedCount || 0} configured and waiting for its Canvas opening time.`
            : `${body.readyCount || 0} ready; ${body.blockedCount || 0} configured but not ready.`
        );
      } else {
        handleRecovery(body);
        pushToast("error", apiMessage(body, "Could not refresh Canvas content."));
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
      throw clientRequestError(
        typeof body.error_code === "string" ? body.error_code : undefined,
        undefined,
        apiErrorDetail(body.message)
      );
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
          <BrandMark />
          <div>
            <h1>Safe Online Exam</h1>
            <p>{data.courseName || `Course ${data.courseId}`}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="stat-pill">
            <span>Total</span>
            <strong>{items.length}</strong>
          </div>
          <div className="stat-pill active">
            <span>Ready</span>
            <strong>{readyCount}</strong>
          </div>
          <div className="stat-pill">
            <span>Configured</span>
            <strong>{configuredCount}</strong>
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

      <Suspense fallback={<InstructorDialogLoadingFallback />}>
        {showSetupWizard && (
          <InstructorSetupWizard
            courseName={data.courseName || `Course ${data.courseId}`}
            defaults={courseDefaults}
            securityReady={courseSecurityReady}
            enabledAssessmentCount={onboarding.enabledAssessmentCount || configuredCount}
            required={onboarding.courseSetupComplete !== true && courseDefaults.setupCompleted !== true}
            onClose={() => setShowSetupWizard(false)}
            onComplete={completeSetupWizard}
          />
        )}
      </Suspense>

      {recovery && <RecoveryNotice recovery={recovery} onDismiss={() => setRecovery(null)} />}

      <section className="work-surface assessment-surface">
        <div className="list-header">
          <div>
            <h2>Assessments</h2>
          </div>
          <div className="search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search quizzes" />
          </div>
        </div>
        {needsExitPassword && (
          <div className="notice error">
            <Lock size={17} /> Set an exit password in Course defaults before enabling Safe Online Exam for these
            quizzes.
          </div>
        )}
        <div className="content-list">
          {filtered.map((item) => {
            const setting = settings[item.id] || {};
            const enabled = !!setting.sebRequired;
            const canEnable = enabled || canEnableSebAssessment(setting, courseDefaults);
            const ready = enabled && item.readiness?.status === "ready";
            const availabilityWindow = enabled ? availabilityWindowLabel(item.unlockAt, item.lockAt) : null;
            return (
              <article className="content-row teacher-row" key={item.id}>
                <div className="content-main">
                  <span className="assessment-icon" aria-hidden="true">
                    <BookOpen size={18} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>
                      {item.quizTypeDisplay || item.contentType || "Canvas content"}
                      <span className={clsx("assessment-status", ready && "enabled")}>
                        {ready ? <ShieldCheck size={13} /> : <Shield size={13} />}
                        {enabled ? readinessMessage(item.readiness?.status) : "Browser not required"}
                      </span>
                      {enabled && (
                        <span className="assessment-status">
                          Canvas:{" "}
                          {publicationLabel(
                            item.readiness?.publicationStatus || item.publication?.status,
                            item.published
                          )}
                        </span>
                      )}
                    </p>
                    {availabilityWindow && <p className="muted">{availabilityWindow}</p>}
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
                          ? "Disable Safe Online Exam"
                          : "Enable Safe Online Exam"
                        : "Set an exit password in Course defaults before enabling Safe Online Exam"
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

      <Suspense fallback={<InstructorDialogLoadingFallback />}>
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
      </Suspense>

      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
    </main>
  );
}

function publicationLabel(status?: string, published?: boolean | null): string {
  if (status === "published") return "Published";
  if (status === "unpublished") return "Unpublished";
  if (status === "conflict") return "Needs review";
  if (status === "unknown") return "Needs refresh";
  if (published === true) return "Published";
  if (published === false) return "Unpublished";
  return "Needs refresh";
}

function applyReadiness(item: QuizView, readiness: QuizView["readiness"]): QuizView {
  if (!readiness) return item;
  return {
    ...item,
    readiness,
    published:
      readiness.publicationStatus === "published" ? true : readiness.publicationStatus === "unpublished" ? false : null,
    publication: {
      ...item.publication,
      status: readiness.publicationStatus,
      confidence: readiness.publicationConfidence,
      checkedAt: readiness.verifiedAt || undefined
    },
    unlockAt: readiness.unlockAt,
    lockAt: readiness.lockAt
  };
}

function formatCanvasTime(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : null;
}

function availabilityWindowLabel(unlockAt?: string | null, lockAt?: string | null): string | null {
  const opens = formatCanvasTime(unlockAt);
  const closes = formatCanvasTime(lockAt);
  const parts = [opens ? `Opens ${opens}` : null, closes ? `Closes ${closes}` : null].filter(
    (value): value is string => !!value
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function readinessMessage(status?: string): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "configured_unpublished":
      return "Configured — publish in Canvas";
    case "not_yet_open":
      return "Configured — not open yet";
    case "closed":
      return "Configured — closed";
    case "publication_conflict":
      return "Configured — review Canvas status";
    case "publication_unknown":
    case "canvas_stale":
      return "Configured — refresh needed";
    case "canvas_missing":
      return "Configured — not found in Canvas";
    case "settings_incomplete":
      return "Configured — finish setup";
    default:
      return "Configured — not ready";
  }
}

function InstructorDialogLoadingFallback() {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="status" aria-label="Loading assessment settings">
        <RefreshCw className="spin" size={18} /> Loading assessment settings…
      </section>
    </div>
  );
}
