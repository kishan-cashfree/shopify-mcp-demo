import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

const REQUIRED = {
  SHOP_DOMAIN: "gcf-test-101.myshopify.com",
  UCP_AGENT_PROFILE: "https://shopify.dev/ucp/agent-profiles/example.json",
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("defaults the port to 8787", () => {
    expect(loadConfig({ ...REQUIRED }).port).toBe(8787);
  });

  it("reads PORT as a number, not the string from the environment", () => {
    // http.listen accepts a string and mostly works, so a string port hides
    // until something does arithmetic or a strict comparison on it.
    const config = loadConfig({ ...REQUIRED, PORT: "3000" });

    expect(config.port).toBe(3000);
    expect(typeof config.port).toBe("number");
  });

  it("derives serverUrl from the port for a local run", () => {
    // The widget calls this origin, so it has to track a custom PORT rather
    // than staying pinned to the default.
    expect(loadConfig({ ...REQUIRED, PORT: "3000" }).serverUrl).toBe(
      "http://localhost:3000",
    );
  });

  it("passes the store and agent profile through", () => {
    const config = loadConfig({ ...REQUIRED });

    expect(config.shopDomain).toBe("gcf-test-101.myshopify.com");
    expect(config.agentProfile).toBe(
      "https://shopify.dev/ucp/agent-profiles/example.json",
    );
  });

  it("throws when SHOP_DOMAIN is missing", () => {
    expect(() =>
      loadConfig({ UCP_AGENT_PROFILE: REQUIRED.UCP_AGENT_PROFILE }),
    ).toThrow(/SHOP_DOMAIN/);
  });

  it("throws when UCP_AGENT_PROFILE is missing", () => {
    // Every UCP call carries it, so booting without it only defers the failure
    // to the first catalog search.
    expect(() => loadConfig({ SHOP_DOMAIN: REQUIRED.SHOP_DOMAIN })).toThrow(
      /UCP_AGENT_PROFILE/,
    );
  });

  /**
   * Measured 2026-08-31: add-to-cart did nothing on a Netlify deploy, in BOTH
   * ChatGPT and Claude, while the same build over ngrok was fine. The catalog
   * rendered either way because products ride in the tool result's _meta and
   * need no fetch — add-to-cart is simply the first action that makes one.
   *
   * With no SERVER_URL set, serverUrl fell back to http://localhost:8787. That
   * origin is what gets injected as window.__SERVER_URL__ AND what gets listed
   * in connectDomains, so the widget called localhost from inside the host's
   * browser and the host's CSP blocked it — a failure with nothing in the
   * server log, because no request was ever made.
   *
   * ngrok never showed it: connectDomains carries *.ngrok-free.dev wildcards,
   * and SERVER_URL is set in .env for the local run. Netlify has neither
   * safety net, so it depends on this alone.
   */
  it("uses Netlify's own URL when SERVER_URL is not set", () => {
    const config = loadConfig({ ...REQUIRED, URL: "https://demo.netlify.app" });

    expect(config.serverUrl).toBe("https://demo.netlify.app");
  });

  it("prefers the deploy's own URL, so a preview does not call production", () => {
    // On a deploy preview, URL still points at the production site while
    // DEPLOY_PRIME_URL is this deploy. Calling production from a preview
    // widget would work just well enough to be confusing.
    const config = loadConfig({
      ...REQUIRED,
      URL: "https://demo.netlify.app",
      DEPLOY_PRIME_URL: "https://deploy-preview-7--demo.netlify.app",
    });

    expect(config.serverUrl).toBe("https://deploy-preview-7--demo.netlify.app");
  });

  it("falls back to localhost when nothing names an origin", () => {
    expect(loadConfig({ ...REQUIRED }).serverUrl).toBe("http://localhost:8787");
  });


  /**
   * SERVER_URL is gone. It named an origin by hand, and a hand-written origin
   * can name a server that is not this one — measured 2026-08-31, a Netlify
   * deploy carried a laptop's ngrok tunnel and add-to-cart died in both hosts
   * when the tunnel stopped, with no request reaching any server to log.
   *
   * The origin now comes from the request that asked for the widget, which
   * cannot be wrong that way. Verified against a live tunnel the same day:
   * ngrok sends x-forwarded-host and x-forwarded-proto, so the derived origin
   * is exactly the tunnel hostname with no configuration at all.
   *
   * What is left here is only a fallback for the boot banner and for a request
   * carrying no usable host.
   */
  it("ignores SERVER_URL, which no longer exists", () => {
    const config = loadConfig({
      ...REQUIRED,
      SERVER_URL: "https://stale.example.test",
    });

    expect(config.serverUrl).toBe("http://localhost:8787");
    expect(config).not.toHaveProperty("serverUrlOverride");
  });
});
