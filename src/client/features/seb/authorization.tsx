import { AlertCircle, ArrowLeft, Check, KeyRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { safeSameOriginNavigationTarget } from "../../lib/api.js";
import { MessagePage } from "../../components/feedback.js";
import { OnboardingContext } from "../../types.js";

export function AuthorizationPage({ data }: { data: Record<string, any> }) {
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

export function StudentSessionAuthorizationPage({ data }: { data: Record<string, any> }) {
  const authUrl = safeSameOriginNavigationTarget(data.authUrl, "/api/student-session-authorize");
  const onConnected = useCallback((payload: Record<string, unknown>) => {
    window.location.replace(safeSameOriginNavigationTarget(payload.returnUrl, "/lti/launch?connected=1"));
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

export function StudentSessionConnectedPage({ data }: { data: Record<string, any> }) {
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

export function CanvasOAuthConnectedPage({ data }: { data: Record<string, any> }) {
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

export function OAuthErrorPage({ data: _data }: { data: Record<string, any> }) {
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
