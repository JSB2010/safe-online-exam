export interface AppShellOptions {
  title: string;
  view: string;
  initialData?: Record<string, unknown>;
}

export function renderAppShell(options: AppShellOptions): string {
  const payload = JSON.stringify({
    view: options.view,
    data: options.initialData || {}
  }).replace(/</gu, "\\u003c");
  const appScriptPath = versionedAssetPath("/assets/index.js");
  const appStylesheetPath = versionedAssetPath("/assets/index.css");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(options.title)}</title>
    <script>window.__SEB_BOOTSTRAP__=${payload};</script>
    <script type="module" src="${appScriptPath}"></script>
    <link rel="stylesheet" href="${appStylesheetPath}">
  </head>
  <body>
    <div id="root"></div>
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
