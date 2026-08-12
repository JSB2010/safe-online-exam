import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Calculator,
  Check,
  ChevronDown,
  Copy,
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
  SlidersHorizontal,
  Trash2,
  Unlock,
  X
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import safeOnlineExamIcon from "./assets/safe-online-exam-icon.png";
import type {
  CourseSebDefaults,
  ExternalToolAccessRule,
  ExternalToolConfig,
  SebUrlRule,
  SebUrlRuleMatch
} from "../shared/models.js";
import {
  EXTERNAL_TOOL_PRESETS,
  canEnableSebAssessment,
  isYouTubeVideoTool,
  isYouTubeUrl,
  legacyDomainsToUrlRules,
  normalizeCourseExternalTools,
  normalizeYouTubeVideoUrl,
  normalizeUrlRules,
  YOUTUBE_VIDEO_TOOL_PRESET
} from "../shared/models.js";
import {
  evaluateSebPasswordRequirements,
  normalizeSebPassword,
  SEB_PASSWORD_MAX_LENGTH,
  SEB_PASSWORD_MIN_LENGTH,
  sebPasswordPolicyMessage,
  sebPasswordPolicyViolation
} from "../shared/seb-password-policy.js";
import type { SebPasswordPurpose } from "../shared/seb-password-policy.js";

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

type InstructorSetupStep = "welcome" | "security" | "tools" | "enable";

type Toast = {
  id: string;
  tone: "success" | "error";
  message: string;
};

type CourseToolCopyCourse = {
  courseId: string;
  name: string;
  courseCode: string | null;
};

type CourseToolCopyResult = {
  copied: CourseToolCopyCourse[];
  alreadyPresent: CourseToolCopyCourse[];
  failed: Array<CourseToolCopyCourse & { errorCode?: string }>;
};

type ClientRequestError = Error & {
  code?: string;
  status?: number;
  detail?: string;
  userFacing?: true;
};

type OnboardingRecovery = {
  message: string;
  actionLabel?: string;
  actionUrl?: string;
};

function BrandMark() {
  return (
    <div className="brand-mark">
      <img src={safeOnlineExamIcon} alt="" />
    </div>
  );
}

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

const SEB_OFFICIAL_DOWNLOAD_URL = "https://safeexambrowser.org/download_en.html";
const SEB_LAUNCH_RECOVERY_DELAY_MS = 5_000;
const SEB_LAUNCH_HANDOFF_STORAGE_PREFIX = "safe-online-exam:seb-launch:";
type SebLaunchHandoffPurpose = "assessment" | "setup-check" | "student-list";

export function App() {
  switch (bootstrap.view) {
    case "admin":
      return <AdminDashboard data={bootstrap.data} />;
    case "teacher":
      return <TeacherDashboard data={bootstrap.data} />;
    case "api-authorization":
      return <AuthorizationPage data={bootstrap.data} />;
    case "student-session-authorization":
      return <StudentSessionAuthorizationPage data={bootstrap.data} />;
    case "student-session-connected":
      return <StudentSessionConnectedPage data={bootstrap.data} />;
    case "canvas-oauth-connected":
      return <CanvasOAuthConnectedPage data={bootstrap.data} />;
    case "seb-required":
    case "seb-download":
      return <SebDownloadPage data={bootstrap.data} />;
    case "seb-launching":
      return <SebLaunchingPage data={bootstrap.data} />;
    case "seb-launching-handoff":
      return <SebLaunchingHandoffPage />;
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
      return <ServiceStatusPage data={bootstrap.data} />;
    default:
      return <MessagePage icon={<Shield />} title="Safe Online Exam" message="This service is running." />;
  }
}

type AdminAssessmentView = {
  id: string;
  title: string;
  contentType: string;
  published: boolean;
  sebRequired: boolean;
  enabled: boolean;
  hasAccessCode: boolean;
  hasStartPassword: boolean;
  hasQuitPassword: boolean;
  updatedAt?: string | null;
};

type AdminCourseView = {
  id: string;
  name: string;
  courseCode?: string | null;
  workflowState?: string | null;
  concluded?: boolean;
  termId?: string | null;
  termName?: string | null;
  teacherNames?: string[];
  setupCompleted?: boolean;
  hasCourseDefaults?: boolean;
  assessmentCount: number;
  enabledAssessmentCount: number;
  issueCount?: number;
  lastRefreshedAt?: string | null;
  adminToolPresetIds?: string[];
  assessments?: AdminAssessmentView[];
};

type AdminTermView = {
  id: string;
  name: string;
  startAt?: string | null;
  endAt?: string | null;
};

type AdminToolPresetView = {
  id: string;
  name: string;
  description?: string | null;
  tool: ExternalToolConfig;
  assignedCourseIds: string[];
  assignedCourseCount: number;
  pendingAssignmentCount?: number;
  failedAssignmentCount?: number;
  updatedAt?: string | null;
};

type AdminOverview = {
  account?: { id?: string; name?: string };
  operationalTerm?: AdminTermView | null;
  terms?: AdminTermView[];
  summary?: {
    courseCount?: number;
    configuredCourseCount?: number;
    assessmentCount?: number;
    enabledAssessmentCount?: number;
    issueCount?: number;
    toolPresetCount?: number;
    pendingPresetAssignmentCount?: number;
    failedPresetAssignmentCount?: number;
  };
  courses?: AdminCourseView[];
  toolPresets?: AdminToolPresetView[];
  nextCourseCursor?: string | null;
};

type RevealedSecrets = {
  expiresAt: number;
  values: Array<{ label: string; value: string; source?: string }>;
};

type AdminSection = "courses" | "institution";

const ADMIN_SECTION_STORAGE_KEY = "seb-admin-section";
const ADMIN_COURSE_STORAGE_KEY = "seb-admin-course";

