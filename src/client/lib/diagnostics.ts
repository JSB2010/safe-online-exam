// App-owned views only; Canvas detector diagnostics use their own scoped flow.
export function initializeDiagnostics() {
  try {
    const bootstrap = JSON.parse(document.getElementById("seb-bootstrap")?.textContent || "{}");
    const d = bootstrap.data?._diagnostics;
    if (typeof d?.token !== "string" || typeof d?.endpoint !== "string" || !d.endpoint.startsWith("/api/diagnostics/"))
      return;
    let sequence = 0;
    const emit = (stage: string, reasonCode?: string) => {
      void fetch(d.endpoint, {
        method: "POST",
        credentials: "omit",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: d.token,
          events: [{ stage, at: new Date().toISOString(), sequence: ++sequence, ...(reasonCode ? { reasonCode } : {}) }]
        })
      }).catch(() => {});
    };
    emit("detector.initialized");
    window.addEventListener("error", () => emit("browser.error", "BROWSER_APP_EXCEPTION"));
    window.addEventListener("unhandledrejection", () => emit("browser.error", "BROWSER_APP_REJECTION"));
  } catch {
    /* Best effort. */
  }
}
