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

  it("derives serverUrl from the port when SERVER_URL is unset", () => {
    // The widget calls this origin, so it has to track a custom PORT rather
    // than staying pinned to the default.
    expect(loadConfig({ ...REQUIRED, PORT: "3000" }).serverUrl).toBe(
      "http://localhost:3000",
    );
  });

  it("prefers an explicit SERVER_URL, which is how tunnelling works", () => {
    // ngrok: set SERVER_URL to the public origin and restart. If the derived
    // localhost value won here, the widget would call an origin the host
    // cannot reach.
    const config = loadConfig({
      ...REQUIRED,
      SERVER_URL: "https://demo.ngrok-free.app",
    });

    expect(config.serverUrl).toBe("https://demo.ngrok-free.app");
  });

  it("falls back to localhost when SERVER_URL is set but empty", () => {
    // A commented-out or blank line in .env must not produce an empty origin
    // that the widget would resolve against its own page.
    expect(loadConfig({ ...REQUIRED, SERVER_URL: "" }).serverUrl).toBe(
      "http://localhost:8787",
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
});
