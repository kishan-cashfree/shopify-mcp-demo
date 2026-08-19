import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the built widget lives, found rather than assumed.
 *
 * `server.ts` used to read "dist/widget/widget.js" — a path relative to the
 * process working directory, which is only the repo root because `npm start`
 * happens to run there. A Netlify function is invoked from its own bundle
 * directory, so that path resolves to nothing and every widget read returns
 * the "Widget not built" placeholder with a 200, which looks like a working
 * deploy serving a broken store.
 *
 * The candidates are ordered cheapest-correct first: alongside this module is
 * where a bundled function finds it, the working directory is where a local
 * `npm start` does.
 */
function widgetDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "dist", "widget"),
    join(here, "..", "..", "..", "dist", "widget"),
    resolve(process.cwd(), "dist", "widget"),
    resolve(process.cwd(), "..", "dist", "widget"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "widget.js")));
}

/**
 * A build id derived from what the bundle *contains*, not when it was written.
 *
 * This was `${size}-${mtime}`, which is stable only while one process serves
 * one checkout. Serverless breaks both halves: every cold start unpacks the
 * bundle afresh, so mtime is deploy time or later and can differ between two
 * instances answering the same conversation. The id is what versions the
 * widget URI, so two instances disagreeing means the host is handed a URI that
 * a later `resources/read` no longer matches — the `ResourceTemplate` catches
 * it and serves the current bundle, so it degrades rather than breaks, but the
 * churn is invisible and pointless. A content hash is identical on every
 * instance of the same deploy and changes exactly when the widget does.
 */
export function widgetBuildId(): string {
  const dir = widgetDir();
  if (!dir) return "unbuilt";
  const js = readFileSync(join(dir, "widget.js"));
  const cssPath = join(dir, "widget.css");
  const css = existsSync(cssPath) ? readFileSync(cssPath) : Buffer.alloc(0);
  return createHash("sha256")
    .update(js)
    .update(css)
    .digest("hex")
    .slice(0, 12);
}

/** The widget, inlined into one document — the host is handed HTML, not a URL. */
export function loadWidgetHtml(serverUrl: string): string {
  const dir = widgetDir();
  if (!dir) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Store</title></head>
<body><h2>Widget not built</h2><p>Run <code>npm run build</code> first.</p></body></html>`;
  }

  const js = readFileSync(join(dir, "widget.js"), "utf8");
  const cssPath = join(dir, "widget.css");
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Shopify Store</title>
  <style>${css}</style>
</head>
<body style="background: var(--color-surface);">
  <div id="root"></div>
  <script>window.__SERVER_URL__ = ${JSON.stringify(serverUrl)};window.__BUILD__ = ${JSON.stringify(widgetBuildId())};</script>
  <script type="module">${js}</script>
</body>
</html>`;
}
