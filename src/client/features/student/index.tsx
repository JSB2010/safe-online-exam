import { ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { errorMessage, persistStudentReadinessPromptDismissal } from "../../lib/api.js";
import { BrandMark } from "../../components/brand-mark.js";
import { EmptyState } from "../../components/feedback.js";
import { SebLaunchButton } from "../seb/launch.js";
import { SebSetupCheckDialog } from "../seb/setup-check.js";
import { OnboardingContext, StudentQuizView } from "../../types.js";

export function StudentDashboard({ data }: { data: Record<string, any> }) {
  const quizzes: StudentQuizView[] = data.quizzes || [];
  const onboarding = (data.onboarding || {}) as OnboardingContext;
  const [showSetupCheck, setShowSetupCheck] = useState(false);
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
                browserReturnUrl={data.browserReturnUrl}
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
          browserReturnUrl={data.browserReturnUrl}
          onClose={() => setShowSetupCheck(false)}
          onCompleted={dismissReadinessBanner}
        />
      )}
    </main>
  );
}
