import { describe, it, expect } from "vitest";
import { widgetToolMeta, widgetUri } from "./widgetMeta";

const URI = "ui://widget/shopify-store.html";

describe("widgetToolMeta", () => {
  it("keeps the OpenAI keys ChatGPT discovers the widget through", () => {
    const meta = widgetToolMeta(URI);

    expect(meta["openai/outputTemplate"]).toBe(URI);
    expect(meta["openai/widgetAccessible"]).toBe(true);
  });

  it("declares the resource under the modern MCP Apps key", () => {
    // Claude reads _meta.ui.resourceUri. Without it the tool looks like it has
    // no UI, so the host never issues resources/read and nothing renders —
    // observed live: Claude called tools/list, resources/list and
    // tools/call SearchProducts, but never resources/read.
    const meta = widgetToolMeta(URI);

    expect(meta.ui).toEqual({ resourceUri: URI });
  });

  it("also declares the legacy flat key, which hosts must accept", () => {
    // ext-apps documents hosts as checking BOTH: `_meta.ui.resourceUri` first,
    // then `_meta["ui/resourceUri"]`. Emitting both costs nothing and covers
    // hosts that only implement one.
    const meta = widgetToolMeta(URI);

    expect(meta["ui/resourceUri"]).toBe(URI);
  });

  it("points every key at the same resource", () => {
    // Three keys naming two different widgets is worse than one key: the host
    // renders whichever it happened to read.
    const meta = widgetToolMeta(URI);

    expect(new Set([
      meta["openai/outputTemplate"],
      meta["ui/resourceUri"],
      meta.ui.resourceUri,
    ]).size).toBe(1);
  });

  it("carries extra result data through untouched", () => {
    // The tool result merges its own payload with these keys; dropping the
    // payload would leave the widget rendering an empty grid.
    const meta = widgetToolMeta(URI, { products: [{ id: "p1" }] });

    expect(meta.products).toEqual([{ id: "p1" }]);
    expect(meta.ui).toEqual({ resourceUri: URI });
  });
});

describe("widgetUri", () => {
  it("carries the build id, so a rebuilt widget is a different resource", () => {
    // Hosts cache the widget per conversation and keep rendering the instance
    // a thread was created with. Measured: Claude fetched a new build at
    // 16:14 and the open chat still showed the one from 15:58. A constant URI
    // gives it no way to tell them apart; a versioned one does.
    expect(widgetUri("6qd4-tjr9g4")).toBe(
      "ui://widget/shopify-store-6qd4-tjr9g4.html",
    );
  });

  it("changes whenever the build changes", () => {
    expect(widgetUri("aaa")).not.toBe(widgetUri("bbb"));
  });

  it("stays a ui:// resource, which is how hosts spot a renderable one", () => {
    expect(widgetUri("6qd4-tjr9g4").startsWith("ui://")).toBe(true);
  });

  it("survives an unbuilt widget without producing a bare uri", () => {
    // widgetBuildId() returns "unbuilt" before the first vite build.
    expect(widgetUri("unbuilt")).toBe("ui://widget/shopify-store-unbuilt.html");
  });
});
