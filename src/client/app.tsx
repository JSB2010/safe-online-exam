import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  Unlock,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

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
}

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
          title="Canvas Authorization Error"
          message={String(bootstrap.data.error || "Canvas did not authorize access.")}
        />
      );
    case "deep-link-select":
      return <DeepLinkSelect data={bootstrap.data} />;
    case "student":
      return (
        <MessagePage
          icon={<ExternalLink />}
          title="Canvas Launch Ready"
          message="Canvas accepted this launch. Continue to the linked assessment from Canvas."
        />
      );
    default:
      return <MessagePage icon={<Shield />} title="Safe Exam Browser" message="This service is running." />;
  }
}

function TeacherDashboard({ data }: { data: Record<string, any> }) {
  const [items] = useState<QuizView[]>(data.quizzes || []);
  const [settings, setSettings] = useState<Record<string, any>>(data.quizSebSettings || {});
  const [query, setQuery] = useState("");
  const [activeItem, setActiveItem] = useState<QuizView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.title} ${item.quizTypeDisplay || ""}`.toLowerCase().includes(normalized));
  }, [items, query]);

  async function toggleSeb(item: QuizView) {
    const enabled = !!settings[item.id]?.sebRequired;
    setBusyId(item.id);
    setNotice(null);
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(data.courseId)}/${encodeURIComponent(item.id)}/seb/${enabled ? "disable" : "enable"}`,
      { method: "POST", headers: actionHeaders(data.authToken) }
    );
    const body = await response.json();
    if (redirectForAuth(body)) return;
    if (!body.success) {
      setNotice(body.message || "The SEB setting could not be updated.");
    } else {
      setSettings((current) => ({
        ...current,
        [item.id]: body.setting || { ...current[item.id], sebRequired: !enabled }
      }));
      setNotice(body.message || "SEB setting updated.");
    }
    setBusyId(null);
  }

  async function refresh() {
    setBusyId("refresh");
    const response = await fetch(`/api/quizzes/course/${encodeURIComponent(data.courseId)}/refresh`, {
      method: "POST",
      headers: actionHeaders(data.authToken)
    });
    const body = await response.json();
    if (redirectForAuth(body)) return;
    if (body.success) {
      window.location.reload();
    } else {
      setNotice(body.message || "Could not refresh Canvas content.");
    }
    setBusyId(null);
  }

  async function regenerate(item: QuizView) {
    setBusyId(item.id);
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(data.courseId)}/${encodeURIComponent(item.id)}/seb/regenerate-code`,
      { method: "POST", headers: actionHeaders(data.authToken) }
    );
    const body = await response.json();
    if (redirectForAuth(body)) return;
    setNotice(body.message || (body.success ? "Access code regenerated." : "Access code regeneration failed."));
    setBusyId(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Canvas LTI</p>
          <h1>Safe Exam Browser Manager</h1>
          <p className="subtle">{data.courseName || `Course ${data.courseId}`}</p>
        </div>
        <div className="toolbar">
          <button
            className="icon-button"
            onClick={refresh}
            disabled={busyId === "refresh"}
            title="Refresh Canvas content"
          >
            <RefreshCw size={18} />
          </button>
          <a
            className="button secondary"
            href={`/api/oauth2reauthorize?course_id=${encodeURIComponent(data.courseId)}&user_id=${encodeURIComponent(data.userId)}&redirect_url=${encodeURIComponent(window.location.href)}`}
          >
            <KeyRound size={16} /> Reauthorize Canvas
          </a>
        </div>
      </header>

      <section className="summary-grid">
        <Metric label="Content items" value={items.length} />
        <Metric
          label="SEB enabled"
          value={Object.values(settings).filter((setting: any) => setting?.sebRequired).length}
        />
        <Metric label="Canvas access" value={data.hasApiAuthorization ? "Ready" : "Needs auth"} />
      </section>

      {notice && (
        <div className="notice">
          <AlertCircle size={17} /> {notice}
        </div>
      )}

      <section className="work-surface">
        <div className="list-header">
          <div className="search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search quizzes and assignments"
            />
          </div>
        </div>
        <div className="content-list">
          {filtered.map((item) => {
            const enabled = !!settings[item.id]?.sebRequired;
            return (
              <article className="content-row" key={item.id}>
                <div className="content-main">
                  <span className={clsx("status-dot", enabled && "on")} />
                  <div>
                    <h2>{item.title}</h2>
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
                  <button
                    className="icon-button"
                    onClick={() =>
                      (window.location.href = `/api/quizzes/${encodeURIComponent(data.courseId)}/${encodeURIComponent(item.id)}/seb/config`)
                    }
                    title="Download SEB configuration"
                    disabled={!enabled}
                  >
                    <Download size={17} />
                  </button>
                  <button className="icon-button" onClick={() => setActiveItem(item)} title="Advanced settings">
                    <Settings size={17} />
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => regenerate(item)}
                    disabled={!enabled || busyId === item.id}
                  >
                    <KeyRound size={16} /> Rotate
                  </button>
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
        </div>
      </section>

      {activeItem && (
        <SettingsDialog
          item={activeItem}
          userId={data.userId}
          authToken={data.authToken}
          setting={settings[activeItem.id] || {}}
          onClose={() => setActiveItem(null)}
          onSaved={(saved) => {
            setSettings((current) => ({ ...current, [activeItem.id]: saved.setting || saved }));
            setActiveItem(null);
            setNotice("SEB configuration saved.");
          }}
        />
      )}
    </main>
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

function SettingsDialog({
  item,
  userId,
  authToken,
  setting,
  onClose,
  onSaved
}: {
  item: QuizView;
  userId: string;
  authToken?: string;
  setting: Record<string, any>;
  onClose: () => void;
  onSaved: (body: any) => void;
}) {
  const [ssoDomains, setSsoDomains] = useState((setting.ssoDomains || ["accounts.google.com"]).join("\n"));
  const [educationalToolDomains, setEducationalToolDomains] = useState(
    (setting.educationalToolDomains || []).join("\n")
  );
  const [customDomains, setCustomDomains] = useState((setting.customDomains || []).join("\n"));
  const [quitPassword, setQuitPassword] = useState(setting.quitPassword || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const body = {
      quizId: item.id,
      contentId: item.id.startsWith("newquiz:") ? item.id : undefined,
      ssoDomains: lines(ssoDomains),
      educationalToolDomains: lines(educationalToolDomains),
      customDomains: lines(customDomains),
      quitPassword: quitPassword || null
    };
    const response = await fetch(`/api/quizzes/seb-config-structured?userId=${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...actionHeaders(authToken) },
      body: JSON.stringify(body)
    });
    onSaved(await response.json());
    setSaving(false);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">SEB configuration</p>
            <h2 id="settings-title">{item.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close settings">
            <X size={17} />
          </button>
        </header>
        <div className="field-grid">
          <label>
            SSO domains
            <textarea value={ssoDomains} onChange={(event) => setSsoDomains(event.target.value)} />
          </label>
          <label>
            Educational tool domains
            <textarea
              value={educationalToolDomains}
              onChange={(event) => setEducationalToolDomains(event.target.value)}
              placeholder="www.desmos.com/calculator"
            />
          </label>
          <label>
            Custom domains
            <textarea
              value={customDomains}
              onChange={(event) => setCustomDomains(event.target.value)}
              placeholder="docs.google.com"
            />
          </label>
          <label>
            Exit password
            <input
              type="password"
              value={quitPassword}
              onChange={(event) => setQuitPassword(event.target.value)}
              placeholder="Optional quiz-specific password"
            />
          </label>
        </div>
        <footer className="dialog-actions">
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={save} disabled={saving}>
            <Save size={16} /> Save settings
          </button>
        </footer>
      </section>
    </div>
  );
}

