import { AlertCircle, BookOpen, RefreshCw, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { ExternalToolConfig } from "../../../shared/models.js";
import { AdminCoursesSection, AdminInstitutionSection } from "./workspace-sections.js";
import { actionHeaders, errorMessage, requestJson } from "../../lib/api.js";
import { BrandMark } from "../../components/brand-mark.js";
import { useDialogInitialFocus, useEscapeToClose } from "../../hooks/dialog.js";
import { ToastRegion } from "../../components/feedback.js";
import { clientId } from "../../lib/id.js";
import {
  AdminCourseView,
  AdminOverview,
  AdminSection,
  AdminToolPresetView,
  RevealedSecrets,
  Toast
} from "../../types.js";

const ADMIN_SECTION_STORAGE_KEY = "seb-admin-section";

const ADMIN_COURSE_STORAGE_KEY = "seb-admin-course";

const AdminConnectCoursesDialog = lazy(async () => ({
  default: (await import("./dialogs.js")).AdminConnectCoursesDialog
}));
const AdminPresetRolloutDialog = lazy(async () => ({
  default: (await import("./dialogs.js")).AdminPresetRolloutDialog
}));
const AdminToolPresetDialog = lazy(async () => ({
  default: (await import("./dialogs.js")).AdminToolPresetDialog
}));

export function AdminDashboard({ data }: { data: Record<string, any> }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>(() =>
    window.localStorage.getItem(ADMIN_SECTION_STORAGE_KEY) === "institution" ? "institution" : "courses"
  );
  const [selectedCourseId, setSelectedCourseId] = useState(
    () => window.localStorage.getItem(ADMIN_COURSE_STORAGE_KEY) || ""
  );
  const [query, setQuery] = useState("");
  const [includePast, setIncludePast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [revealed, setRevealed] = useState<Record<string, RevealedSecrets>>({});
  const [editingPreset, setEditingPreset] = useState<AdminToolPresetView | "new" | null>(null);
  const [connectingCourses, setConnectingCourses] = useState(false);
  const [rolloutPreset, setRolloutPreset] = useState<AdminToolPresetView | null>(null);
  const [courseToReset, setCourseToReset] = useState<AdminCourseView | null>(null);
  const firstOverviewLoad = useRef(true);
  const suppressNextFilterLoad = useRef(false);
  const overviewLoadedCourseId = useRef("");

  const startBusy = (key: string) => setBusy((current) => new Set(current).add(key));
  const stopBusy = (key: string) =>
    setBusy((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  const isBusy = (key: string) => busy.has(key);

  const pushToast = (tone: Toast["tone"], message: string) => {
    const id = clientId("admin-toast");
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5200);
  };

  const loadCourseDetail = async (courseId: string) => {
    if (!courseId) return;
    const body = await requestJson(`/api/admin/courses/${encodeURIComponent(courseId)}`);
    const course = body.course as AdminCourseView;
    setOverview((current) =>
      current
        ? {
            ...current,
            courses: (current.courses || []).map((value) => (value.id === course.id ? course : value))
          }
        : current
    );
  };

  const loadPresets = async () => {
    const body = await requestJson("/api/admin/tool-presets");
    setOverview((current) => (current ? { ...current, toolPresets: body.presets || [] } : current));
  };

  const loadSummary = async () => {
    const body = await requestJson("/api/admin/summary");
    setOverview((current) => (current ? { ...current, account: body.account, summary: body.summary } : current));
  };

  const loadOverview = async (preserveSelection = true, search = query, includePastCourses = includePast) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (search.trim()) params.set("search", search.trim());
      if (includePastCourses) params.set("includePast", "true");
      const [summaryBody, courseBody, termsBody] = await Promise.all([
        requestJson("/api/admin/summary"),
        requestJson(`/api/admin/courses?${params.toString()}`),
        requestJson("/api/admin/terms")
      ]);
      const courses = (courseBody.courses || []) as AdminCourseView[];
      const requestedSelection = preserveSelection && !search.trim() ? selectedCourseId : "";
      const preferred = courses.some((course) => course.id === requestedSelection)
        ? requestedSelection
        : courses[0]?.id || "";
      const [detailBody, presetBody] = await Promise.all([
        preferred
          ? requestJson(`/api/admin/courses/${encodeURIComponent(preferred)}`).catch(() => null)
          : Promise.resolve(null),
        preferred || activeSection === "institution" ? requestJson("/api/admin/tool-presets") : Promise.resolve(null)
      ]);
      const resolvedSelection = detailBody?.course?.id || courses[0]?.id || "";
      overviewLoadedCourseId.current = detailBody?.course?.id || "";
      const detailedCourses = detailBody?.course
        ? courses.some((course) => course.id === detailBody.course.id)
          ? courses.map((course) => (course.id === detailBody.course.id ? detailBody.course : course))
          : [detailBody.course, ...courses]
        : courses;
      setOverview((current) => ({
        ...current,
        account: summaryBody.account,
        summary: summaryBody.summary,
        operationalTerm: termsBody.operationalTerm || summaryBody.operationalTerm || null,
        terms: termsBody.terms || [],
        courses: detailedCourses,
        toolPresets: presetBody?.presets || current?.toolPresets,
        nextCourseCursor: courseBody.nextCursor || null
      }));
      setSelectedCourseId(resolvedSelection);
    } catch (value) {
      setError(errorMessage(value, "The school dashboard could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  const loadMoreCourses = async () => {
    const cursor = overview?.nextCourseCursor;
    if (!cursor) return;
    const params = new URLSearchParams({ limit: "25", cursor });
    if (query.trim()) params.set("search", query.trim());
    if (includePast) params.set("includePast", "true");
    const key = "courses:more";
    startBusy(key);
    try {
      const body = await requestJson(`/api/admin/courses?${params.toString()}`);
      setOverview((current) =>
        current
          ? {
              ...current,
              courses: [...(current.courses || []), ...(body.courses || [])],
              nextCourseCursor: body.nextCursor || null
            }
          : current
      );
    } catch (value) {
      pushToast("error", errorMessage(value, "More courses could not be loaded."));
    } finally {
      stopBusy(key);
    }
  };

  useEffect(() => {
    window.localStorage.setItem(ADMIN_SECTION_STORAGE_KEY, activeSection);
    if (activeSection === "institution" && !overview?.toolPresets) {
      void loadPresets();
    }
  }, [activeSection]);

  const overviewReady = overview !== null;
  useEffect(() => {
    if (!selectedCourseId || !overviewReady) return;
    window.localStorage.setItem(ADMIN_COURSE_STORAGE_KEY, selectedCourseId);
    if (overviewLoadedCourseId.current === selectedCourseId) {
      overviewLoadedCourseId.current = "";
      return;
    }
    void loadCourseDetail(selectedCourseId).catch((value) =>
      pushToast("error", errorMessage(value, "The course details could not be loaded."))
    );
  }, [selectedCourseId, overviewReady]);

  useEffect(() => {
    if (suppressNextFilterLoad.current) {
      suppressNextFilterLoad.current = false;
      return;
    }
    const delay = firstOverviewLoad.current ? 0 : 350;
    firstOverviewLoad.current = false;
    const timer = window.setTimeout(() => void loadOverview(true, query), delay);
    return () => window.clearTimeout(timer);
  }, [query, includePast]);

  async function updateOperationalTerm(termId: string) {
    const key = "operational-term";
    startBusy(key);
    try {
      await requestJson("/api/admin/terms/operational", {
        method: "PUT",
        headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
        body: JSON.stringify({ termId })
      });
      if (includePast) {
        suppressNextFilterLoad.current = true;
        setIncludePast(false);
      }
      await loadOverview(false, query, false);
      pushToast("success", "Operational term updated for all administrators.");
    } catch (value) {
      pushToast("error", errorMessage(value, "The operational term could not be updated."));
    } finally {
      stopBusy(key);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setRevealed((current) =>
        Object.fromEntries(Object.entries(current).filter(([, secret]) => secret.expiresAt > now))
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const courses = overview?.courses || [];
  const filteredCourses = courses;
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) || null;

  async function mutate(key: string, url: string, init: RequestInit, successMessage: string) {
    startBusy(key);
    try {
      await requestJson(url, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...actionHeaders(data.authToken),
          ...init.headers
        }
      });
      pushToast("success", successMessage);
      await Promise.all([
        loadCourseDetail(selectedCourseId),
        loadSummary(),
        key.startsWith("assign-preset:") ? loadPresets() : Promise.resolve()
      ]);
    } catch (value) {
      pushToast("error", errorMessage(value, "The administrator action could not be completed."));
    } finally {
      stopBusy(key);
    }
  }

  async function revealSecrets(key: string, url: string) {
    startBusy(key);
    try {
      const body = await requestJson(url, { method: "POST", headers: actionHeaders(data.authToken) });
      const secret = revealedSecrets(body);
      setRevealed((current) => ({
        ...current,
        [key]: secret
      }));
      if (!secret.values.length) pushToast("success", "No passwords are currently configured here.");
    } catch (value) {
      pushToast("error", errorMessage(value, "Passwords could not be revealed."));
    } finally {
      stopBusy(key);
    }
  }

  function storeRevealedSecrets(key: string, body: Record<string, any>) {
    setRevealed((current) => ({
      ...current,
      [key]: revealedSecrets(body)
    }));
  }

  async function rotateCourseQuitPassword(course: AdminCourseView) {
    if (
      !window.confirm(
        "Rotate this course exit password? Existing downloaded Safe Online Exam configuration files will no longer contain the current password."
      )
    ) {
      return;
    }
    const key = `course:${course.id}`;
    const busyKey = `rotate-password:${course.id}`;
    startBusy(busyKey);
    try {
      const body = await requestJson(`/api/admin/courses/${encodeURIComponent(course.id)}/quit-password/rotate`, {
        method: "POST",
        headers: actionHeaders(data.authToken)
      });
      storeRevealedSecrets(key, body);
      pushToast("success", "Course exit password rotated and shown for 30 seconds.");
      await loadCourseDetail(course.id);
    } catch (value) {
      pushToast("error", errorMessage(value, "The course exit password could not be rotated."));
    } finally {
      stopBusy(busyKey);
    }
  }

  async function resetCourse(course: AdminCourseView, confirmation: string) {
    const busyKey = `reset-course:${course.id}`;
    startBusy(busyKey);
    try {
      const body = await requestJson(`/api/admin/courses/${encodeURIComponent(course.id)}/reset`, {
        method: "POST",
        headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
        body: JSON.stringify({ confirmation })
      });
      const assessmentSecretKeys = new Set(
        (course.assessments || []).map((assessment) => `assessment:${assessment.id}`)
      );
      setRevealed((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== `course:${course.id}` && !assessmentSecretKeys.has(key))
        )
      );
      await loadOverview(true);
      setCourseToReset(null);
      pushToast(
        "success",
        `${Number(body.disabledAssessmentCount || 0)} Canvas assessment${Number(body.disabledAssessmentCount || 0) === 1 ? " was" : "s were"} disabled. ${course.name} will open as a new Safe Online Exam course.`
      );
    } finally {
      stopBusy(busyKey);
    }
  }

  async function reconcilePreset(presetId: string, retryFailed = false) {
    let attempts = 0;
    let result = await requestJson(`/api/admin/tool-presets/${encodeURIComponent(presetId)}/assignments/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
      body: JSON.stringify({ retryFailed })
    });
    while (Number(result.rollout?.pending || 0) > 0 && attempts < 200) {
      attempts += 1;
      result = await requestJson(`/api/admin/tool-presets/${encodeURIComponent(presetId)}/assignments/reconcile`, {
        method: "POST",
        headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
        body: JSON.stringify({ retryFailed: false })
      });
    }
    if (Number(result.rollout?.failed || 0) > 0) {
      throw new Error(
        `${result.rollout.failed} course${result.rollout.failed === 1 ? "" : "s"} could not be updated. Retry the rollout from the tool card.`
      );
    }
    return result;
  }

  async function runPresetRollout(presetId: string, assigned: boolean, all: boolean, courseIds: string[]) {
    const initial = await requestJson(`/api/admin/tool-presets/${encodeURIComponent(presetId)}/assignments`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
      body: JSON.stringify({ assigned, all, courseIds })
    });
    if (Number(initial.rollout?.pending || 0) > 0) {
      await reconcilePreset(presetId);
    }
    if (Number(initial.rollout?.failed || 0) > 0) {
      await reconcilePreset(presetId, true);
    }
    await Promise.all([loadPresets(), loadSummary()]);
  }

  async function savePreset(input: { name: string; description: string; tool: ExternalToolConfig }) {
    const current = editingPreset === "new" ? null : editingPreset;
    const url = current ? `/api/admin/tool-presets/${encodeURIComponent(current.id)}` : "/api/admin/tool-presets";
    await requestJson(url, {
      method: current ? "PUT" : "POST",
      headers: { "content-type": "application/json", ...actionHeaders(data.authToken) },
      body: JSON.stringify(input)
    });
    if (current) {
      await reconcilePreset(current.id);
    }
    await loadPresets();
    setEditingPreset(null);
    pushToast("success", current ? "School tool preset updated." : "School tool preset created.");
  }

  async function deletePreset(preset: AdminToolPresetView) {
    if (
      !window.confirm(
        `Delete “${preset.name}”? It will be removed from ${preset.assignedCourseCount} assigned course${preset.assignedCourseCount === 1 ? "" : "s"}.`
      )
    ) {
      return;
    }
    const key = `delete-preset:${preset.id}`;
    startBusy(key);
    try {
      if (preset.assignedCourseCount) {
        await runPresetRollout(preset.id, false, true, []);
      }
      await requestJson(`/api/admin/tool-presets/${encodeURIComponent(preset.id)}`, {
        method: "DELETE",
        headers: actionHeaders(data.authToken)
      });
      pushToast("success", "School tool preset deleted.");
      await Promise.all([loadPresets(), loadOverview(true)]);
    } catch (value) {
      pushToast("error", errorMessage(value, "The school tool preset could not be deleted."));
    } finally {
      stopBusy(key);
    }
  }

  function retryPreset(presetId: string) {
    const key = `retry-preset:${presetId}`;
    startBusy(key);
    void reconcilePreset(presetId, true)
      .then(() => {
        pushToast("success", "The failed course updates were retried.");
        return loadPresets();
      })
      .catch((value) => pushToast("error", errorMessage(value, "Some course updates still need attention.")))
      .finally(() => stopBusy(key));
  }

  const summary = overview?.summary || {};
  const sections: Array<{
    id: AdminSection;
    label: string;
    description: string;
    count: number;
    icon: ReactNode;
  }> = [
    {
      id: "courses",
      label: "Courses",
      description: "Manage configured courses and assessments",
      count: summary.configuredCourseCount || 0,
      icon: <BookOpen size={17} />
    },
    {
      id: "institution",
      label: "Institution settings",
      description: "Manage approved exam tools",
      count: summary.toolPresetCount || overview?.toolPresets?.length || 0,
      icon: <SlidersHorizontal size={17} />
    }
  ];

  function navigateAdminTabs(event: ReactKeyboardEvent<HTMLButtonElement>, currentSection: AdminSection) {
    const currentIndex = sections.findIndex((section) => section.id === currentSection);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % sections.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + sections.length) % sections.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = sections.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextSection = sections[nextIndex].id;
    setActiveSection(nextSection);
    window.requestAnimationFrame(() => document.getElementById(`admin-tab-${nextSection}`)?.focus());
  }

  if (loading && !overview) {
    return <AdminDashboardSkeleton />;
  }

  return (
    <main className="app-shell admin-shell">
      <header className="topbar">
        <div className="topbar-title">
          <BrandMark />
          <div>
            <h1>Safe Online Exam Admin</h1>
            <p>{overview?.account?.name || `Canvas account ${data.rootAccountId || ""}`}</p>
          </div>
        </div>
        <div className="topbar-actions admin-summary-pills">
          <div className="stat-pill">
            <span>Courses</span>
            <strong>{summary.courseCount || 0}</strong>
          </div>
          <div className="stat-pill">
            <span>Assessments</span>
            <strong>{summary.assessmentCount || 0}</strong>
          </div>
          <div className="stat-pill active">
            <span>Safe Online Exam active</span>
            <strong>{summary.enabledAssessmentCount || 0}</strong>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            title="Refresh dashboard"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={17} /> {error}
        </div>
      )}

      <nav className="admin-tabs" aria-label="Administrator workspace" role="tablist">
        {sections.map((section) => (
          <button
            key={section.id}
            id={`admin-tab-${section.id}`}
            className={clsx("admin-tab", activeSection === section.id && "active")}
            type="button"
            role="tab"
            aria-selected={activeSection === section.id}
            aria-controls={`admin-panel-${section.id}`}
            tabIndex={activeSection === section.id ? 0 : -1}
            onClick={() => setActiveSection(section.id)}
            onKeyDown={(event) => navigateAdminTabs(event, section.id)}
          >
            <span className="admin-tab-icon">{section.icon}</span>
            <span>
              <strong>{section.label}</strong>
              <small>{section.description}</small>
            </span>
            <span className="admin-tab-count">{section.count}</span>
          </button>
        ))}
      </nav>

      {activeSection === "courses" && (
        <AdminCoursesSection
          overview={overview}
          loading={loading}
          courses={filteredCourses}
          selectedCourseId={selectedCourseId}
          selectedCourse={selectedCourse}
          query={query}
          includePast={includePast}
          revealed={revealed}
          isBusy={isBusy}
          onConnect={() => setConnectingCourses(true)}
          onQuery={setQuery}
          onIncludePast={setIncludePast}
          onOperationalTerm={(termId) => void updateOperationalTerm(termId)}
          onSelectCourse={setSelectedCourseId}
          onLoadMore={() => void loadMoreCourses()}
          onReveal={(key, url) => void revealSecrets(key, url)}
          onRotateCourseQuitPassword={(course) => void rotateCourseQuitPassword(course)}
          onMutate={(key, url, init, successMessage) => void mutate(key, url, init, successMessage)}
          onResetCourse={setCourseToReset}
        />
      )}

      {activeSection === "institution" && (
        <AdminInstitutionSection
          presets={overview?.toolPresets || []}
          isBusy={isBusy}
          onCreate={() => setEditingPreset("new")}
          onRollout={setRolloutPreset}
          onRetry={retryPreset}
          onEdit={setEditingPreset}
          onDelete={(preset) => void deletePreset(preset)}
        />
      )}

      <Suspense fallback={<AdminDialogLoadingFallback />}>
        {editingPreset && (
          <AdminToolPresetDialog
            preset={editingPreset === "new" ? undefined : editingPreset}
            onClose={() => setEditingPreset(null)}
            onSave={savePreset}
          />
        )}
        {connectingCourses && (
          <AdminConnectCoursesDialog
            authToken={data.authToken}
            onClose={() => setConnectingCourses(false)}
            onConnected={async () => {
              setConnectingCourses(false);
              await loadOverview(false);
              pushToast("success", "The selected Canvas courses are now connected.");
            }}
          />
        )}
        {rolloutPreset && (
          <AdminPresetRolloutDialog
            preset={rolloutPreset}
            onClose={() => setRolloutPreset(null)}
            onApply={async (assigned, all, courseIds) => {
              await runPresetRollout(rolloutPreset.id, assigned, all, courseIds);
              setRolloutPreset(null);
              if (selectedCourseId) await loadCourseDetail(selectedCourseId);
              pushToast("success", "The exam tool rollout completed.");
            }}
          />
        )}
      </Suspense>
      {courseToReset && (
        <AdminCourseResetDialog
          course={courseToReset}
          busy={isBusy(`reset-course:${courseToReset.id}`)}
          onClose={() => setCourseToReset(null)}
          onReset={(confirmation) => resetCourse(courseToReset, confirmation)}
        />
      )}
      <ToastRegion
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </main>
  );
}

function AdminDialogLoadingFallback() {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="status" aria-label="Loading administrator controls">
        <RefreshCw className="spin" size={18} /> Loading administrator controls…
      </section>
    </div>
  );
}

function revealedSecrets(body: Record<string, any>): RevealedSecrets {
  const values = Object.entries((body.passwords || {}) as Record<string, { value?: unknown; source?: unknown }>)
    .filter(([, secret]) => typeof secret.value === "string" && secret.value.length > 0)
    .map(([name, secret]) => ({
      label: name === "accessCode" ? "Canvas access code" : name === "start" ? "Start password" : "Exit password",
      value: String(secret.value),
      source: typeof secret.source === "string" ? secret.source : undefined
    }));
  return {
    values,
    expiresAt: Date.now() + Number(body.expiresInSeconds || 30) * 1000
  };
}

function AdminCourseResetDialog({
  course,
  busy,
  onClose,
  onReset
}: {
  course: AdminCourseView;
  busy: boolean;
  onClose: () => void;
  onReset: (confirmation: string) => Promise<void>;
}) {
  useEscapeToClose(busy ? undefined : onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogInitialFocus(inputRef);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const confirmed = confirmation.trim() === course.id;

  const submit = async () => {
    if (!confirmed || busy) return;
    setError("");
    try {
      await onReset(confirmation.trim());
    } catch (value) {
      setError(
        errorMessage(
          value,
          "The course reset could not be confirmed. Refresh the course and verify its Canvas assessment access codes before trying again"
        )
      );
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog admin-course-reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-course-reset-title"
      >
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Administrator-only reset</span>
            <h2 id="admin-course-reset-title">Reset {course.name}?</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close course reset"
          >
            <X size={17} />
          </button>
        </header>
        <div className="admin-course-reset-warning">
          <AlertCircle size={20} />
          <div>
            <strong>This rebuilds the Safe Online Exam setup for this course.</strong>
            <p>The reset completes in this order:</p>
            <ol>
              <li>Remove Safe Online Exam access codes from every current Classic Quiz and New Quiz in Canvas.</li>
              <li>
                Delete the local course policy, assessment settings, outstanding course access grants, and school tool
                assignments.
              </li>
              <li>Show the guided setup the next time an instructor opens this course.</li>
            </ol>
          </div>
        </div>
        <p className="admin-course-reset-preserved">
          Canvas authorization and the administrator connection stay in place. If Canvas cannot disable every
          assessment, local records will not be deleted.
        </p>
        <label className="admin-course-reset-confirmation">
          Enter course ID <strong>{course.id}</strong> to confirm
          <input
            ref={inputRef}
            value={confirmation}
            disabled={busy}
            autoComplete="off"
            inputMode="numeric"
            onChange={(event) => setConfirmation(event.target.value)}
            aria-invalid={!!confirmation && !confirmed}
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} /> <span>{error}</span>
          </div>
        )}
        <footer className="dialog-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button danger" type="button" disabled={!confirmed || busy} onClick={() => void submit()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Trash2 size={16} />}
            {busy ? "Disabling quizzes and resetting…" : "Disable quizzes and reset course"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AdminDashboardSkeleton() {
  return (
    <main className="app-shell admin-shell dashboard-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading Safe Online Exam administration…</span>
      <header className="topbar">
        <div className="skeleton-heading">
          <span className="skeleton-block skeleton-icon" />
          <span>
            <span className="skeleton-block skeleton-title" />
            <span className="skeleton-block skeleton-copy" />
          </span>
        </div>
        <div className="skeleton-stat-group" aria-hidden="true">
          <span className="skeleton-block skeleton-stat" />
          <span className="skeleton-block skeleton-stat" />
          <span className="skeleton-block skeleton-stat" />
        </div>
      </header>
      <div className="skeleton-tabs" aria-hidden="true">
        <span className="skeleton-block" />
        <span className="skeleton-block" />
      </div>
      <section className="work-surface skeleton-workspace" aria-hidden="true">
        <aside>
          <span className="skeleton-block skeleton-copy" />
          <span className="skeleton-block skeleton-input" />
          <span className="skeleton-block skeleton-row" />
          <span className="skeleton-block skeleton-row" />
          <span className="skeleton-block skeleton-row" />
        </aside>
        <div>
          <span className="skeleton-block skeleton-title" />
          <span className="skeleton-block skeleton-copy" />
          <span className="skeleton-block skeleton-detail" />
          <span className="skeleton-block skeleton-detail" />
        </div>
      </section>
    </main>
  );
}
