/**
 * The Netlify entry point.
 *
 * The counterpart to `server.ts`: same MCP server, same tools, same widget,
 * same `/api/*` routes — all imported from `src/lib/server/app.ts`, which is
 * why that split exists. Nothing about the store is decided here.
 *
 * No Node-to-Web adapter is involved. SDK 1.25.3 describes its
 * `StreamableHTTPServerTransport` as "a thin wrapper around
 * `WebStandardStreamableHTTPServerTransport`" and says to use the latter
 * directly in web-standard environments; its
 * `handleRequest(req: Request): Promise<Response>` is already the shape a
 * Netlify function has to return.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  apiDeps,
  config as appConfig,
  createStoreServer,
  CORS_HEADERS,
  MCP_PATH,
} from "../../src/lib/server/app.js";
import { routeApiRequest } from "../../src/lib/server/apiRoutes.js";
import {
  MCP_METHODS,
  mcpAllowHeader,
  routeMcpRequest,
} from "../../src/lib/server/mcpRouting.js";
import { describeMcpBody, formatRequestLog } from "../../src/lib/server/logging.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const startedAt = Date.now();

  const log = (status: number, extra: Record<string, unknown> = {}) =>
    console.log(
      formatRequestLog({
        at: new Date(),
        method: request.method,
        path: url.pathname,
        status,
        durationMs: Date.now() - startedAt,
        ...extra,
      }),
    );

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Declined with 405, not 404: the transport is stateless, so there is no
  // server-to-client stream to open, and the spec reserves 405 for exactly
  // this. 404 reads as "no such endpoint", which is a different answer.
  if (
    routeMcpRequest(request.method, url.pathname, MCP_PATH) ===
    "method-not-allowed"
  ) {
    log(405);
    return new Response(null, {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: mcpAllowHeader() },
    });
  }

  if (url.pathname === MCP_PATH && MCP_METHODS.has(request.method)) {
    // Stateless: a fresh server and transport per request, with no session id
    // issued. Handing out a session id while discarding the server that owns
    // it makes every request after initialize fail with "Server not
    // initialized". On a serverless platform this is not a choice — one
    // invocation cannot hold state the next one needs.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createStoreServer();

    try {
      // The body is read once here for the log, so the transport is handed a
      // clone rather than an already-consumed stream.
      const detail =
        request.method === "POST"
          ? describeMcpBody(await request.clone().json().catch(() => undefined))
          : {};
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      log(response.status, detail);

      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(CORS_HEADERS)) {
        headers.set(name, value);
      }
      headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      log(500);
      return json(500, { error: "Internal server error" });
    } finally {
      void transport.close();
      void server.close();
    }
  }

  const api = await routeApiRequest(
    request.method,
    url.pathname,
    url.searchParams,
    () => request.json().catch(() => ({})),
    apiDeps,
  );
  if (api) {
    log(api.status);
    return json(api.status, api.body);
  }

  if (request.method === "GET" && url.pathname === "/") {
    log(200);
    return new Response(`Shopify MCP demo — store: ${appConfig.shopDomain}`, {
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "text/plain" },
    });
  }

  log(404);
  return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
}

/**
 * One function answers every path. Netlify's own router would otherwise put
 * the function under /.netlify/functions/, and the MCP connector URL has to be
 * a plain `/mcp` — the host is given one endpoint and no way to rewrite it.
 */
export const config = {
  path: ["/mcp", "/api/*", "/"],
};
