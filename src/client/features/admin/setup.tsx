import { BookOpen, Check, ExternalLink } from "lucide-react";
import { BrandMark } from "../../components/brand-mark.js";

export function ServiceStatusPage({ data }: { data: Record<string, any> }) {
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

export function AdminSetupPage({ data }: { data: Record<string, any> }) {
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
