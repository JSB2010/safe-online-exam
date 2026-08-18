import { AlertCircle, ArrowLeft, ExternalLink, Shield, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  apiErrorDetail,
  clientRequestError,
  errorMessage,
  onboardingRecovery,
  persistStudentReadinessPromptDismissal,
  requestJson,
  safeSameOriginNavigationTarget
} from "../../lib/api.js";
import { MessagePage } from "../../components/feedback.js";
import { SebSetupCheckDialog } from "./setup-check.js";
import { SebLaunchHandoffPurpose } from "../../types.js";

const SEB_OFFICIAL_DOWNLOAD_URL = "https://safeexambrowser.org/download_en.html";

const SEB_LAUNCH_RECOVERY_DELAY_MS = 5_000;

const SEB_LAUNCH_HANDOFF_STORAGE_PREFIX = "safe-online-exam:seb-launch:";

export function SebDownloadPage({ data }: { data: Record<string, any> }) {
  const [showSetupCheck, setShowSetupCheck] = useState(false);
  const [readinessRecommended, setReadinessRecommended] = useState(
    data.readinessRecommended === true || data.showReadinessPrompt === true
  );
  const courseReturnUrl = safeBrowserReturnUrl(data.browserReturnUrl) || "/";
  return (
    <>
      <MessagePage
        icon={<Shield />}
        title="Safe Exam Browser Required"
        message={
          readinessRecommended
            ? "Before opening this assessment, you can run the optional setup check on this computer."
            : "Open this assessment in Safe Exam Browser when you are ready. If prompted, allow Safe Exam Browser to open."
        }
        action={
          <>
            <ReturnToCourseButton returnUrl={courseReturnUrl} />
            <button className="button secondary" type="button" onClick={() => setShowSetupCheck(true)}>
              <ShieldCheck size={16} /> {readinessRecommended ? "Setup check (recommended)" : "Setup check"}
            </button>
            <SebLaunchButton
              grantUrl={data.configGrantUrl}
              token={data.configGrantToken}
              label="Open Safe Exam Browser"
              browserReturnUrl={courseReturnUrl}
            />
          </>
        }
      />
      {showSetupCheck && (
        <SebSetupCheckDialog
          launchUrl={data.setupCheckLaunchUrl || "/seb/check/config.seb"}
          readinessUrl={data.sessionReadinessUrl || "/api/seb/session-readiness"}
          authToken={data.configGrantToken}
          browserReturnUrl={courseReturnUrl}
          onClose={() => setShowSetupCheck(false)}
          onCompleted={async () => {
            await persistStudentReadinessPromptDismissal(data.configGrantToken).catch(() => undefined);
            setReadinessRecommended(false);
          }}
        />
      )}
    </>
  );
}

export function SebLaunchButton({
  grantUrl,
  token,
  label,
  browserReturnUrl,
  handoffPurpose = "assessment"
}: {
  grantUrl?: string;
  token?: string;
  label: string;
  browserReturnUrl?: string;
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
        headers: { accept: "application/json", "content-type": "application/json", "x-auth-token": token },
        body: JSON.stringify({ handoffPurpose })
      });
      if (typeof payload.sebLaunchUrl !== "string" || !/^sebs?:\/\//iu.test(payload.sebLaunchUrl)) {
        throw clientRequestError(
          typeof payload.error_code === "string" ? payload.error_code : undefined,
          undefined,
          apiErrorDetail(payload.message)
        );
      }
      setOpeningHandoff(true);
      const serverHandoffUrl = safeSameOriginNavigationTarget(payload.handoffUrl, "");
      if (serverHandoffUrl) {
        window.location.assign(serverHandoffUrl);
      } else {
        queueSebLaunchHandoff(payload.sebLaunchUrl, safeBrowserReturnUrl(browserReturnUrl) || "/", handoffPurpose);
      }
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

export function SebLaunchingHandoffPage({ data = {} }: { data?: Record<string, any> }) {
  const [handoff] = useState(() => resolveSebLaunchHandoff(data));

  useEffect(() => {
    if (!handoff.storageKey) return;
    try {
      window.sessionStorage.removeItem(handoff.storageKey);
    } catch {
      // The launch data is already stable in component state. Storage cleanup
      // is best-effort and must not replace a valid one-time handoff with the
      // unavailable page.
    }
  }, [handoff.storageKey]);

  if (!handoff.launch) {
    return <SebLaunchHandoffUnavailablePage returnUrl={safeBrowserReturnUrl(data.browserReturnUrl) || "/"} />;
  }

  return <SebLaunchingPage data={handoff.launch} />;
}

