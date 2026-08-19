import { describe, it, expect } from "vitest";
import { utimesSync, existsSync } from "node:fs";
import { widgetBuildId, loadWidgetHtml } from "./widgetAssets";

const BUILT = existsSync("dist/widget/widget.js");

describe.skipIf(!BUILT)("widgetAssets", () => {
  it("finds the bundle without depending on the working directory", () => {
    // The old code read the relative path "dist/widget/widget.js", which is
    // only correct because `npm start` runs from the repo root. A Netlify
    // function runs from its own bundle directory and got the "not built"
    // placeholder with a 200 — a green deploy serving a broken store.
    expect(widgetBuildId()).not.toBe("unbuilt");
  });

  it("does not change the build id when only the mtime changes", () => {
    // This is the serverless failure. The id was `${size}-${mtime}`; every
    // cold start unpacks the bundle afresh, so two instances answering the
    // same conversation could stamp different ids onto the same bytes.
    const before = widgetBuildId();
    const later = new Date(Date.now() + 60_000);
    utimesSync("dist/widget/widget.js", later, later);

    expect(widgetBuildId()).toBe(before);
  });

  it("inlines the server url the widget must call back on", () => {
    const html = loadWidgetHtml("https://example.test");

    expect(html).toContain('window.__SERVER_URL__ = "https://example.test"');
    expect(html).toContain(widgetBuildId());
  });
});
