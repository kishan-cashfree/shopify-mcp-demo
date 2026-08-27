/**
 * The Node entry point: a socket, and the routing that only a socket needs.
 *
 * Everything the server *is* lives in `src/lib/server/app.ts`, so that a
 * Netlify function can build the same MCP server without starting a listener.
 * Keep this file thin — nothing here can be unit-tested.
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  config,
  apiDeps,
  createStoreServer,
  CORS_HEADERS,
  MCP_PATH,
} from "./src/lib/server/app.js";
import { routeApiRequest } from "./src/lib/server/apiRoutes.js";
import {
  describeApiOutcome,
  describeMcpBody,
  formatRequestLog,
} from "./src/lib/server/logging.js";
import {
  MCP_METHODS,
  mcpAllowHeader,
  routeMcpRequest,
} from "./src/lib/server/mcpRouting.js";


async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const startedAt = Date.now();
    let mcpDetail: { mcpMethod?: string; mcpTool?: string } = {};
    let failureReason: string | undefined;
    let outcome: string | undefined;

    /**
     * Remembers why a request failed, on the way out.
     *
     * Handlers already put the upstream message in `{ error }`; the log threw
     * it away. A 502 from /api/pay/otp recorded nothing but its status, so the
     * cause existed only on the buyer's screen. Returns the body so it can wrap
     * the existing serialisation rather than adding a line at every exit.
     */
    const noteFailure = <T>(body: T): T => {
      if (body && typeof body === "object" && "error" in body) {
        const reason = (body as { error?: unknown }).error;
        if (typeof reason === "string") failureReason = reason;
      }
      // Successes get the same treatment, for the same reason: a status code
      // alone did not say what happened. The summarising lives in logging.ts,
      // where it can be tested — nothing in this file can be.
      outcome = describeApiOutcome(body);
      return body;
    };

    // Logged on close rather than at each exit point: the MCP transport writes
    // the response itself, so there is no single place downstream that knows
    // the final status.
    res.on("finish", () => {
      // Preflights are logged. They were suppressed as noise, which hid a
      // failing preflight for days: the GET it guarded never appeared in the
      // log either, so the evidence read as "the request never happened"
      // rather than "the request was refused".
      if (req.method === "OPTIONS" && url.pathname === MCP_PATH) return;
      console.log(
        formatRequestLog({
          at: new Date(),
          method: req.method ?? "?",
          path: url.pathname,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          error: failureReason,
          outcome,
          ...mcpDetail,
        }),
      );
    });

    // Shared with the Netlify entry point — see CORS_HEADERS for why the
    // ngrok header is in the list.
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(name, value);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      res
        .writeHead(200, { "content-type": "text/plain" })
        .end(`Shopify MCP demo — store: ${config.shopDomain}`);
      return;
    }

    // Every /api/* route lives in apiRoutes.ts so the Netlify function and
    // this server answer them with one implementation. Divergent code paths
    // that were "obviously the same" are the origin of most host bugs here.
    const api = await routeApiRequest(
      req.method,
      url.pathname,
      url.searchParams,
      () => readJsonBody(req),
      apiDeps,
    );
    if (api) {
      res
        .writeHead(api.status, { "content-type": "application/json" })
        .end(JSON.stringify(noteFailure(api.body)));
      return;
    }


    // Stateless transport: there is no server->client stream to open, so the
    // GET leg of streamable HTTP must be declined with 405, not 404 — the spec
    // reserves 405 for exactly this, and 404 reads as "no such endpoint".
    // Measured: MCPJam opened this leg 97 times in one session and took the
    // 404 each time without aborting, so this is not what breaks it there.
    // Stricter clients are reported to give up before initialize instead; that
    // has not been reproduced here.
    if (
      routeMcpRequest(req.method, url.pathname, MCP_PATH) ===
      "method-not-allowed"
    ) {
      res.writeHead(405, { Allow: mcpAllowHeader() }).end();
      return;
    }

    if (
      url.pathname === MCP_PATH &&
      req.method &&
      MCP_METHODS.has(req.method)
    ) {
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      // Stateless: a fresh server and transport per request, with no session
      // id issued. Handing out a session id while discarding the server that
      // owns it makes every request after initialize fail with "Server not
      // initialized" — each one lands on a server that never saw the handshake.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = createStoreServer();

      res.on("close", () => {
        void transport.close();
        void server.close();
      });

      try {
        const body =
          req.method === "POST" ? await readJsonBody(req) : undefined;
        mcpDetail = describeMcpBody(body);
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.writeHead(500).end("Internal server error");
        }
      }
      return;
    }

    res.writeHead(404).end("Not Found");
  },
);

httpServer.listen(config.port, () => {
  console.log(`Shopify MCP demo on http://localhost:${config.port}${MCP_PATH}`);
  console.log(`Store: ${config.shopDomain}`);
  console.log(`Widget origin: ${config.serverUrl}`);
});
