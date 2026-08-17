import { Check, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { MessagePage } from "../../components/feedback.js";

export function SebExitPage({ data }: { data: Record<string, any> }) {
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

export function SebQuitPage({ data }: { data: Record<string, any> }) {
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
