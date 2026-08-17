import { KeyRound, LogOut, PlayCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { actionHeaders, apiErrorDetail, clientRequestError, errorMessage, requestJson } from "../../lib/api.js";
import { useDialogInitialFocus, useEscapeToClose } from "../../hooks/dialog.js";
import { queueSebLaunchHandoff } from "./launch.js";
import { detectSebRuntime, readSebConfigKeyHash } from "../../lib/seb-runtime.js";
import { SetupCheckItem, SetupCheckStatus } from "../../types.js";

export function SebSetupCheckDialog({
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

export function SebSetupCheckPage({ data }: { data: Record<string, any> }) {
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
