import { Shield } from "lucide-react";
import clsx from "clsx";
import type { RevealedSecrets } from "../../types.js";

export function SecretPanel({ secret, compact = false }: { secret?: RevealedSecrets; compact?: boolean }) {
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
