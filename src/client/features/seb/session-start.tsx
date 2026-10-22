import { Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MessagePage } from "../../components/feedback.js";
import { readSebConfigKeyHash } from "../../lib/seb-runtime.js";
import { requestJson, errorMessage, safeSameOriginNavigationTarget } from "../../lib/api.js";

export function SebSessionStartPage({ data }: { data: Record<string, any> }) {
  const [error, setError] = useState(typeof data.error === "string" ? data.error : "");
  const pending = useRef<Promise<Record<string, any>> | null>(null);
  useEffect(() => {
    if (data.error) return;
    let active = true;
    pending.current ??= (async () => {
      const hash = await readSebConfigKeyHash();
      const path = safeSameOriginNavigationTarget(data.startPath, "");
      if (!hash || !path) throw new Error("Reopen this quiz from Canvas in Safe Exam Browser.");
      return requestJson(path, {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ configKeyHash: hash })
      });
    })();
    void pending.current
      .then((result) => {
        if (!active) return;
        const target = new URL(result.sessionUrl);
        if (target.protocol !== "https:" || target.origin !== data.canvasOrigin) {
          throw new Error("Canvas returned an invalid launch destination.");
        }
        window.location.replace(target.toString());
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure, "Canvas could not open this quiz."));
      });
    return () => {
      active = false;
    };
  }, [data.error, data.startPath, data.canvasOrigin]);
  return (
    <MessagePage
      icon={<Shield />}
      title={error ? "Quiz could not open" : "Opening your quiz"}
      message={
        error ? `${error} Quit Safe Exam Browser, return to Canvas, and start a new launch.` : "Connecting to Canvas…"
      }
    />
  );
}