function resolveSebLaunchHandoff(data: Record<string, any>): {
  storageKey: string | null;
  launch: { sebLaunchUrl: string; browserReturnUrl: string; launchPurpose: SebLaunchHandoffPurpose } | null;
} {
  if (typeof data.sebLaunchUrl === "string" && /^sebs?:\/\//iu.test(data.sebLaunchUrl)) {
    return {
      storageKey: null,
      launch: {
        sebLaunchUrl: data.sebLaunchUrl,
        browserReturnUrl: typeof data.browserReturnUrl === "string" ? data.browserReturnUrl : "",
        launchPurpose: isSebLaunchHandoffPurpose(data.launchPurpose) ? data.launchPurpose : "assessment"
      }
    };
  }

  const handoffKey = new URLSearchParams(window.location.search).get("key");
  if (!handoffKey) return { storageKey: null, launch: null };
  const storageKey = `${SEB_LAUNCH_HANDOFF_STORAGE_PREFIX}${handoffKey}`;
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    const launch = stored
      ? (JSON.parse(stored) as { sebLaunchUrl?: unknown; returnUrl?: unknown; purpose?: unknown })
      : null;
    if (typeof launch?.sebLaunchUrl !== "string" || !/^sebs?:\/\//iu.test(launch.sebLaunchUrl)) {
      return { storageKey, launch: null };
    }
    return {
      storageKey,
      launch: {
        sebLaunchUrl: launch.sebLaunchUrl,
        browserReturnUrl: typeof launch.returnUrl === "string" ? launch.returnUrl : "",
        launchPurpose: isSebLaunchHandoffPurpose(launch.purpose) ? launch.purpose : "assessment"
      }
    };
  } catch {
    return { storageKey, launch: null };
  }
}

function SebLaunchHandoffUnavailablePage({ returnUrl }: { returnUrl: string }) {
  return (
    <MessagePage
      icon={<AlertCircle />}
      title="This Safe Exam Browser launch has ended"
      message="Each launch link can be used only once. Return to your Canvas course and reopen the assessment if you still need it."
      action={<ReturnToCourseButton returnUrl={returnUrl} primary />}
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
            {returnUrl && <ReturnToCourseButton returnUrl={returnUrl} primary />}
            {sebLaunchUrl && (
              <a className="button secondary" href={sebLaunchUrl} onClick={startLaunchRecovery}>
                <ExternalLink size={16} /> Try opening again
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
  recoveryNextStep: string;
} {
  if (purpose === "student-list") {
    return {
      title: "Opening your quiz",
      message: "Safe Exam Browser is opening your selected quiz. If your browser asks, select Open Safe Exam Browser.",
      recoveryNextStep: "download it, then return to your Canvas course and open the quiz again."
    };
  }
  if (purpose === "setup-check") {
    return {
      title: "Opening Safe Exam Browser",
      message:
        "We’re opening your setup check in Safe Exam Browser. If your browser asks, select Open Safe Exam Browser.",
      recoveryNextStep: "download it, then return to your course and run the setup check again."
    };
  }
  if (purpose === "assessment") {
    return {
      title: "Opening Safe Exam Browser",
      message:
        "We’re opening your assessment in Safe Exam Browser. If your browser asks, select Open Safe Exam Browser.",
      recoveryNextStep: "download it, then return to your Canvas course and open the assessment again."
    };
  }
  return {
    title: "Opening Safe Exam Browser",
    message: "We’re opening Safe Exam Browser. If your browser asks, select Open Safe Exam Browser.",
    recoveryNextStep: "download it, then return to your Canvas course and reopen the assessment."
  };
}

function ReturnToCourseButton({ returnUrl, primary = false }: { returnUrl: string; primary?: boolean }) {
  const safeReturnUrl = safeBrowserReturnUrl(returnUrl) || "/";
  return (
    <button
      className={clsx("button", primary ? "primary" : "secondary")}
      type="button"
      onClick={() => window.location.replace(safeReturnUrl)}
    >
      <ArrowLeft size={16} /> Return to course
    </button>
  );
}

function safeBrowserReturnUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const url = new URL(value, window.location.origin);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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
