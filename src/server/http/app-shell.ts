export interface AppShellOptions {
  title: string;
  view: string;
  initialData?: Record<string, unknown>;
}

export function renderAppShell(options: AppShellOptions): string {
  const payload = JSON.stringify({
    view: options.view,
    data: options.initialData || {}
  })
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  const appScriptPath = versionedAssetPath("/assets/index.js");
  const appStylesheetPath = versionedAssetPath("/assets/index.css");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(options.title)}</title>
    <script id="seb-bootstrap" type="application/json">${payload}</script>
    <script type="module" src="${appScriptPath}"></script>
    <link rel="stylesheet" href="${appStylesheetPath}">
    <style>
      .seb-app-loading { min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #475467; background: #f3f6fa; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .seb-app-loading__card { width: min(760px, 100%); display: grid; gap: 18px; padding: 28px; background: #fff; border: 1px solid #dbe2ea; border-radius: 14px; box-shadow: 0 10px 28px rgba(24, 36, 56, .06); }
      .seb-app-loading__heading { width: 42%; height: 16px; border-radius: 6px; background: #e8edf4; }
      .seb-app-loading__line { width: 72%; height: 12px; border-radius: 6px; background: #eef2f6; }
      .seb-app-loading__row { height: 64px; border-radius: 10px; background: #eef2f6; animation: seb-shell-pulse 1.2s ease-in-out infinite; }
      @keyframes seb-shell-pulse { 50% { opacity: .62; } }
      @media (prefers-reduced-motion: reduce) { .seb-app-loading__row { animation: none; } }
    </style>
  </head>
  <body>
    <div id="root"><main class="seb-app-loading" role="status" aria-live="polite" aria-label="Loading Safe Exam Browser"><section class="seb-app-loading__card"><div class="seb-app-loading__heading"></div><div class="seb-app-loading__line"></div><div class="seb-app-loading__row"></div><div class="seb-app-loading__row"></div><div class="seb-app-loading__row"></div></section></main></div>
  </body>
</html>`;
}

export function renderFallbackHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f7f9; }
      main { max-width: 760px; margin: 10vh auto; background: white; border: 1px solid #dfe3ea; border-radius: 8px; padding: 32px; box-shadow: 0 12px 32px rgba(24, 36, 56, 0.08); }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { line-height: 1.55; }
      a, button { color: #075985; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function versionedAssetPath(path: string): string {
  const version = process.env.APP_ASSET_VERSION || process.env.K_REVISION;
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}