function AdminDashboard({ data }: { data: Record<string, any> }) {
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
    void loadOverview(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ADMIN_SECTION_STORAGE_KEY, activeSection);
    if (activeSection === "institution" && !overview?.toolPresets) {
      void loadPresets();
    }
  }, [activeSection]);

  useEffect(() => {
    if (!selectedCourseId) return;
    window.localStorage.setItem(ADMIN_COURSE_STORAGE_KEY, selectedCourseId);
    void loadCourseDetail(selectedCourseId).catch((value) =>
      pushToast("error", errorMessage(value, "The course details could not be loaded."))
    );
  }, [selectedCourseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(true, query), 350);
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
      setIncludePast(false);
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
      const values = Object.entries((body.passwords || {}) as Record<string, { value?: unknown; source?: unknown }>)
        .filter(([, secret]) => typeof secret.value === "string" && secret.value.length > 0)
        .map(([name, secret]) => ({
          label: name === "accessCode" ? "Canvas access code" : name === "start" ? "Start password" : "Exit password",
          value: String(secret.value),
          source: typeof secret.source === "string" ? secret.source : undefined
        }));
      setRevealed((current) => ({
        ...current,
        [key]: { values, expiresAt: Date.now() + Number(body.expiresInSeconds || 30) * 1000 }
      }));
      if (!values.length) pushToast("success", "No passwords are currently configured here.");
    } catch (value) {
      pushToast("error", errorMessage(value, "Passwords could not be revealed."));
    } finally {
      stopBusy(key);
    }
  }

  function storeRevealedSecrets(key: string, body: Record<string, any>) {
    const values = Object.entries((body.passwords || {}) as Record<string, { value?: unknown; source?: unknown }>)
      .filter(([, secret]) => typeof secret.value === "string" && secret.value.length > 0)
      .map(([name, secret]) => ({
        label: name === "accessCode" ? "Canvas access code" : name === "start" ? "Start password" : "Exit password",
        value: String(secret.value),
        source: typeof secret.source === "string" ? secret.source : undefined
      }));
    setRevealed((current) => ({
      ...current,
      [key]: { values, expiresAt: Date.now() + Number(body.expiresInSeconds || 30) * 1000 }
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
        <section
          className="work-surface admin-surface"
          id="admin-panel-courses"
          role="tabpanel"
          aria-labelledby="admin-tab-courses"
        >
          <aside className="admin-course-sidebar">
            <div className="admin-sidebar-heading">
              <div>
                <span className="section-kicker">Safe Online Exam</span>
                <h2>Configured courses</h2>
              </div>
              <button className="button primary small" type="button" onClick={() => setConnectingCourses(true)}>
                <Plus size={14} /> Connect
              </button>
            </div>
            <div className="search admin-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, code, teacher, term, or ID"
                aria-label="Search configured courses"
              />
            </div>
            <div className="admin-course-scope-controls">
              <label>
                Operational term
                <select
                  value={overview?.operationalTerm?.id || ""}
                  disabled={isBusy("operational-term") || !overview?.terms?.length}
                  onChange={(event) => void updateOperationalTerm(event.target.value)}
                >
                  {!overview?.terms?.length && <option value="">No active Canvas terms</option>}
                  {(overview?.terms || []).map((term) => (
                    <option value={term.id} key={term.id}>
                      {term.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-line compact">
                <input
                  type="checkbox"
                  checked={includePast}
                  onChange={(event) => setIncludePast(event.target.checked)}
                />
                Show past and other courses
              </label>
            </div>
            <div className="admin-course-list">
              {loading && !overview && (
                <div className="admin-loading">
                  <RefreshCw className="spin" size={18} /> Loading configured courses…
                </div>
              )}
              {!loading && !filteredCourses.length && (
                <div className="empty-line">
                  {query
                    ? "No matching configured courses."
                    : includePast
                      ? "No courses have configured Safe Online Exam yet."
                      : "No configured courses are active in the operational term."}
                </div>
              )}
              {filteredCourses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  className={clsx("admin-course-row", selectedCourseId === course.id && "selected")}
                  onClick={() => setSelectedCourseId(course.id)}
                >
                  <span>
                    <strong>{course.name}</strong>
                    <small>{course.courseCode || `Course ${course.id}`}</small>
                  </span>
                  <span
                    className={clsx("admin-count", course.enabledAssessmentCount > 0 && "active")}
                    title={`${course.enabledAssessmentCount} of ${course.assessmentCount} assessments require Safe Online Exam`}
                  >
                    {course.enabledAssessmentCount}/{course.assessmentCount}
                  </span>
                </button>
              ))}
              {!!overview?.nextCourseCursor && (
                <button
                  className="button secondary admin-load-more"
                  type="button"
                  disabled={isBusy("courses:more")}
                  onClick={() => void loadMoreCourses()}
                >
                  <ChevronDown size={15} /> {isBusy("courses:more") ? "Loading…" : "Load more courses"}
                </button>
              )}
            </div>
          </aside>

          <div className="admin-course-detail">
            {selectedCourse ? (
              <>
                <div className="admin-detail-header">
                  <div>
                    <span className="section-kicker">Course {selectedCourse.id}</span>
                    <h2>{selectedCourse.name}</h2>
                    <p>
                      {selectedCourse.courseCode || "No course code"} ·{" "}
                      {selectedCourse.workflowState || "unknown state"}
                    </p>
                  </div>
                  <div className="admin-detail-actions">
                    <button
                      className="button secondary compact"
                      type="button"
                      disabled={isBusy(`course:${selectedCourse.id}`)}
                      onClick={() =>
                        void revealSecrets(
                          `course:${selectedCourse.id}`,
                          `/api/admin/courses/${encodeURIComponent(selectedCourse.id)}/passwords/reveal`
                        )
                      }
                    >
                      <KeyRound size={15} /> Course passwords
                    </button>
                    <button
                      className="button secondary compact"
                      type="button"
                      disabled={isBusy(`rotate-password:${selectedCourse.id}`)}
                      onClick={() => void rotateCourseQuitPassword(selectedCourse)}
                    >
                      <RefreshCw size={15} /> Rotate exit password
                    </button>
                    <button
                      className="button primary compact"
                      type="button"
                      disabled={isBusy(`refresh:${selectedCourse.id}`)}
                      onClick={() =>
                        void mutate(
                          `refresh:${selectedCourse.id}`,
                          `/api/admin/courses/${encodeURIComponent(selectedCourse.id)}/refresh`,
                          { method: "POST" },
                          "Course content refreshed from Canvas."
                        )
                      }
                    >
                      <RefreshCw className={isBusy(`refresh:${selectedCourse.id}`) ? "spin" : ""} size={15} /> Refresh
                      course
                    </button>
                    <button
                      className="button danger compact"
                      type="button"
                      disabled={isBusy(`reset-course:${selectedCourse.id}`)}
                      onClick={() => setCourseToReset(selectedCourse)}
                    >
                      <Trash2 size={15} /> Reset course
                    </button>
                  </div>
                </div>
                <SecretPanel secret={revealed[`course:${selectedCourse.id}`]} />
                {!!overview?.toolPresets?.length && (
                  <section className="admin-course-presets">
                    <div className="admin-course-presets-heading">
                      <div>
                        <strong>Approved tools for this course</strong>
                        <small>
                          Assigned tools are available to instructors course-wide and for individual quizzes.
                        </small>
                      </div>
                      <span>
                        {selectedCourse.adminToolPresetIds?.length || 0} of {overview.toolPresets.length} assigned
                      </span>
                    </div>
                    <div className="admin-course-preset-list">
                      {overview.toolPresets.map((preset) => {
                        const assigned = selectedCourse.adminToolPresetIds?.includes(preset.id) === true;
                        return (
                          <label className={clsx("admin-course-preset-option", assigned && "assigned")} key={preset.id}>
                            <input
                              type="checkbox"
                              checked={assigned}
                              disabled={isBusy(`assign-preset:${preset.id}`)}
                              onChange={(event) =>
                                void mutate(
                                  `assign-preset:${preset.id}`,
                                  `/api/admin/tool-presets/${encodeURIComponent(preset.id)}/courses/${encodeURIComponent(selectedCourse.id)}`,
                                  { method: "PUT", body: JSON.stringify({ assigned: event.target.checked }) },
                                  event.target.checked
                                    ? `${preset.name} is now available in this course.`
                                    : `${preset.name} was removed from this course.`
                                )
                              }
                            />
                            <span className="admin-course-preset-icon">
                              <Calculator size={16} />
                            </span>
                            <span className="admin-course-preset-copy">
                              <strong>{preset.name}</strong>
                              <small>{preset.tool.url}</small>
                            </span>
                            <span className={clsx("admin-assignment-state", assigned && "assigned")}>
                              {assigned ? "Assigned" : "Available"}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                )}
                <div className="admin-assessment-heading">
                  <div>
                    <h3>Assessments</h3>
                  </div>
                  <span>
                    {selectedCourse.enabledAssessmentCount} active · {selectedCourse.assessmentCount} total
                  </span>
                </div>
                <div className="admin-assessment-list">
                  {(selectedCourse.assessments || []).map((assessment) => {
                    const route = `/api/admin/courses/${encodeURIComponent(selectedCourse.id)}/assessments/${encodeURIComponent(assessment.id)}`;
                    const secretKey = `assessment:${assessment.id}`;
                    return (
                      <article
                        className={clsx("admin-assessment-row", assessment.sebRequired && "enabled")}
                        key={assessment.id}
                      >
                        <div className="admin-assessment-main">
                          <span className="assessment-icon" aria-hidden="true">
                            <BookOpen size={16} />
                          </span>
                          <div>
                            <strong>{assessment.title}</strong>
                            <small>
                              {assessment.contentType === "NEW_QUIZ" ? "New Quiz" : "Classic Quiz"} ·{" "}
                              {assessment.published ? "Published" : "Unpublished"}
                            </small>
                          </div>
                        </div>
                        <div className="admin-assessment-actions">
                          <span className={clsx("status-pill", assessment.sebRequired ? "enabled" : "disabled")}>
                            {assessment.sebRequired ? <ShieldCheck size={13} /> : <Shield size={13} />}
                            {assessment.sebRequired ? "Requires Safe Exam Browser" : "Browser not required"}
                          </span>
                          {assessment.sebRequired ? (
                            <>
                              <button
                                className="button secondary compact"
                                type="button"
                                disabled={isBusy(secretKey)}
                                onClick={() => void revealSecrets(secretKey, `${route}/passwords/reveal`)}
                              >
                                <Eye size={15} /> Reveal passwords
                              </button>
                              <button
                                className="button secondary compact"
                                type="button"
                                disabled={isBusy(`reset:${assessment.id}`)}
                                onClick={() =>
                                  void mutate(
                                    `reset:${assessment.id}`,
                                    `${route}/reset-defaults`,
                                    { method: "POST" },
                                    "Assessment reset to the course defaults."
                                  )
                                }
                              >
                                <RefreshCw size={15} /> Reset settings
                              </button>
                              <button
                                className="button secondary compact"
                                type="button"
                                disabled={isBusy(`reset-password:${assessment.id}`)}
                                onClick={() =>
                                  window.confirm(
                                    "Reset this assessment’s exit password to the current course or managed default?"
                                  ) &&
                                  void mutate(
                                    `reset-password:${assessment.id}`,
                                    `${route}/quit-password/reset`,
                                    { method: "POST" },
                                    "Assessment exit password reset to the course default."
                                  )
                                }
                              >
                                <KeyRound size={15} /> Reset exit password
                              </button>
                              <button
                                className="button secondary compact"
                                type="button"
                                disabled={isBusy(`code:${assessment.id}`)}
                                onClick={() =>
                                  void mutate(
                                    `code:${assessment.id}`,
                                    `${route}/regenerate-code`,
                                    { method: "POST" },
                                    "Canvas access code rotated."
                                  )
                                }
                              >
                                <KeyRound size={15} /> Rotate access code
                              </button>
                              <button
                                className="button danger compact"
                                type="button"
                                disabled={isBusy(`seb:${assessment.id}`)}
                                onClick={() =>
                                  void mutate(
                                    `seb:${assessment.id}`,
                                    `${route}/seb`,
                                    { method: "PUT", body: JSON.stringify({ required: false }) },
                                    "Safe Online Exam disabled for this assessment."
                                  )
                                }
                              >
                                <Unlock size={15} /> Disable
                              </button>
                            </>
                          ) : (
                            <button
                              className="button primary compact"
                              type="button"
                              disabled={isBusy(`seb:${assessment.id}`)}
                              onClick={() =>
                                void mutate(
                                  `seb:${assessment.id}`,
                                  `${route}/seb`,
                                  { method: "PUT", body: JSON.stringify({ required: true }) },
                                  "Safe Online Exam enabled for this assessment."
                                )
                              }
                            >
                              <Lock size={15} /> Enable Safe Online Exam
                            </button>
                          )}
                        </div>
                        {assessment.sebRequired && <SecretPanel secret={revealed[secretKey]} compact />}
                      </article>
                    );
                  })}
                  {!selectedCourse.assessments?.length && (
                    <div className="empty-state">
                      <BookOpen size={28} />
                      <strong>No synced assessments</strong>
                      <span>Refresh this course to discover Classic Quizzes and New Quizzes.</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <BookOpen size={30} />
                <strong>Select a course</strong>
                <span>Choose a Canvas course to inspect its Safe Online Exam configuration.</span>
              </div>
            )}
          </div>
        </section>
      )}

      {activeSection === "institution" && (
        <section
          className="work-surface admin-settings-surface"
          id="admin-panel-institution"
          role="tabpanel"
          aria-labelledby="admin-tab-institution"
        >
          <div className="admin-page-heading">
            <div>
              <span className="section-kicker">Institution-wide settings</span>
              <h2>Approved exam tools</h2>
              <p>
                Define trusted launch URLs and resource rules once, then assign each tool to the courses that need it.
              </p>
            </div>
            <button className="button primary compact" type="button" onClick={() => setEditingPreset("new")}>
              <Plus size={15} /> New exam tool
            </button>
          </div>
          <div className="admin-settings-section-heading">
            <div className="admin-settings-icon">
              <Calculator size={18} />
            </div>
            <div>
              <strong>Exam tool library</strong>
              <small>Instructors can use assigned tools without entering domains or URL rules themselves.</small>
            </div>
            <span>{overview?.toolPresets?.length || 0} tools</span>
          </div>
          <div className="admin-preset-grid">
            {(overview?.toolPresets || []).map((preset) => (
              <article className="admin-preset-card" key={preset.id}>
                <div className="admin-preset-card-header">
                  <span className="admin-preset-icon">
                    <Calculator size={18} />
                  </span>
                  <div>
                    <strong>{preset.name}</strong>
                    <small>{preset.description || "No description"}</small>
                  </div>
                </div>
                <div className="admin-preset-url">
                  <span>Launch URL</span>
                  <code title={preset.tool.url}>{preset.tool.url}</code>
                </div>
                <footer className="admin-preset-card-footer">
                  <div className="admin-preset-rollout-status">
                    <span>
                      <BookOpen size={14} />
                      Assigned to {preset.assignedCourseCount} course{preset.assignedCourseCount === 1 ? "" : "s"}
                    </span>
                    {!!preset.pendingAssignmentCount && <small>{preset.pendingAssignmentCount} pending</small>}
                    {!!preset.failedAssignmentCount && (
                      <small className="error">{preset.failedAssignmentCount} need retry</small>
                    )}
                  </div>
                  <div className="admin-preset-actions">
                    <button className="button primary compact" type="button" onClick={() => setRolloutPreset(preset)}>
                      <BookOpen size={15} /> Assign courses
                    </button>
                    {!!preset.failedAssignmentCount && (
                      <button
                        className="button secondary compact"
                        type="button"
                        disabled={isBusy(`retry-preset:${preset.id}`)}
                        onClick={() => {
                          const key = `retry-preset:${preset.id}`;
                          startBusy(key);
                          void reconcilePreset(preset.id, true)
                            .then(() => {
                              pushToast("success", "The failed course updates were retried.");
                              return loadPresets();
                            })
                            .catch((value) =>
                              pushToast("error", errorMessage(value, "Some course updates still need attention."))
                            )
                            .finally(() => stopBusy(key));
                        }}
                      >
                        <RefreshCw size={15} /> Retry
                      </button>
                    )}
                    <button className="button secondary compact" type="button" onClick={() => setEditingPreset(preset)}>
                      <Settings size={15} /> Edit
                    </button>
                    <button
                      className="button secondary danger compact"
                      type="button"
                      disabled={isBusy(`delete-preset:${preset.id}`)}
                      onClick={() => void deletePreset(preset)}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                </footer>
              </article>
            ))}
            {!overview?.toolPresets?.length && (
              <div className="empty-state admin-settings-empty">
                <Calculator size={30} />
                <strong>No approved exam tools</strong>
                <span>Create a tool for services such as Desmos or GeoGebra, then assign it from a course.</span>
                <button className="button primary compact" type="button" onClick={() => setEditingPreset("new")}>
                  <Plus size={15} /> Create first exam tool
                </button>
              </div>
            )}
          </div>
        </section>
      )}

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

function SecretPanel({ secret, compact = false }: { secret?: RevealedSecrets; compact?: boolean }) {
  if (!secret) return null;
  return (
    <div className={clsx("admin-secret-panel", compact && "compact")}>
      <Shield size={16} />
      {secret.values.length ? (
        secret.values.map((item) => (
          <span key={item.label}>
            <small>{item.label}</small>
            <code>{item.value}</code>
            {item.source && <em>{item.source}</em>}
          </span>
        ))
      ) : (
        <span>No passwords configured.</span>
      )}
      <small className="admin-secret-expiry">
        Hidden automatically in {Math.max(0, Math.ceil((secret.expiresAt - Date.now()) / 1000))}s
      </small>
    </div>
  );
}

function AdminConnectCoursesDialog({
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
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(false), 350);
    return () => window.clearTimeout(timer);
  }, [query, termId, includeUnpublished]);

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

function AdminPresetRolloutDialog({
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

function AdminToolPresetDialog({
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

function ServiceStatusPage({ data }: { data: Record<string, any> }) {
  const commit = typeof data.sourceCommitSha === "string" ? data.sourceCommitSha : "";
  const diff = typeof data.sourceDiffSha === "string" ? data.sourceDiffSha : "";
  return (
    <main className="app-shell service-shell">
      <header className="topbar">
        <div className="topbar-title">
          <BrandMark />
          <div>
            <h1>Safe Online Exam</h1>
            <p>Canvas assessment security service</p>
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
          <h2>Safe Online Exam is running</h2>
          <p>Launch from Canvas to manage assessments or open secure exams.</p>
        </div>
        {data.enabled === true && (
          <aside className="testbed-status" aria-label="Development testbed build">
            <span className="section-kicker">Development testbed</span>
            <dl>
              <div>
                <dt>Commit</dt>
                <dd title={commit}>{commit ? commit.slice(0, 12) : "Unknown"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{data.sourceWorktreeState === "dirty" ? `working tree ${diff.slice(0, 12)}` : data.sourceRef}</dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{data.revision || "Pending"}</dd>
              </div>
              <div>
                <dt>Diagnostics</dt>
                <dd>{data.diagnostics?.detectorTracing === true ? "Detector tracing on" : "Off"}</dd>
              </div>
            </dl>
          </aside>
        )}
      </section>
    </main>
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
        pushToast("success", enabled ? "Safe Online Exam disabled." : "Safe Online Exam enabled.");
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
        window.location.assign("/lti/launch");
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
                      <span className={clsx("assessment-status", enabled && "enabled")}>
                        {enabled ? <ShieldCheck size={13} /> : <Shield size={13} />}
                        {enabled ? "Requires Safe Exam Browser" : "Browser not required"}
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
          <BrandMark />
          <div>
            <h1>Safe Online Exam</h1>
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
              The optional check confirms your Canvas connection and that Safe Online Exam can open the school setup
              file in Safe Exam Browser.
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
              <span className="status-pill enabled">Safe Exam Browser required</span>
              <SebLaunchButton
                grantUrl={quiz.configGrantUrl || quiz.configUrl}
                token={data.configGrantToken}
                label="Launch"
                handoffPurpose="student-list"
              />
            </article>
          ))}
          {quizzes.length === 0 && (
            <EmptyState
              title="No Safe Online Exam quizzes are active"
              message="Your instructor has not enabled Safe Online Exam for a quiz in this course."
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
  const [step, setStep] = useState<InstructorSetupStep>("welcome");
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [startPasswordEnabled, setStartPasswordEnabled] = useState(
    () => !!draft.startPassword || !!(draft as CourseSebDefaults & { hasStartPassword?: boolean }).hasStartPassword
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
          <BrandMark />
          <div>
            <h1>Safe Online Exam setup</h1>
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
            Create the API and LTI Developer Keys, install by Client ID at the root account, verify the account and
            course navigation placements, record the deployment ID, and add the detector script to the active Canvas
            theme.
          </p>
          <strong>Required administrator scopes</strong>
          <code>accounts, account courses, permissions, and course details</code>
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
            Connect Canvas once from course navigation. The optional setup check confirms that Safe Online Exam can open
            the school configuration on that computer.
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
              Create the Canvas API Developer Key with the complete application scope set, including the quiz
              access-code, root-account discovery, permissions, course-details, and student session-token scopes. Then
              configure the OAuth callback at <code>{data.toolUrl}/api/oauth2callback</code>.
            </li>
            <li>
              Create or refresh the LTI 1.3 Developer Key from the public LTI configuration URL, install it by Client ID
              at the root account, verify both navigation placements, and store the Canvas deployment ID in the
              deployment configuration.
            </li>
            <li>
              Open the administrator dashboard, complete its separate OAuth grant, and test course refresh, secret
              reveal, reset, code rotation, course connection, and tool rollout in a non-production course.
            </li>
            <li>
              Load the detector script through the active Canvas theme. Then have an instructor configure course
              defaults and a student complete connection, setup check, and a real Safe Online Exam launch before broader
              rollout.
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
  const [openingHandoff, setOpeningHandoff] = useState(false);
  const [error, setError] = useState("");
  const [reconnectRequired, setReconnectRequired] = useState(false);

  const launchCheck = async () => {
    if (checking) return;
    let handoffStarted = false;
    setChecking(true);
    setOpeningHandoff(false);
    setError("");
    setReconnectRequired(false);
    try {
      const result = await requestJson(readinessUrl, {
        method: "POST",
        headers: actionHeaders(authToken)
      });
      if (!result.success) {
        throw clientRequestError(
          typeof result.error_code === "string" ? result.error_code : undefined,
          undefined,
          apiErrorDetail(result.message)
        );
      }
      await onCompleted?.();
      setOpeningHandoff(true);
      queueSebLaunchHandoff(launchUrl, window.location.href, "setup-check");
      handoffStarted = true;
    } catch (launchError) {
      if ((launchError as { code?: unknown }).code === "CANVAS_SESSION_AUTHORIZATION_REQUIRED") {
        setError("Your Canvas connection needs to be renewed before this device check can run.");
        setReconnectRequired(true);
        return;
      }
      setError(errorMessage(launchError, "Canvas connection could not be verified."));
    } finally {
      if (!handoffStarted) {
        setChecking(false);
        setOpeningHandoff(false);
      }
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
          <p>This confirms your Canvas connection, then opens a short Safe Exam Browser test on this computer.</p>
          <div className="instruction-list">
            <div>
              <strong>1</strong>
              <span>
                If your computer asks for a certificate password, enter it and select <b>Always Allow</b>.
              </span>
            </div>
            <div>
              <strong>2</strong>
              <span>When your browser asks, select Open Safe Exam Browser.</span>
            </div>
            <div>
              <strong>3</strong>
              <span>Keep the check open until every item has finished.</span>
            </div>
            <div>
              <strong>4</strong>
              <span>Wait for the check page to say Safe Online Exam is ready, then quit Safe Exam Browser.</span>
            </div>
          </div>
        </div>
        <footer className="dialog-actions">
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="button" disabled={checking} onClick={() => void launchCheck()}>
            <PlayCircle size={16} />
            {checking
              ? openingHandoff
                ? "Opening Safe Exam Browser…"
                : "Checking Canvas…"
              : "Launch Safe Exam Browser check"}
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
          hasDefaultStartPassword={
            !!(courseDefaults as CourseSebDefaults & { hasStartPassword?: boolean }).hasStartPassword
          }
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

function PasswordRequirements({
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

function passwordValidationMessage(
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

function coursePasswordValidationMessage(
  draft: CourseSebDefaults,
  startPasswordEnabled: boolean,
  requireExitPassword = false
): string | null {
  const hasSavedStartPassword = (draft as CourseSebDefaults & { hasStartPassword?: boolean }).hasStartPassword === true;
  const hasSavedExitPassword =
    (draft as CourseSebDefaults & { hasQuitPassword?: boolean; hasEffectiveQuitPassword?: boolean })
      .hasEffectiveQuitPassword === true ||
    (draft as CourseSebDefaults & { hasQuitPassword?: boolean }).hasQuitPassword === true;
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useDefaultsDraft(defaults);
  const [startPasswordEnabled, setStartPasswordEnabled] = useState(
    () => !!draft.startPassword || !!(draft as CourseSebDefaults & { hasStartPassword?: boolean }).hasStartPassword
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

function DefaultsEditor({
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
  const hasSavedStartPassword = (draft as CourseSebDefaults & { hasStartPassword?: boolean }).hasStartPassword === true;
  const hasSavedExitPassword =
    (draft as CourseSebDefaults & { hasEffectiveQuitPassword?: boolean }).hasEffectiveQuitPassword === true ||
    (draft as CourseSebDefaults & { hasQuitPassword?: boolean }).hasQuitPassword === true;
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

function SettingsSections({
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

function UrlRuleEditor({
  rules,
  onChange,
  disabled = false,
  showValidationErrors = false
}: {
  rules: SebUrlRule[];
  onChange: (rules: SebUrlRule[]) => void;
  disabled?: boolean;
  showValidationErrors?: boolean;
}) {
  const update = (id: string, patch: Partial<SebUrlRule>) =>
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  return (
    <div className="rule-list">
      {rules.map((rule) => {
        const validationError = urlRuleValidationMessage(rule, showValidationErrors);
        return (
          <div className="rule-row" key={rule.id}>
            <select
              value={rule.match}
              disabled={disabled}
              onChange={(event) => update(rule.id, { match: event.target.value as SebUrlRuleMatch })}
            >
              <option value="domain">Any URL on domain</option>
              <option value="exact">Exact URL</option>
            </select>
            <div className="rule-value-field">
              <input
                value={rule.value}
                disabled={disabled}
                aria-invalid={!!validationError}
                onChange={(event) => update(rule.id, { value: event.target.value })}
                placeholder={rule.match === "exact" ? "https://example.edu/resource" : "example.edu"}
              />
              {validationError && <small className="field-error">{validationError}</small>}
            </div>
            <button
              className="icon-button"
              type="button"
              disabled={disabled}
              onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))}
              title="Remove URL"
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      {rules.length === 0 && <p className="empty-line">No extra URLs configured.</p>}
    </div>
  );
}

function ToolEditor({
  tools,
  onChange,
  disabled = false,
  showValidationErrors = false,
  copyableToolIds,
  onCopyTool
}: {
  tools: ExternalToolConfig[];
  onChange: (tools: ExternalToolConfig[]) => void;
  disabled?: boolean;
  showValidationErrors?: boolean;
  copyableToolIds?: ReadonlySet<string>;
  onCopyTool?: (tool: ExternalToolConfig) => void;
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
  const addYoutubeVideo = () => {
    const tool = newYoutubeVideoTool();
    onChange([...tools, tool]);
    setExpandedToolIds((current) => [...current, tool.id]);
  };

  return (
    <div className="tool-list">
      <div className="tool-list-intro">
        <p>
          Add the page students should open, then list only the extra pages or files that tool needs in Safe Exam
          Browser.
        </p>
        <div className="tool-list-actions">
          <button className="button secondary small" type="button" disabled={disabled} onClick={addTool}>
            <Plus size={14} /> Add tool
          </button>
          <button className="button secondary small" type="button" disabled={disabled} onClick={addYoutubeVideo}>
            <PlayCircle size={14} /> Add YouTube video
          </button>
        </div>
      </div>
      {tools.map((tool) => {
        const expanded = expandedToolIds.includes(tool.id);
        const definitionLocked = disabled || tool.managedByAdmin === true;
        const detailId = `tool-details-${tool.id}`;
        const youtubeVideo = isYouTubeVideoDefinition(tool);
        const startUrlError = youtubeVideo
          ? youtubeVideoValidationMessage(tool.url, showValidationErrors)
          : toolStartUrlValidationMessage(tool.url, showValidationErrors);
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
                <span className="tool-icon">{youtubeVideo ? <PlayCircle size={16} /> : <Calculator size={16} />}</span>
                <span>
                  <strong>{tool.label || "New custom tool"}</strong>
                  <small>{tool.enabled ? "Enabled by default" : "Disabled by default"}</small>
                </span>
              </label>
              <div className="tool-card-summary-actions">
                <span
                  className={clsx("tool-badge", tool.managedByAdmin ? "school" : tool.preset ? "preset" : "custom")}
                >
                  {tool.managedByAdmin
                    ? "School preset"
                    : youtubeVideo
                      ? "Video"
                      : tool.preset
                        ? "Preloaded"
                        : "Custom"}
                </span>
                <small className="tool-access-summary">{toolAccessSummary(tool)}</small>
                <button
                  className="tool-expand-button"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailId}
                  onClick={() => toggleExpanded(tool.id)}
                >
                  {expanded ? "Close" : tool.managedByAdmin ? "View" : "Edit"} <ChevronDown size={16} />
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
                      disabled={definitionLocked}
                      onChange={(event) => update(tool.id, { label: event.target.value })}
                      placeholder="Tool name"
                    />
                  </label>
                  <label>
                    {youtubeVideo ? "YouTube video link" : "Start page"}
                    <input
                      value={tool.url}
                      disabled={definitionLocked}
                      aria-invalid={!!startUrlError}
                      onChange={(event) => update(tool.id, { url: event.target.value })}
                      placeholder={youtubeVideo ? "Paste a YouTube link" : "https://example.edu/tool"}
                    />
                    <small>
                      {youtubeVideo
                        ? "Paste a watch, share, Shorts, or embed link. Students can play this video, but cannot sign in or browse YouTube."
                        : "This is the page students open. It is allowed exactly as entered."}
                    </small>
                    {startUrlError && <small className="field-error">{startUrlError}</small>}
                  </label>
                </div>

                {youtubeVideo ? (
                  <section className="tool-access-list youtube-video-policy">
                    <div>
                      <strong>Video-only access</strong>
                      <small>
                        The secure browser permits only the embedded player, its video stream, and its thumbnails.
                      </small>
                    </div>
                    <p className="tool-launch-url">
                      <span>Video player</span>
                      <code>{normalizeYouTubeVideoUrl(tool.url) || "Paste a valid YouTube video link"}</code>
                    </p>
                    <p className="tool-blocked-note">
                      Private, age-restricted, or sign-in-required videos will not work during an exam.
                    </p>
                  </section>
                ) : (
                  <section className="tool-access-list">
                    <div className="tool-access-heading">
                      <div>
                        <strong>Extra pages students can use</strong>
                        <small>Add a page, file, or website only when this tool needs it after opening.</small>
                      </div>
                      <button
                        className="button secondary small"
                        type="button"
                        disabled={definitionLocked}
                        onClick={() =>
                          update(tool.id, {
                            allowedRules: [...(tool.allowedRules || []), newToolAccessRule()]
                          })
                        }
                      >
                        <Plus size={14} /> Add location
                      </button>
                    </div>
                    <p className="tool-launch-url">
                      <span>Start page</span>
                      <code>{tool.url || "Add a secure https:// address"}</code>
                    </p>
                    {(tool.allowedRules || []).map((rule) => (
                      <ToolAccessRuleEditor
                        disabled={definitionLocked}
                        key={rule.id}
                        rule={rule}
                        startUrl={tool.url}
                        showValidationErrors={showValidationErrors}
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
                      {tool.managedByAdmin
                        ? "This definition is managed by your Canvas administrator. You can enable or disable it for the course."
                        : "Anything not listed here is blocked, including unrelated pages and other websites."}
                    </p>
                  </section>
                )}

                {!tool.managedByAdmin && (
                  <footer className="tool-card-actions">
                    {onCopyTool && (
                      <button
                        className="button secondary small"
                        disabled={disabled || !copyableToolIds?.has(tool.id)}
                        type="button"
                        title={
                          copyableToolIds?.has(tool.id)
                            ? "Duplicate this tool in other instructor courses"
                            : "Save course defaults before duplicating a new or edited tool"
                        }
                        onClick={() => onCopyTool(tool)}
                      >
                        <Copy size={14} /> Duplicate to courses
                      </button>
                    )}
                    <button
                      className="button danger small"
                      disabled={disabled}
                      type="button"
                      onClick={() => onChange(tools.filter((entry) => entry.id !== tool.id))}
                    >
                      <Trash2 size={14} /> Remove tool
                    </button>
                  </footer>
                )}
              </div>
            )}
          </article>
        );
      })}
      {tools.length === 0 && <p className="empty-line">No tools configured.</p>}
    </div>
  );
}

function CourseToolCopyDialog({
  courseId,
  authToken,
  tool,
  onClose
}: {
  courseId: string;
  authToken?: string;
  tool: ExternalToolConfig;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEscapeToClose(onClose);
  useDialogInitialFocus(closeButtonRef);
  const [courses, setCourses] = useState<CourseToolCopyCourse[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CourseToolCopyResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCourses() {
      setLoading(true);
      setError(null);
      try {
        const body = await requestJson(
          `/api/quizzes/course/${encodeURIComponent(courseId)}/exam-tools/${encodeURIComponent(tool.id)}/copy-targets`,
          { headers: actionHeaders(authToken) }
        );
        if (redirectForAuth(body) || cancelled) return;
        if (!body.success || !Array.isArray(body.courses)) {
          setError(apiMessage(body, "Instructor courses could not be loaded."));
          return;
        }
        setCourses(
          body.courses.flatMap((course: unknown) => {
            if (!course || typeof course !== "object") return [];
            const candidate = course as Record<string, unknown>;
            return typeof candidate.courseId === "string" && typeof candidate.name === "string"
              ? [
                  {
                    courseId: candidate.courseId,
                    name: candidate.name,
                    courseCode: typeof candidate.courseCode === "string" ? candidate.courseCode : null
                  }
                ]
              : [];
          })
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(errorMessage(loadError, "Instructor courses could not be loaded."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadCourses();
    return () => {
      cancelled = true;
    };
  }, [authToken, courseId, tool.id]);

  const allSelected = courses.length > 0 && selectedCourseIds.size === courses.length;
  const selectedCount = selectedCourseIds.size;
  const toggleCourse = (targetCourseId: string) => {
    setSelectedCourseIds((current) => {
      const next = new Set(current);
      if (next.has(targetCourseId)) {
        next.delete(targetCourseId);
      } else {
        next.add(targetCourseId);
      }
      return next;
    });
  };
  const toggleAllCourses = () => {
    setSelectedCourseIds(allSelected ? new Set() : new Set(courses.map((course) => course.courseId)));
  };

  async function copy() {
    setCopying(true);
    setError(null);
    try {
      const body = await requestJson(
        `/api/quizzes/course/${encodeURIComponent(courseId)}/exam-tools/${encodeURIComponent(tool.id)}/copy`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...actionHeaders(authToken) },
          body: JSON.stringify({ courseIds: Array.from(selectedCourseIds) })
        }
      );
      if (redirectForAuth(body)) return;
      if (!Array.isArray(body.copied) || !Array.isArray(body.alreadyPresent) || !Array.isArray(body.failed)) {
        setError(apiMessage(body, "This exam tool could not be copied."));
        return;
      }
      setResult({
        copied: copyResultCourses(body.copied),
        alreadyPresent: copyResultCourses(body.alreadyPresent),
        failed: copyResultCourses(body.failed).map((course, index) => {
          const raw = body.failed[index];
          return {
            ...course,
            errorCode: raw && typeof raw === "object" && typeof raw.errorCode === "string" ? raw.errorCode : undefined
          };
        })
      });
    } catch (copyError) {
      setError(errorMessage(copyError, "This exam tool could not be copied."));
    } finally {
      setCopying(false);
    }
  }

  const copiedCount = result?.copied.length || 0;
  const existingCount = result?.alreadyPresent.length || 0;
  const failedCount = result?.failed.length || 0;
  return (
    <div className="dialog-backdrop course-tool-copy-backdrop" role="presentation">
      <section
        className="dialog course-tool-copy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-tool-title"
      >
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Duplicate exam tool</span>
            <h2 id="copy-tool-title">Copy {tool.label || "exam tool"}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            title="Close duplicate exam tool"
            aria-label="Close duplicate exam tool"
          >
            <X size={17} />
          </button>
        </header>
        {result ? (
          <div className="course-copy-result" aria-live="polite">
            <p>
              {copiedCount > 0
                ? `Added to ${copiedCount} ${copiedCount === 1 ? "course" : "courses"}.`
                : "No new copies were needed."}
            </p>
            {existingCount > 0 && (
              <small>
                Already up to date in {existingCount} {existingCount === 1 ? "course" : "courses"}.
              </small>
            )}
            {failedCount > 0 && (
              <div className="notice error">
                <AlertCircle size={17} /> Could not add this tool to {failedCount}{" "}
                {failedCount === 1 ? "course" : "courses"}.
                {result.failed.some((course) => course.errorCode === "COURSE_TOOL_LIMIT")
                  ? " Remove an existing tool in those courses, then try again."
                  : " Try again in a moment."}
              </div>
            )}
          </div>
        ) : loading ? (
          <p className="empty-line" aria-live="polite">
            Loading your instructor courses…
          </p>
        ) : (
          <div className="course-copy-picker">
            <div className="course-copy-picker-header">
              <div>
                <strong>Choose destination courses</strong>
                <small>Canvas verifies your instructor access again before the tool is added.</small>
              </div>
              {courses.length > 0 && (
                <label className="course-copy-select-all">
                  <input type="checkbox" checked={allSelected} onChange={toggleAllCourses} />
                  <span>Select all</span>
                </label>
              )}
            </div>
            {courses.length > 0 ? (
              <div className="course-copy-list">
                {courses.map((course) => (
                  <label className="course-copy-option" key={course.courseId}>
                    <input
                      type="checkbox"
                      checked={selectedCourseIds.has(course.courseId)}
                      onChange={() => toggleCourse(course.courseId)}
                    />
                    <span>
                      <strong>{course.name}</strong>
                      {course.courseCode && <small>{course.courseCode}</small>}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="empty-line">Canvas did not find another active course where you are a teacher.</p>
            )}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button
              className="button primary"
              type="button"
              disabled={loading || copying || selectedCount === 0}
              onClick={() => void copy()}
            >
              <Copy size={16} />
              {copying ? "Copying…" : `Duplicate to ${selectedCount} ${selectedCount === 1 ? "course" : "courses"}`}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function copyResultCourses(value: unknown[]): CourseToolCopyCourse[] {
  return value.flatMap((course) => {
    if (!course || typeof course !== "object") return [];
    const candidate = course as Record<string, unknown>;
    return typeof candidate.courseId === "string" && typeof candidate.name === "string"
      ? [
          {
            courseId: candidate.courseId,
            name: candidate.name,
            courseCode: typeof candidate.courseCode === "string" ? candidate.courseCode : null
          }
        ]
      : [];
  });
}

function courseToolCopySignature(tool: ExternalToolConfig): string {
  const [normalized] = normalizeCourseExternalTools([tool]);
  return JSON.stringify(normalized || null);
}

function ToolAccessRuleEditor({
  rule,
  startUrl,
  showValidationErrors = false,
  onChange,
  onRemove,
  disabled
}: {
  rule: ExternalToolAccessRule;
  startUrl: string;
  showValidationErrors?: boolean;
  onChange: (patch: Partial<ExternalToolAccessRule>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const changeMatch = (match: ExternalToolAccessRule["match"]) => {
    onChange({
      match,
      ...(match === "domain" ? { broadDomainConfirmed: false } : { broadDomainConfirmed: undefined })
    });
  };

  const changeValue = (value: string) => onChange({ value });
  const addressLabel = rule.match === "domain" ? "Website address" : "Address to allow";
  const addressPlaceholder =
    rule.match === "domain"
      ? "example.edu"
      : rule.match === "path"
        ? "https://example.edu/help"
        : "https://example.edu/page";
  const validationMessage = toolAccessValidationMessage(rule, showValidationErrors);
  const addressIsValid = validationMessage === null;
  const externalHost = externalResourceHost(rule, startUrl);

  return (
    <fieldset className={clsx("tool-access-rule", rule.match === "domain" && "broad")}>
      <legend>What should students be able to open?</legend>
      <div className="tool-access-scope-options">
        <label className={clsx("tool-access-scope", rule.match === "exact" && "selected")}>
          <input
            type="radio"
            name={`tool-access-scope-${rule.id}`}
            checked={rule.match === "exact"}
            disabled={disabled}
            onChange={() => changeMatch("exact")}
          />
          <span>
            <strong>This one page or file</strong>
            <small>One specific link</small>
          </span>
        </label>
        <label className={clsx("tool-access-scope", rule.match === "path" && "selected")}>
          <input
            type="radio"
            name={`tool-access-scope-${rule.id}`}
            checked={rule.match === "path"}
            disabled={disabled}
            onChange={() => changeMatch("path")}
          />
          <span>
            <strong>This address and related links</strong>
            <small>Anything under one web address</small>
          </span>
        </label>
        <label className={clsx("tool-access-scope", rule.match === "domain" && "selected", "broad")}>
          <input
            type="radio"
            name={`tool-access-scope-${rule.id}`}
            checked={rule.match === "domain"}
            disabled={disabled}
            onChange={() => changeMatch("domain")}
          />
          <span>
            <strong>This whole website</strong>
            <small>Use only when one link is not enough</small>
          </span>
        </label>
      </div>
      <div className="tool-access-address">
        <label>
          {addressLabel}
          <input
            value={displayToolAccessValue(rule)}
            disabled={disabled}
            aria-invalid={!addressIsValid}
            onChange={(event) => changeValue(event.target.value)}
            placeholder={addressPlaceholder}
          />
        </label>
        {!disabled && (
          <button
            className="icon-button"
            type="button"
            onClick={onRemove}
            title="Remove this location"
            aria-label="Remove this location"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {!!rule.value && !addressIsValid && <p className="field-error">{validationMessage}</p>}
      <p className="tool-access-preview">{toolAccessPreview(rule)}</p>
      {externalHost && (
        <p className="tool-access-external-note" role="status">
          This is hosted by <strong>{externalHost}</strong>, not the start page’s website. Students will be able to open
          it during the exam.
        </p>
      )}
      {rule.match === "domain" && (
        <label className="tool-access-confirmation">
          <input
            type="checkbox"
            checked={rule.broadDomainConfirmed === true}
            disabled={disabled}
            onChange={(event) => onChange({ broadDomainConfirmed: event.target.checked })}
          />
          <span>I understand this lets students open any HTTPS page on this website during the exam.</span>
        </label>
      )}
    </fieldset>
  );
}

function displayToolAccessValue(rule: ExternalToolAccessRule): string {
  return rule.match === "path" ? rule.value.replace(/\/\*$/u, "") : rule.value;
}

function urlRuleValidationMessage(rule: SebUrlRule, required = false): string | null {
  const value = rule.value.trim();
  if (!value) {
    return required ? "Enter the website or exact page students may open." : null;
  }
  if (rule.match === "regex" || value.includes("*")) {
    return "Use a concrete website or exact HTTPS page without wildcards or regular expressions.";
  }
  if (rule.match === "exact") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
        return "Use a complete HTTPS address without a username, password, or port.";
      }
    } catch {
      return "Enter a complete HTTPS address, such as https://example.edu/resource.";
    }
  }
  if (rule.match === "domain" && (value.includes("://") || value.includes("/") || value.includes(":"))) {
    return "Enter only a concrete hostname, such as example.edu.";
  }
  return normalizeUrlRules([rule]).length === 1
    ? null
    : rule.match === "domain"
      ? "Enter a concrete public hostname, such as example.edu."
      : "Enter a complete HTTPS address, such as https://example.edu/resource.";
}

function urlRulesValidationMessage(rules: SebUrlRule[]): string | null {
  for (const [index, rule] of rules.entries()) {
    const error = urlRuleValidationMessage(rule, true);
    if (error) return `Allowed website ${index + 1}: ${error}`;
  }
  return null;
}

function toolStartUrlValidationMessage(value: string, required = false): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? "Enter the HTTPS page students should open." : null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return "Use a complete HTTPS address without a username, password, or port.";
    }
    if (isYouTubeUrl(value)) {
      return "Use “Add YouTube video” for a video instead of adding a general YouTube page.";
    }
    return null;
  } catch {
    return "Enter a complete HTTPS address, such as https://example.edu/tool.";
  }
}

function isYouTubeVideoDefinition(tool: Pick<ExternalToolConfig, "preset">): boolean {
  return tool.preset === YOUTUBE_VIDEO_TOOL_PRESET;
}

function youtubeVideoValidationMessage(value: string, required = false): string | null {
  if (!value.trim()) {
    return required ? "Paste a YouTube watch, share, Shorts, or embed link." : null;
  }
  return normalizeYouTubeVideoUrl(value)
    ? null
    : "Use one YouTube video link, such as https://youtu.be/VIDEO_ID or https://www.youtube.com/watch?v=VIDEO_ID.";
}

function toolAccessValidationMessage(rule: ExternalToolAccessRule, required = false): string | null {
  const value = displayToolAccessValue(rule).trim();
  if (!value) {
    return required ? "Enter the page, file, or website students may use." : null;
  }
  try {
    const candidate = rule.match === "domain" && !value.includes("://") ? `https://${value}` : value;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return "Use a complete HTTPS address without a username, password, or port.";
    }
    if (isYouTubeUrl(value)) {
      return "Use “Add YouTube video” for a video instead of adding it as an extra location.";
    }
    if (rule.match === "path" && (parsed.pathname === "/" || parsed.search || parsed.hash)) {
      return "Choose a specific address below the website, such as https://example.edu/help.";
    }
    if (rule.match === "domain" && (parsed.pathname !== "/" || parsed.search || parsed.hash)) {
      return "For a whole website, enter only its address, such as example.edu.";
    }
    if (rule.match === "domain" && rule.broadDomainConfirmed !== true) {
      return "Confirm that students may use this whole website during the exam.";
    }
    return null;
  } catch {
    return "Enter a complete HTTPS address, such as https://example.edu/page.";
  }
}

function externalToolsValidationMessage(tools: ExternalToolConfig[]): string | null {
  for (const tool of tools) {
    const label = tool.label.trim() || "This tool";
    const startError = isYouTubeVideoDefinition(tool)
      ? youtubeVideoValidationMessage(tool.url, true)
      : toolStartUrlValidationMessage(tool.url, true);
    if (startError) {
      return `${label}: ${startError}`;
    }
    for (const rule of tool.allowedRules || []) {
      const accessError = toolAccessValidationMessage(rule, true);
      if (accessError) {
        return `${label}: ${accessError}`;
      }
    }
  }
  return null;
}

function toolAccessPreview(rule: ExternalToolAccessRule): string {
  const value = displayToolAccessValue(rule).trim() || "the address above";
  if (rule.match === "exact") {
    return `Students can open only ${value}.`;
  }
  if (rule.match === "path") {
    return `Students can open ${value} and links below that address.`;
  }
  return `Students can open any HTTPS page on ${value}.`;
}

function externalResourceHost(rule: ExternalToolAccessRule, startUrl: string): string | null {
  const resourceValue = displayToolAccessValue(rule).trim();
  if (!resourceValue || !startUrl.trim()) {
    return null;
  }
  try {
    const startHost = new URL(startUrl).hostname.replace(/^www\./u, "").toLowerCase();
    const resourceUrl =
      rule.match === "domain" && !resourceValue.includes("://") ? `https://${resourceValue}` : resourceValue;
    const resourceHost = new URL(resourceUrl).hostname.replace(/^www\./u, "").toLowerCase();
    return resourceHost && resourceHost !== startHost ? resourceHost : null;
  } catch {
    return null;
  }
}

function toolAccessSummary(tool: ExternalToolConfig): string {
  if (isYouTubeVideoTool(tool)) {
    return "One public video";
  }
  const count = tool.allowedRules?.length || 0;
  return count === 0 ? "Start page only" : `${count} additional location${count === 1 ? "" : "s"}`;
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
            : "This quiz has its own tool selection. Only checked tools will be included in its Safe Online Exam configuration."}
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
  const authUrl = safeSameOriginNavigationTarget(data.authUrl, "/api/oauth2authorize");
  const onConnected = useCallback(() => {
    window.location.replace("/lti/launch?connected=1");
  }, []);

  return (
    <MessagePage
      icon={<KeyRound />}
      title="Connect Canvas"
      message={
        data.message || "Authorize Canvas access so this tool can read quizzes and set access codes for this course."
      }
      action={
        <CanvasAuthorizationAction
          authUrl={authUrl}
          windowName="seb_canvas_authorization"
          connectedMessageType={CANVAS_OAUTH_CONNECTED_MESSAGE}
          onConnected={onConnected}
        />
      }
    />
  );
}

const CANVAS_OAUTH_CONNECTED_MESSAGE = "seb-canvas-oauth-connected";
const STUDENT_SESSION_CONNECTED_MESSAGE = "seb-canvas-session-connected";
const OAUTH_POPUP_ACKNOWLEDGEMENT_SUFFIX = ":acknowledged";
const OAUTH_POPUP_ACKNOWLEDGEMENT_TIMEOUT_MS = 1000;
const OAUTH_POPUP_NAVIGATION_DELAY_MS = 100;

function oauthPopupAcknowledgementType(messageType: string): string {
  return `${messageType}${OAUTH_POPUP_ACKNOWLEDGEMENT_SUFFIX}`;
}

function StudentSessionAuthorizationPage({ data }: { data: Record<string, any> }) {
  const authUrl = safeSameOriginNavigationTarget(data.authUrl, "/api/student-session-authorize");
  const onConnected = useCallback((payload: Record<string, unknown>) => {
    window.location.assign(safeSameOriginNavigationTarget(payload.returnUrl, "/lti/launch?connected=1"));
  }, []);

  return (
    <MessagePage
      icon={<KeyRound />}
      title="Connect Canvas"
      message={
        (data.onboarding as OnboardingContext | undefined)?.resumeAssessment
          ? "Connect Canvas once, then return to the Safe Online Exam quiz you selected."
          : "Connect Canvas once to open Safe Online Exam quizzes without signing in again."
      }
      action={
        <CanvasAuthorizationAction
          authUrl={authUrl}
          windowName="seb_canvas_session_authorization"
          connectedMessageType={STUDENT_SESSION_CONNECTED_MESSAGE}
          onConnected={onConnected}
        />
      }
    />
  );
}

function CanvasAuthorizationAction({
  authUrl,
  windowName,
  connectedMessageType,
  onConnected
}: {
  authUrl: string;
  windowName: string;
  connectedMessageType: string;
  onConnected: (payload: Record<string, unknown>) => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popupRef.current ||
        !event.data ||
        typeof event.data !== "object" ||
        (event.data as { type?: unknown }).type !== connectedMessageType
      ) {
        return;
      }
      const payload = event.data as Record<string, unknown>;
      const popup = popupRef.current;
      popupRef.current = null;
      setConnecting(false);
      popup?.postMessage({ type: oauthPopupAcknowledgementType(connectedMessageType) }, window.location.origin);
      window.setTimeout(() => onConnected(payload), OAUTH_POPUP_NAVIGATION_DELAY_MS);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [connectedMessageType, onConnected]);

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
    const popup = window.open(authUrl, windowName, "popup,width=560,height=720");
    if (!popup) {
      window.location.assign(authUrl);
      return;
    }
    popupRef.current = popup;
    popup.focus();
    setConnecting(true);
  };

  return (
    <div className="canvas-action-stack">
      <button className="button primary" type="button" disabled={connecting} onClick={connect}>
        <KeyRound size={16} /> {connecting ? "Connecting…" : "Connect Canvas"}
      </button>
      {connectionError && (
        <span className="field-error" role="alert">
          {connectionError}
        </span>
      )}
    </div>
  );
}

function beginOAuthPopupCompletion({
  messageType,
  payload,
  onFallback
}: {
  messageType: string;
  payload: Record<string, unknown>;
  onFallback: () => void;
}): () => void {
  const opener = window.opener;
  if (!opener || opener.closed) {
    onFallback();
    return () => undefined;
  }

  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      event.origin !== window.location.origin ||
      event.source !== opener ||
      !event.data ||
      typeof event.data !== "object" ||
      (event.data as { type?: unknown }).type !== oauthPopupAcknowledgementType(messageType)
    ) {
      return;
    }
    cleanup();
    window.close();
  };
  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    window.clearTimeout(fallbackTimer);
  };

  window.addEventListener("message", onMessage);
  opener.postMessage({ type: messageType, ...payload }, window.location.origin);
  const fallbackTimer = window.setTimeout(() => {
    cleanup();
    onFallback();
  }, OAUTH_POPUP_ACKNOWLEDGEMENT_TIMEOUT_MS);
  return cleanup;
}

function StudentSessionConnectedPage({ data }: { data: Record<string, any> }) {
  const returnUrl = safeSameOriginNavigationTarget(data.returnUrl, "/lti/launch");

  useEffect(() => {
    return beginOAuthPopupCompletion({
      messageType: STUDENT_SESSION_CONNECTED_MESSAGE,
      payload: { returnUrl },
      onFallback: () => window.location.replace(returnUrl)
    });
  }, [returnUrl]);

  return <MessagePage icon={<Check />} title="Canvas Connected" message="Returning to Safe Online Exam." />;
}

function CanvasOAuthConnectedPage({ data }: { data: Record<string, any> }) {
  const canvasReturnUrl = typeof data.canvasReturnUrl === "string" ? data.canvasReturnUrl : "";
  const [showFallback, setShowFallback] = useState(() => !window.opener || window.opener.closed);

  useEffect(() => {
    return beginOAuthPopupCompletion({
      messageType: CANVAS_OAUTH_CONNECTED_MESSAGE,
      payload: {},
      onFallback: () => setShowFallback(true)
    });
  }, []);

  if (!showFallback) {
    return <MessagePage icon={<Check />} title="Canvas Connected" message="Returning to Safe Online Exam." />;
  }

  return (
    <MessagePage
      icon={<Check />}
      title="Canvas Connected"
      message="Your Canvas connection is ready. Return to Canvas, then reopen Safe Online Exam from course or account navigation."
      action={
        canvasReturnUrl ? (
          <a className="button primary" href={canvasReturnUrl} target="_top" rel="noreferrer">
            <ArrowLeft size={16} /> Return to Canvas
          </a>
        ) : undefined
      }
    />
  );
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
            : "Open this assessment in Safe Exam Browser when you are ready. If prompted, allow Safe Exam Browser to open."
        }
        action={
          <>
            <button className="button secondary" type="button" onClick={() => window.history.back()}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="button secondary" type="button" onClick={() => setShowSetupCheck(true)}>
              <ShieldCheck size={16} /> Setup check
            </button>
            <SebLaunchButton
              grantUrl={data.configGrantUrl}
              token={data.configGrantToken}
              label="Open Safe Exam Browser"
            />
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

function OAuthErrorPage({ data: _data }: { data: Record<string, any> }) {
  return (
    <MessagePage
      icon={<AlertCircle />}
      title="Canvas connection was not completed"
      message="Canvas did not authorize this connection. Return to the course tool and select Connect Canvas to try again."
      action={
        <a className="button primary" href="/lti/launch">
          <ArrowLeft size={16} /> Return to Canvas tool
        </a>
      }
    />
  );
}

function SebLaunchButton({
  grantUrl,
  token,
  label,
  handoffPurpose = "assessment"
}: {
  grantUrl?: string;
  token?: string;
  label: string;
  handoffPurpose?: SebLaunchHandoffPurpose;
}) {
  const [launching, setLaunching] = useState(false);
  const [openingHandoff, setOpeningHandoff] = useState(false);
  const [error, setError] = useState("");

  const launch = async () => {
    if (!grantUrl || !token || launching) {
      setError("Reopen Safe Online Exam from Canvas and try again.");
      return;
    }
    let handoffStarted = false;
    setLaunching(true);
    setOpeningHandoff(false);
    setError("");
    try {
      const payload = await requestJson(grantUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "x-auth-token": token }
      });
      if (typeof payload.sebLaunchUrl !== "string" || !/^sebs?:\/\//iu.test(payload.sebLaunchUrl)) {
        throw clientRequestError(
          typeof payload.error_code === "string" ? payload.error_code : undefined,
          undefined,
          apiErrorDetail(payload.message)
        );
      }
      setOpeningHandoff(true);
      queueSebLaunchHandoff(payload.sebLaunchUrl, window.location.href, handoffPurpose);
      handoffStarted = true;
    } catch (launchError) {
      const recovery = onboardingRecovery(launchError, "student");
      setError(
        recovery?.message ||
          errorMessage(launchError, "Safe Online Exam could not prepare this quiz. Reopen it from Canvas and try again")
      );
    } finally {
      if (!handoffStarted) {
        setLaunching(false);
        setOpeningHandoff(false);
      }
    }
  };

  return (
    <span>
      <button className="button primary" type="button" disabled={launching} onClick={() => void launch()}>
        <ExternalLink size={16} />
        {launching ? (openingHandoff ? "Opening Safe Exam Browser…" : "Preparing…") : label}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function queueSebLaunchHandoff(
  sebLaunchUrl: string,
  returnUrl: string,
  purpose: SebLaunchHandoffPurpose = "assessment"
): void {
  const handoffKey = window.crypto.randomUUID();
  window.sessionStorage.setItem(
    `${SEB_LAUNCH_HANDOFF_STORAGE_PREFIX}${handoffKey}`,
    JSON.stringify({ sebLaunchUrl, returnUrl, purpose })
  );
  window.location.assign(`/seb/launch-handoff?key=${encodeURIComponent(handoffKey)}`);
}

function SebLaunchingHandoffPage() {
  const handoffKey = new URLSearchParams(window.location.search).get("key");
  if (!handoffKey) {
    return <SebLaunchHandoffUnavailablePage />;
  }
  try {
    const storageKey = `${SEB_LAUNCH_HANDOFF_STORAGE_PREFIX}${handoffKey}`;
    const stored = window.sessionStorage.getItem(storageKey);
    window.sessionStorage.removeItem(storageKey);
    const launch = stored
      ? (JSON.parse(stored) as { sebLaunchUrl?: unknown; returnUrl?: unknown; purpose?: unknown })
      : null;
    if (typeof launch?.sebLaunchUrl !== "string" || !/^sebs?:\/\//iu.test(launch.sebLaunchUrl)) {
      return <SebLaunchHandoffUnavailablePage />;
    }
    return (
      <SebLaunchingPage
        data={{
          sebLaunchUrl: launch.sebLaunchUrl,
          browserReturnUrl: typeof launch.returnUrl === "string" ? launch.returnUrl : "",
          launchPurpose: isSebLaunchHandoffPurpose(launch.purpose) ? launch.purpose : "assessment"
        }}
      />
    );
  } catch {
    return <SebLaunchHandoffUnavailablePage />;
  }
}

function SebLaunchHandoffUnavailablePage() {
  return (
    <MessagePage
      icon={<AlertCircle />}
      title="Safe Exam Browser could not be prepared"
      message="Return to your course and open the assessment again."
      action={
        <button className="button primary" type="button" onClick={() => window.history.back()}>
          <ArrowLeft size={16} /> Return to course
        </button>
      }
    />
  );
}

function SebLaunchingPage({ data }: { data: Record<string, any> }) {
  const sebLaunchUrl = typeof data.sebLaunchUrl === "string" ? data.sebLaunchUrl : "";
  const returnUrl = typeof data.browserReturnUrl === "string" ? data.browserReturnUrl : "";
  const presentation = sebLaunchPresentation(data.launchPurpose);
  const { showRecovery, startLaunchRecovery } = useSebLaunchRecovery();

  useEffect(() => {
    if (!/^sebs?:\/\//iu.test(sebLaunchUrl)) return;
    startLaunchRecovery();
    window.location.assign(sebLaunchUrl);
  }, [sebLaunchUrl, startLaunchRecovery]);

  return (
    <MessagePage
      icon={<Shield />}
      title={presentation.title}
      message={presentation.message}
      action={
        <div className="seb-launch-action-stack">
          <div className="seb-launch-action-buttons">
            {sebLaunchUrl && (
              <a className="button primary" href={sebLaunchUrl} onClick={startLaunchRecovery}>
                <ExternalLink size={16} /> Open Safe Exam Browser
              </a>
            )}
            {returnUrl && (
              <a className="button secondary" href={returnUrl}>
                <ArrowLeft size={16} /> {presentation.returnLabel}
              </a>
            )}
          </div>
          <SebLaunchRecoveryNotice
            visible={showRecovery}
            placement="launch-page"
            nextStep={presentation.recoveryNextStep}
          />
        </div>
      }
    />
  );
}

function isSebLaunchHandoffPurpose(value: unknown): value is SebLaunchHandoffPurpose {
  return value === "assessment" || value === "setup-check" || value === "student-list";
}

function sebLaunchPresentation(purpose: unknown): {
  title: string;
  message: string;
  returnLabel: string;
  recoveryNextStep: string;
} {
  if (purpose === "student-list") {
    return {
      title: "Opening your quiz",
      message: "Safe Exam Browser is opening your selected quiz. If your browser asks, select Open Safe Exam Browser.",
      returnLabel: "Back to all quizzes",
      recoveryNextStep: "download it, then return to all quizzes and select Launch again."
    };
  }
  if (purpose === "setup-check") {
    return {
      title: "Opening Safe Exam Browser",
      message:
        "We’re opening your setup check in Safe Exam Browser. If your browser asks, select Open Safe Exam Browser.",
      returnLabel: "Return to setup check",
      recoveryNextStep: "download it, then return to your course and run the setup check again."
    };
  }
  if (purpose === "assessment") {
    return {
      title: "Opening Safe Exam Browser",
      message:
        "We’re opening your assessment in Safe Exam Browser. If your browser asks, select Open Safe Exam Browser.",
      returnLabel: "Back to assessment",
      recoveryNextStep: "download it, then return to this assessment and try again."
    };
  }
  return {
    title: "Opening Safe Exam Browser",
    message: "We’re opening Safe Exam Browser. If your browser asks, select Open Safe Exam Browser.",
    returnLabel: "Return to course",
    recoveryNextStep: "download it, then return to your Canvas course and reopen the assessment."
  };
}

function useSebLaunchRecovery() {
  const [showRecovery, setShowRecovery] = useState(false);
  const recoveryTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (recoveryTimeoutRef.current !== null) {
        window.clearTimeout(recoveryTimeoutRef.current);
      }
    };
  }, []);

  const startLaunchRecovery = useCallback(() => {
    if (recoveryTimeoutRef.current !== null) {
      window.clearTimeout(recoveryTimeoutRef.current);
    }
    setShowRecovery(false);
    recoveryTimeoutRef.current = window.setTimeout(() => {
      recoveryTimeoutRef.current = null;
      setShowRecovery(true);
    }, SEB_LAUNCH_RECOVERY_DELAY_MS);
  }, []);

  return { showRecovery, startLaunchRecovery };
}

function SebLaunchRecoveryNotice({
  visible,
  nextStep = "download it, then return here and try again.",
  placement = "inline"
}: {
  visible: boolean;
  nextStep?: string;
  placement?: "inline" | "dialog" | "launch-page";
}) {
  if (!visible) return null;
  return (
    <div className={clsx("seb-launch-recovery", `seb-launch-recovery--${placement}`)} role="status">
      <div className="seb-launch-recovery-copy">
        <span className="seb-launch-recovery-icon" aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <div>
          <strong>Need Safe Exam Browser?</strong>
          <p>If it did not open, {nextStep}</p>
        </div>
      </div>
      <a
        className="button secondary small seb-launch-download-link"
        href={SEB_OFFICIAL_DOWNLOAD_URL}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
      >
        <ExternalLink size={15} /> Download Safe Exam Browser
      </a>
    </div>
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
          ? "Safe Exam Browser will close this session automatically. Use the button if it stays open."
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
      message="Safe Exam Browser should close this session. Use the button again if this window remains open."
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
      label: "Safe Online Exam setup configuration opened",
      detail: data.configEncryptionEnabled
        ? "The certificate-protected setup file opened successfully."
        : "The setup file opened successfully. Certificate encryption is disabled for this environment.",
      status: "pending"
    },
    {
      id: "seb-runtime",
      label: "Safe Exam Browser detected",
      detail: "Checking the Safe Exam Browser runtime and browser identity.",
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
      detail: "Checking secure connectivity to the Safe Online Exam service.",
      status: "pending"
    },
    {
      id: "config-key",
      label: "Configuration key verified",
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
        sebDetected
          ? "Safe Exam Browser is ready for Safe Online Exam."
          : "This page is not running inside Safe Exam Browser."
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
        update("storage", "fail", "Session storage is unavailable in this secure-browser session.");
      }

      try {
        const response = await fetch("/health", { credentials: "same-origin" });
        const health = (await response.json()) as { status?: string };
        if (!response.ok || health.status !== "UP") {
          throw new Error("Health check failed.");
        }
        update("connectivity", "pass", "The Safe Online Exam service responded normally.");
      } catch {
        update("connectivity", "fail", "The Safe Online Exam service could not be reached from this session.");
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
        update("config-key", "pass", "The server verified this exact Safe Online Exam setup configuration.");
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
        <h1>{passed ? "Safe Online Exam is ready" : "Checking Safe Online Exam"}</h1>
        <p>
          {passed
            ? "This computer can open encrypted Safe Online Exam configurations and verify them with Safe Online Exam."
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

function safeSameOriginNavigationTarget(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && !url.pathname.startsWith("//")
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

async function persistStudentReadinessPromptDismissal(authToken?: string): Promise<void> {
  const body = await requestJson("/api/seb/session-readiness/dismiss", {
    method: "POST",
    headers: actionHeaders(authToken)
  });
  if (!body.success) {
    throw clientRequestError(
      typeof body.error_code === "string" ? body.error_code : undefined,
      undefined,
      apiErrorDetail(body.message)
    );
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw clientRequestError("NETWORK_ERROR", 0);
  }
  const contentType = response.headers.get("content-type") || "";
  let body: Record<string, any> = {};
  if (contentType.includes("application/json")) {
    try {
      body = (await response.json()) as Record<string, any>;
    } catch {
      body = {};
    }
  }
  if (!response.ok) {
    throw clientRequestError(
      typeof body.error_code === "string" ? body.error_code : undefined,
      response.status,
      response.status < 500 ? apiErrorDetail(body.message) : undefined
    );
  }
  return body;
}

function errorMessage(error: unknown, fallback: string): string {
  const candidate = error as ClientRequestError | undefined;
  return safeErrorMessage(candidate?.code, candidate?.status, fallback, candidate?.detail);
}

function apiMessage(body: Record<string, any>, fallback: string): string {
  return safeErrorMessage(
    typeof body.error_code === "string" ? body.error_code : undefined,
    undefined,
    fallback,
    apiErrorDetail(body.message)
  );
}

function clientRequestError(code?: string, status?: number, detail?: string): ClientRequestError {
  const error = new Error("Safe Online Exam request failed") as ClientRequestError;
  error.code = code;
  error.status = status;
  error.detail = detail;
  error.userFacing = true;
  return error;
}

function apiErrorDetail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim().slice(0, 500);
  return normalized && !/^internal server error$/iu.test(normalized) ? normalized : undefined;
}

function safeErrorMessage(
  code: string | undefined,
  status: number | undefined,
  fallback: string,
  detail?: string
): string {
  switch (code) {
    case "CANVAS_AUTHORIZATION_REQUIRED":
      return "Canvas needs to be reconnected before this can continue. Reconnect Canvas, then try again.";
    case "CANVAS_PERMISSION_DENIED":
      return "Canvas blocked this action because the integration does not have the required permission. Ask a Canvas administrator to check the Developer Key scopes.";
    case "CANVAS_SESSION_AUTHORIZATION_REQUIRED":
      return "Your Canvas connection has expired. Reconnect Canvas, then try again.";
    case "CANVAS_SESSION_READINESS_FAILED":
      return "Canvas could not confirm this connection right now. Check your connection and try again in a moment.";
    case "INVALID_SEB_CONFIG_PROOF":
    case "SEB_CONFIGURATION_UNAVAILABLE":
      return "This Safe Online Exam configuration is no longer current. Return to Canvas and reopen the quiz from the course tool.";
    case "ASSESSMENT_NOT_FOUND":
    case "ASSESSMENT_SETTING_NOT_FOUND":
      return "That assessment is no longer available. Refresh the course content, then try again.";
    case "SEB_NOT_ENABLED":
      return "Safe Online Exam is not enabled for that assessment. Enable it in the course settings, then try again.";
    case "INVALID_SEB_URL_POLICY":
    case "INVALID_SEB_DOMAIN_POLICY":
    case "INVALID_SEB_TOOL_SELECTION":
      return detail || "One or more website permissions cannot be saved. Check each highlighted URL and try again.";
    case "INVALID_SEB_TOOL_POLICY":
      return (
        detail ||
        "We could not save a tool because its start page or an extra link is not allowed. Check each highlighted URL and try again."
      );
    case "SEB_PASSWORD_POLICY_VIOLATION":
      return (
        detail ||
        "The new password does not meet every listed requirement. Review the password checklist and try again."
      );
    case "SEB_PASSWORD_REUSE":
      return (
        detail ||
        "Start and exit passwords must be different. Use the exit password only when a student needs permission to leave Safe Exam Browser."
      );
    case "SEB_QUIT_PASSWORD_REQUIRED":
      return "Set a valid course or quiz exit password before enabling Safe Online Exam.";
    case "SEB_QUIT_PASSWORD_WEAK":
      return detail || "The saved exit password no longer meets the password policy. Replace it in Course Settings.";
    case "COURSE_TOOL_LIMIT":
      return detail || "This course already has 16 exam tools. Remove one before adding another.";
    case "COURSE_TOOL_COPY_LIMIT":
      return "Choose no more than 100 courses at a time, then copy this tool in another batch.";
    case "COURSE_TOOL_COPY_TARGETS_REQUIRED":
      return "Choose at least one instructor course before duplicating this tool.";
    case "COURSE_TOOL_COPY_SOURCE_SELECTED":
      return "The current course already has this tool. Choose one or more different courses.";
    case "COURSE_TOOL_COPY_TARGET_DENIED":
      return "Canvas could no longer confirm your instructor access to one or more selected courses. Refresh the list and try again.";
    case "COURSE_TOOL_COPY_NOT_ALLOWED":
      return "School-managed exam tools cannot be duplicated from course settings.";
    case "COURSE_TOOL_NOT_FOUND":
      return "This exam tool is no longer saved in the course. Refresh the settings and try again.";
    case "COURSE_RESET_IN_PROGRESS":
      return "A Canvas administrator is resetting this course. Wait for the reset to finish, then reopen Safe Online Exam from Canvas.";
    case "COURSE_UPDATE_IN_PROGRESS":
    case "ASSESSMENT_UPDATE_IN_PROGRESS":
      return detail || "Another course update is still in progress. Wait a moment, refresh the course, and try again.";
    case "COURSE_UPDATE_VERIFY_REQUIRED":
      return detail || "The course update could not be confirmed. Refresh the course and verify its current settings.";
    case "ADMIN_COURSE_RESET_CONFIRMATION_REQUIRED":
      return "Enter the Canvas course ID exactly as shown before starting the reset.";
    case "ADMIN_COURSE_RESET_CANVAS_FAILED":
      return (
        detail ||
        "Canvas could not disable every assessment. Course records were not deleted; refresh the course and retry."
      );
    case "ADMIN_COURSE_RESET_ASSESSMENT_BUSY":
      return (
        detail ||
        "An assessment update is still in progress. Wait for it to finish, refresh the course, and retry the reset."
      );
    case "ADMIN_COURSE_RESET_VERIFY_REQUIRED":
      return (
        detail ||
        "The reset could not be confirmed. It may have completed; refresh the course and verify Canvas assessment access codes before retrying."
      );
    case "NETWORK_ERROR":
      return "We could not reach the Safe Online Exam service. Check your connection and try again.";
    default:
      break;
  }
  if (detail && status === undefined) {
    return detail;
  }
  if (status === 401 || status === 403) {
    return "Your Canvas session cannot complete this action. Reopen the tool from Canvas and try again.";
  }
  if (status === 404) {
    return "The requested item is no longer available. Refresh the page and try again.";
  }
  if (detail && status && status >= 400 && status < 500) {
    return detail;
  }
  if (status === 409 || status === 422) {
    return "This change could not be applied because the current settings need attention. Refresh the page, review the settings, and try again.";
  }
  if (status === 429) {
    return "Too many requests were made in a short time. Wait a moment, then try again.";
  }
  if (status && status >= 500) {
    return "The Safe Online Exam service could not complete that request. Try again in a moment; contact your administrator if it continues.";
  }
  return `${fallback.replace(/\.$/u, "")}. Check your connection and try again.`;
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
          message: "Your Canvas connection needs to be renewed before Safe Online Exam can open this quiz.",
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
      message:
        "This Safe Online Exam configuration is no longer current. Return to Canvas and reopen the quiz from the course tool."
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

function newYoutubeVideoTool(id = clientId("youtube-video")): ExternalToolConfig {
  return {
    id,
    label: "YouTube video",
    url: "",
    enabled: false,
    preset: YOUTUBE_VIDEO_TOOL_PRESET,
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
