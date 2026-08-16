import { describe, it, expect } from "vitest";
import {
  widgetCspMeta,
  widgetToolMeta,
  widgetUri,
  isWidgetUri,
} from "./widgetMeta";

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

    expect(
      new Set([
        meta["openai/outputTemplate"],
        meta["ui/resourceUri"],
        meta.ui.resourceUri,
      ]).size,
    ).toBe(1);
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

describe("widgetCspMeta", () => {
  const DOMAINS = {
    connect: ["https://a.test"],
    resource: ["https://cdn.shopify.com"],
    frame: ["https://sdk.cashfree.com"],
    redirect: ["https://shop.test"],
  };

  it("declares the same domains under both ecosystems' keys", () => {
    // These were hand-written twice and drifted: the OpenAI block listed
    // resource and frame domains, the MCP Apps block listed only connect. The
    // spec says an omitted list means deny, so on Claude every product image
    // from Shopify's CDN was blocked while ChatGPT rendered them fine.
    const meta = widgetCspMeta(DOMAINS);

    expect(meta["openai/widgetCSP"].connect_domains).toEqual(DOMAINS.connect);
    expect(meta.ui.csp.connectDomains).toEqual(DOMAINS.connect);
    expect(meta["openai/widgetCSP"].resource_domains).toEqual(DOMAINS.resource);
    expect(meta.ui.csp.resourceDomains).toEqual(DOMAINS.resource);
    expect(meta["openai/widgetCSP"].frame_domains).toEqual(DOMAINS.frame);
    expect(meta.ui.csp.frameDomains).toEqual(DOMAINS.frame);
  });

  it("never emits an empty list, which a host reads as deny", () => {
    const meta = widgetCspMeta(DOMAINS);

    for (const list of Object.values(meta.ui.csp)) {
      expect(list.length).toBeGreaterThan(0);
    }
  });

  it("keeps redirect domains on the OpenAI key only", () => {
    // MCP Apps' csp has no redirect equivalent — connect, resource, frame and
    // baseUri are the whole set. Inventing one would be a key no host reads.
    const meta = widgetCspMeta(DOMAINS);

    expect(meta["openai/widgetCSP"].redirect_domains).toEqual(DOMAINS.redirect);
    expect(meta.ui.csp).not.toHaveProperty("redirectDomains");
  });

  it("states the border preference to both, rather than letting hosts differ", () => {
    const meta = widgetCspMeta(DOMAINS);

    expect(meta["openai/widgetPrefersBorder"]).toBe(true);
    expect(meta.ui.prefersBorder).toBe(true);
  });
});

describe("isWidgetUri", () => {
  // A rebuild changes the build id, so the URI a live conversation's widgets
  // were created with stops resolving. Measured: after a rebuild and restart,
  // Claude re-read `ui://widget/shopify-store-6qwk-tjvgrb.html` on reload and
  // the server answered `-32602 Resource ... not found`. The buyer saw "store
  // could not load"; every widget already in the thread was bricked.
  it("recognises the URI of any build, not just the current one", () => {
    expect(isWidgetUri("ui://widget/shopify-store-6qwk-tjvgrb.html")).toBe(
      true,
    );
    expect(isWidgetUri("ui://widget/shopify-store-6quv-tjvi23.html")).toBe(
      true,
    );
    expect(isWidgetUri("ui://widget/shopify-store-unbuilt.html")).toBe(true);
  });

  it("does not answer for anything else the host might ask for", () => {
    // The Cashfree payment widget is a separate resource on the same server.
    expect(isWidgetUri("ui://cashfree/payment.html")).toBe(false);
    expect(isWidgetUri("ui://widget/shopify-store.html")).toBe(false);
    expect(isWidgetUri("ui://widget/other-6qwk.html")).toBe(false);
    expect(isWidgetUri("https://evil.test/shopify-store-x.html")).toBe(false);
  });
});
