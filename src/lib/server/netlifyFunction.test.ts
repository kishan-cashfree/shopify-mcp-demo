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
});
