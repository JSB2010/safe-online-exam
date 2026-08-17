import { AlertCircle, ArrowLeft, ExternalLink, Shield, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  apiErrorDetail,
  clientRequestError,
  errorMessage,
  onboardingRecovery,
  persistStudentReadinessPromptDismissal,
  requestJson
} from "../../lib/api.js";
import { MessagePage } from "../../components/feedback.js";
import { SebSetupCheckDialog } from "./setup-check.js";
import { SebLaunchHandoffPurpose } from "../../types.js";

const SEB_OFFICIAL_DOWNLOAD_URL = "https://safeexambrowser.org/download_en.html";

const SEB_LAUNCH_RECOVERY_DELAY_MS = 5_000;

const SEB_LAUNCH_HANDOFF_STORAGE_PREFIX = "safe-online-exam:seb-launch:";

export function SebDownloadPage({ data }: { data: Record<string, any> }) {
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

export function SebLaunchButton({
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

export function queueSebLaunchHandoff(
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

export function SebLaunchingHandoffPage() {
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

export function SebLaunchingPage({ data }: { data: Record<string, any> }) {
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