function AuthorizationPage({ data }: { data: Record<string, any> }) {
  return (
    <MessagePage
      icon={<KeyRound />}
      title="Canvas API Authorization Required"
      message={
        data.message ||
        "Authorize Canvas access so this tool can read quizzes, set access codes, and update module links."
      }
      action={
        <a className="button primary" href={data.authUrl}>
          Authorize Canvas Access
        </a>
      }
    />
  );
}

function SebDownloadPage({ data }: { data: Record<string, any> }) {
  const configUrl = data.sebConfigUrl || data.configUrl || data.configDownloadUrl;
  return (
    <MessagePage
      icon={<Shield />}
      title="Safe Exam Browser Required"
      message="This quiz requires Safe Exam Browser. Open SEB to continue to the assessment."
      action={
        <div className="student-action-stack">
          <a className="button primary" href={data.sebLaunchUrl || configUrl}>
            <ExternalLink size={16} /> Open SEB
          </a>
          <a className="backup-link" href={configUrl}>
            <Download size={15} /> If that does not work, try the file
          </a>
        </div>
      }
    />
  );
}

function SebExitPage({ data }: { data: Record<string, any> }) {
  useEffect(() => {
    if (!data.quitUrl) {
      return;
    }
    const timeout = window.setTimeout(() => {
      window.location.assign(data.quitUrl);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [data.quitUrl]);

  return (
    <MessagePage
      icon={<Check />}
      title="Assessment Complete"
      message="Safe Exam Browser should close automatically. Use the button if it stays open."
      action={
        <a className="button primary" id="sebQuitLink" href={data.quitUrl}>
          <LogOut size={16} /> Quit Safe Exam Browser
        </a>
      }
    />
  );
}

function SebQuitPage({ data }: { data: Record<string, any> }) {
  return (
    <MessagePage
      icon={<LogOut />}
      title="Safe Exam Browser Closing"
      message="Safe Exam Browser should close this session. Use the retry link if your browser remains open."
      action={
        <a className="button primary" id="sebLegacyQuitLink" href={data.legacyQuitUrl || data.quitUrl}>
          Retry quit
        </a>
      }
    />
  );
}

function DeepLinkSelect({ data }: { data: Record<string, any> }) {
  const quizzes: QuizView[] = data.quizzes || [];
  return (
    <main className="message-shell wide">
      <section className="message-panel">
        <Shield size={34} />
        <h1>Choose Canvas Links</h1>
        <form method="post" action="/lti/deeplink/process" className="deeplink-list">
          {quizzes.map((quiz) => (
            <label key={quiz.id} className="check-row">
              <input type="checkbox" name={`quiz_${quiz.id}`} />
              <span>{quiz.title}</span>
              <label className="inline-check">
                <input type="checkbox" name={`seb_${quiz.id}`} /> Require SEB
              </label>
            </label>
          ))}
          <button className="button primary" type="submit">
            Create links
          </button>
        </form>
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
        {action}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function lines(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
