import { AlertCircle, BookOpen, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { OnboardingRecovery, Toast } from "../types.js";

export function MessagePage({
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

export function SectionHeading({
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

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="empty-state">
      <BookOpen size={22} />
      <strong>{title}</strong>
      {message && <span>{message}</span>}
    </div>
  );
}

export function RecoveryNotice({ recovery, onDismiss }: { recovery: OnboardingRecovery; onDismiss: () => void }) {
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

export function ToastRegion({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
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
