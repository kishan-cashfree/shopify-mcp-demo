import { describe, it, expect, beforeAll } from "vitest";

/**
 * Proves the Netlify entry point answers MCP, without Netlify.
 *
 * Lives here rather than beside the function because Netlify treats every file
 * in `netlify/functions/` as a function to deploy, and a function named
 * "server.test" is rejected outright — the deploy failed on the illegal dot,
 * after the build had already succeeded.
 *
 * The function is a plain `(Request) => Promise<Response>`, so the platform is
 * not needed to exercise it — and the thing most worth proving is exactly the
 * part that differs from `server.ts`: that
 * `WebStandardStreamableHTTPServerTransport` completes a handshake when handed
 * a Web Request. A deploy is a slow way to discover it does not.
 */
let handler: (request: Request) => Promise<Response>;

beforeAll(async () => {
  // app.ts calls loadConfig() at module scope and throws without these.
  process.env.SHOP_DOMAIN ??= "example.myshopify.com";
  process.env.UCP_AGENT_PROFILE ??= "https://example.test/agent.json";
  process.env.CASHFREE_ENV ??= "sandbox";
  process.env.CASHFREE_CLIENT_ID ??= "test-id";
  process.env.CASHFREE_CLIENT_SECRET ??= "test-secret";
  handler = (await import("../../../netlify/functions/server.mjs")).default;
});

const post = (body: unknown) =>
  handler(
    new Request("https://site.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
  );

describe("netlify function", () => {
  it("completes an MCP initialize handshake", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.serverInfo.name).toBe("Shopify Store");
  });

  it("declines the GET leg with 405 and an Allow header", async () => {
    // Not 404 — the stateless transport has no stream to open, and 404 reads
    // as "no such endpoint" to a client deciding whether to keep going.
    const response = await handler(
      new Request("https://site.test/mcp", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toContain("POST");
  });

  it("answers a preflight with the ngrok header allowed", async () => {
    // The header that, when missing, made cashfree-here's recon report
    // "Payment Failed" on orders that were already PAID.
    const response = await handler(
      new Request("https://site.test/api/orders/status", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "ngrok-skip-browser-warning",
    );
  });

  it("routes /api/* through the same router the node server uses", async () => {
    const response = await handler(
      new Request("https://site.test/api/shop/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "query is required" });
  });

  /**
   * The root page names the origin the widget will be told to call.
   *
   * Added because a Netlify deploy served a perfectly healthy-looking store
   * whose add-to-cart did nothing, in both hosts, and the only way to see why
   * was to read window.__SERVER_URL__ out of the widget HTML — which meant
   * three JSON-RPC round trips and knowing the widget's build id. The origin
   * is already public in that HTML; printing it here turns a twenty-minute
   * diagnosis into one curl.
   */
  it("names the widget origin on the root page", async () => {
    const response = await handler(
      new Request("https://demo.netlify.app/", { method: "GET" }),
    );

    expect(await response.text()).toContain("widget origin:");
  });

  /**
   * The whole point of deriving the origin: a deploy cannot be told to send
   * its widget somewhere else. Measured 2026-08-31 — a new Netlify site's
   * SERVER_URL named a laptop's ngrok tunnel, so add-to-cart was dead in both
   * hosts with nothing in any log. The request's own host cannot be wrong that
   * way.
   */
  it("tells the widget to call the host the request arrived on", async () => {
    const list = await (await post({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/list",
    })).json();
    const uri = list.result.resources[0].uri;

    // Deliberately a different host from `post`'s site.test: the origin must
    // come from THIS request, not from configuration or an earlier one.
    const response = await handler(
      new Request("https://belvish-mcp-app.netlify.app/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "resources/read",
          params: { uri },
        }),
      }),
    );
    const contents = (await response.json()).result.contents[0];

    expect(contents.text).toContain(
      'window.__SERVER_URL__ = "https://belvish-mcp-app.netlify.app"',
    );
    // The CSP has to name the same origin, or the fetch is blocked even though
    // it points at the right place — the mismatch fails twice over.
    expect(contents._meta["openai/widgetCSP"].connect_domains).toContain(
      "https://belvish-mcp-app.netlify.app",
    );
  });
});
