import { describe, it, expect } from "vitest";
import { widgetToolMeta } from "./widgetMeta";

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
