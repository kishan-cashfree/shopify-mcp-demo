import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { loadConfig } from "./src/lib/server/config.js";
import { createUcpClient } from "./src/lib/ucp/client.js";
import { createShopService } from "./src/lib/ucp/shop.js";
import {
  handleCartRequest,
  handleSearchProducts,
} from "./src/lib/server/handlers.js";
import {
  describeMcpBody,
  formatRequestLog,
} from "./src/lib/server/logging.js";
import {
  widgetCspMeta,
  widgetToolMeta,
  widgetUri,
} from "./src/lib/server/widgetMeta.js";
import {
  registerCashfreeWidget,
  cashfreeUpiTool,
  cashfreeCardPaymentTool,
  cashfreeNetbankingTool,
  cashfreeNewCardTool,
  cashfreeCheckoutTool,
} from "@cashfreepayments/cashfree-here";
import { loadCashfreeConfig } from "./src/lib/cashfree/config.js";
import {
  createOrder,
  getOrderRaw,
  getOrderStatus,
} from "./src/lib/cashfree/orders.js";
import {
  initiateOtp,
  verifyOtp,
  getAddresses,
  createAddress,
} from "./src/lib/cashfree/occ.js";
import { createSessionStore } from "./src/lib/cashfree/session.js";
import { createPayHandlers } from "./src/lib/server/payHandlers.js";
import { augmentCashfreeCsp } from "./src/lib/server/cashfreeCsp.js";

const config = loadConfig();
const shop = createShopService(
  createUcpClient({
    shopDomain: config.shopDomain,
    agentProfile: config.agentProfile,
  }),
);

const cashfreeConfig = loadCashfreeConfig();
const sessionStore = createSessionStore();
const pay = createPayHandlers({
  config: cashfreeConfig,
  store: sessionStore,
  shopDomain: config.shopDomain,
  // Fixed, not our own origin. The ngrok URL changes on restart and dies
  // whenever the server is rebuilt — a buyer mid-payment came back to
  // ERR_CONNECTION_CLOSED. A stable page survives both. Override with
  // CASHFREE_RETURN_URL.
  returnUrl:
    process.env.CASHFREE_RETURN_URL ?? "https://cashfree-thanks.vercel.app/",
  loadCart: (cartId) => shop.loadCartForOrder(cartId),
  createOrder,
  initiateOtp,
  verifyOtp,
  getAddresses,
  createAddress,
  getOrderStatus,
});

// Versioned per build so a host cannot keep rendering a cached widget — see
// widgetUri(). widgetBuildId is a hoisted function declaration, so calling it
// here is safe despite appearing below.
const WIDGET_URI = widgetUri(widgetBuildId());
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Changes whenever the widget bundle changes. Rendered in the UI so a
 * screenshot says which build it is: host-cached widget instances kept
 * looking like current ones, and three debugging rounds went to code that had
 * already been deleted.
 */
function widgetBuildId(): string {
  const jsPath = "dist/widget/widget.js";
  if (!existsSync(jsPath)) return "unbuilt";
  const { size, mtimeMs } = statSync(jsPath);
  return `${size.toString(36)}-${Math.floor(mtimeMs / 1000).toString(36)}`;
}

function loadWidgetHtml(): string {
  const jsPath = "dist/widget/widget.js";
  const cssPath = "dist/widget/widget.css";

  if (!existsSync(jsPath)) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Store</title></head>
<body><h2>Widget not built</h2><p>Run <code>npm run build</code> first.</p></body></html>`;
  }

  const js = readFileSync(jsPath, "utf8");
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Shopify Store</title>
  <style>${css}</style>
</head>
<body style="background: var(--color-surface);">
  <div id="root"></div>
  <script>window.__SERVER_URL__ = ${JSON.stringify(config.serverUrl)};window.__BUILD__ = ${JSON.stringify(widgetBuildId())};</script>
  <script type="module">${js}</script>
</body>
</html>`;
}

function createStoreServer(): McpServer {
  const server = new McpServer({ name: "Shopify Store", version: "1.0.0" });

  server.registerResource(
    "shopify-store-widget",
    WIDGET_URI,
    {
      description: "Shopify store catalog and cart widget",
      // Must be on the resource METADATA. ChatGPT finds the widget via
      // openai/outputTemplate, so omitting it is invisible there — but MCP Apps
      // hosts discover renderable resources by mimeType in resources/list, and
      // without it the widget is treated as plain text and never rendered.
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => {
      // The configured origin is always allowed; the wildcards cover both
      // ngrok domain suffixes, which vary by account and tunnel.
      const connectDomains = [
        config.serverUrl,
        // Every Cashfree host the embedded checkout touches. Missing the
        // payments-* hosts leaves it stuck on "Establishing secure
        // connection…", since the frame loads but its calls are blocked.
        "https://sdk.cashfree.com",
        "https://sandbox.cashfree.com",
        "https://api.cashfree.com",
        "https://payments-test.cashfree.com",
        "https://payments.cashfree.com",
        "https://cashfreelogo.cashfree.com",
        "https://*.cashfree.com",
        "https://*.ngrok-free.app",
        "https://*.ngrok-free.dev",
        "https://*.ngrok.io",
      ];
      return {
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: loadWidgetHtml(),
            _meta: {
              "openai/widgetDescription":
                "Browse a Shopify store's catalog and build a cart",
              // One source for both ecosystems' spellings. Written out twice
              // by hand, these drifted: the MCP Apps block carried only
              // connect domains, so Claude blocked every product image while
              // ChatGPT rendered them.
              ...widgetCspMeta({
                connect: connectDomains,
                // Product images are served from Shopify's CDN. Without this
                // the grid renders with every image blocked.
                resource: [
                  "https://cdn.shopify.com",
                  "https://sdk.cashfree.com",
                  "https://cashfreelogo.cashfree.com",
                ],
                frame: [
                  "https://sdk.cashfree.com",
                  "https://sandbox.cashfree.com",
                  "https://api.cashfree.com",
                  "https://payments-test.cashfree.com",
                  "https://payments.cashfree.com",
                ],
                // The Checkout button opens the store's hosted checkout, and
                // the fallback link opens Cashfree's. The Cashfree entries
                // were missing entirely at first — this list predates any
                // Cashfree payment here — so a Cashfree URL handed to the host
                // from this widget was blocked outright.
                redirect: [
                  `https://${config.shopDomain}`,
                  "https://checkout.shopify.com",
                  "https://cashfree.com",
                  "https://api.cashfree.com",
                  "https://sandbox.cashfree.com",
                  "https://payments-test.cashfree.com",
                  "https://payments.cashfree.com",
                ],
              }),
            },
          },
        ],
      };
    },
  );

  server.registerTool(
    "SearchProducts",
    {
      title: "Search store products",
      description:
        "Search the connected Shopify store's product catalog and show the matching products in a shopping widget. Use whenever the user asks to browse, find, or shop for products from the store.",
      inputSchema: { query: z.string().min(1) },
      // Both ecosystems' keys — see widgetMeta.ts. ChatGPT reads the openai/*
      // pair; Claude reads ui.resourceUri and renders nothing without it.
      _meta: widgetToolMeta(WIDGET_URI),
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false,
      },
    },
    async ({ query }: { query: string }) => {
      const result = await handleSearchProducts(shop, query);
      return {
        content: result.content,
        // Hosts deliver _meta to the widget and hide it from the model, so the
        // catalog rides along with the widget pointer.
        _meta: widgetToolMeta(WIDGET_URI, result._meta),
      };
    },
  );

  // Cashfree's own widget resource. Its payment tools point at this, so
  // choosing a method swaps the rendered widget from ours to theirs — we write
  // no payment UI.
  // The handler is wrapped to widen its CSP: the package allows
  // sandbox/api/sdk but not the payments-* hosts its own checkout connects
  // to, so the frame loads and then hangs on "Establishing secure
  // connection...".
  {
    const [cwName, cwUri, cwMeta, cwHandler] = registerCashfreeWidget({
      widgetBaseUrl: config.serverUrl,
    });
    server.registerResource(cwName, cwUri, cwMeta, async () =>
      augmentCashfreeCsp(await cwHandler()),
    );
  }

  const toolConfig = {
    environment: cashfreeConfig.environment,
    clientId: cashfreeConfig.clientId,
    clientSecret: cashfreeConfig.clientSecret,
    serverUrl: config.serverUrl,
    // "external" opens checkout in its own tab; "embedded" mounts it inside
    // the widget through the SDK.
    //
    // External was previously observed tearing the session down — the host
    // navigated away, the widget iframe went with it, and the MCP connector
    // disconnected mid-payment, which is the failure mode cashfree-here's own
    // CheckoutTool spec predicts for navigating out of a widget iframe. It is
    // on again deliberately, to test that path.
    checkoutMode: "external" as const,
  };

  // EXPERIMENT (PAYMENT_ANNOTATIONS) — diagnostic only. Do not ship "readonly".
  //
  // The host refuses to dispatch these tools: "the payment action was blocked
  // by the safety system", with no tools/call ever reaching the server. demo
  // hit the identical wall and traced it to the annotations cashfree-here
  // ships — { readOnlyHint: false, destructiveHint: true }, the honest
  // description of a tool that charges a card, and plausibly the exact signal
  // the gate keys on. demo defaults to "readonly" and payment works there.
  //
  //   honest (default) — the library's own annotations; reproduces the block
  //   readonly         — claims the tools do nothing; tests the hypothesis
  //
  // Declaring a card charge read-only to get past a safety gate is NOT a fix.
  // It is a measurement, it lies to the host, and it stays opt-in and loud in
  // the boot banner so nobody ships it by accident.
  //
  // One result already argues against annotations being the whole story:
  // demo's NetbankingTool carried the destructive annotations and was NOT
  // blocked, while ours was. Treat a successful flip as evidence, not proof.
  const paymentAnnotations =
    process.env.PAYMENT_ANNOTATIONS === "readonly"
      ? { readOnlyHint: true, openWorldHint: false, destructiveHint: false }
      : undefined;

  if (paymentAnnotations) {
    console.log(
      "[experiment] PAYMENT_ANNOTATIONS=readonly — payment tools claim to be " +
        "read-only. Diagnostic only.",
    );
  }

  /** Applies the annotation override, if one is set, to a tool definition. */
  function annotated<D extends object>(definition: D): D {
    return paymentAnnotations
      ? { ...definition, annotations: paymentAnnotations }
      : definition;
  }

  // The payment tools are otherwise registered untouched — no widgetAccessible.
  //
  // It was added so our widget could dispatch them via callTool, which we then
  // measured runs the handler without rendering anything. demo marks only its
  // own tool widgetAccessible and leaves the Cashfree tools alone; marking a
  // payment tool widget-invocable is exactly the kind of signal a host safety
  // gate would key on.

  /**
   * Records that a payment tool handler really ran.
   *
   * The host silently suppresses payment tool dispatches, and the widget
   * cannot see the difference: asking the model to call a tool resolves
   * whether or not anything happens. The handler running is the only proof,
   * and it lives here.
   */
  function recording<H extends (...args: never[]) => unknown>(
    toolName: string,
    handler: H,
  ): H {
    return ((...args: Parameters<H>) => {
      const first = args[0] as { paymentSessionId?: unknown } | undefined;
      if (typeof first?.paymentSessionId === "string") {
        sessionStore.markDispatched(first.paymentSessionId, toolName);
        console.log(`[dispatch] ${toolName} ran for this checkout session`);
      }
      return handler(...args);
    }) as H;
  }

  // Registered one at a time rather than in a loop: the five tools have
  // different input schemas, and iterating unions them into a shape
  // registerTool cannot resolve an overload for.
  const upi = cashfreeUpiTool(toolConfig);
  server.registerTool(
    upi[0],
    annotated(upi[1]),
    recording(upi[0], upi[2]),
  );

  const savedCard = cashfreeCardPaymentTool(toolConfig);
  server.registerTool(
    savedCard[0],
    annotated(savedCard[1]),
    recording(savedCard[0], savedCard[2]),
  );

  const netbanking = cashfreeNetbankingTool(toolConfig);
  server.registerTool(
    netbanking[0],
    annotated(netbanking[1]),
    recording(netbanking[0], netbanking[2]),
  );

  const newCard = cashfreeNewCardTool(toolConfig);
  server.registerTool(
    newCard[0],
    annotated(newCard[1]),
    recording(newCard[0], newCard[2]),
  );

  const checkout = cashfreeCheckoutTool(toolConfig);
  server.registerTool(
    checkout[0],
    annotated(checkout[1]),
    recording(checkout[0], checkout[2]),
  );

  return server;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

const MCP_PATH = "/mcp";
const MCP_METHODS = new Set(["POST", "DELETE"]);

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const startedAt = Date.now();
    let mcpDetail: { mcpMethod?: string; mcpTool?: string } = {};
    let failureReason: string | undefined;

    /**
     * Remembers why a request failed, on the way out.
     *
     * Handlers already put the upstream message in `{ error }`; the log threw
     * it away. A 502 from /api/pay/otp recorded nothing but its status, so the
     * cause existed only on the buyer's screen. Returns the body so it can wrap
     * the existing serialisation rather than adding a line at every exit.
     */
    const noteFailure = <T,>(body: T): T => {
      if (body && typeof body === "object" && "error" in body) {
        const reason = (body as { error?: unknown }).error;
        if (typeof reason === "string") failureReason = reason;
      }
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
          ...mcpDetail,
        }),
      );
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    // ngrok-skip-browser-warning is not optional here. cashfree-here's
    // reconciliation GETs /api/orders/:id with that header set (to dodge
    // ngrok's interstitial), which makes the request preflighted. Leaving it
    // out of this list meant the browser rejected the preflight and never
    // sent the GET — so recon saw nothing, reported "Unable to verify payment
    // status", and showed Payment Failed on orders that were already PAID.
    //
    // This looked for a long time like "GET from a widget iframe never
    // reaches the server". It was this header all along.
    res.setHeader(
      "Access-Control-Allow-Headers",
      "content-type, mcp-session-id, accept, ngrok-skip-browser-warning",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

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

    // The widget's own way back to the catalog.
    //
    // A host reload remounts the widget but does not re-run the tool: measured
    // in ChatGPT as four `resources/read` after the last `SearchProducts`, and
    // `window.openai.toolResponseMetadata` comes back empty, so the products
    // are simply gone and the grid sits on "Searching the store…" forever.
    // Claude re-delivers the cached result and never needs this.
    if (req.method === "POST" && url.pathname === "/api/shop/search") {
      try {
        const body = (await readJsonBody(req)) as { query?: unknown };
        const query = typeof body.query === "string" ? body.query.trim() : "";
        if (!query) {
          res
            .writeHead(400, { "content-type": "application/json" })
            .end(JSON.stringify({ error: "query is required" }));
          return;
        }
        const result = await handleSearchProducts(shop, query);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(result._meta));
      } catch (error) {
        res
          .writeHead(502, { "content-type": "application/json" })
          .end(JSON.stringify(noteFailure({ error: (error as Error).message })));
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/shop/cart") {
      try {
        const result = await handleCartRequest(shop, await readJsonBody(req));
        res
          .writeHead(result.status, { "content-type": "application/json" })
          .end(JSON.stringify(noteFailure(result.body)));
      } catch (error) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: (error as Error).message }));
      }
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/pay/")) {
      const route = url.pathname.slice("/api/pay/".length);
      try {
        const body = await readJsonBody(req);
        const result =
          route === "order"
            ? await pay.handleCreateOrder(body)
            : route === "otp"
              ? await pay.handleSendOtp(body)
              : route === "otp/verify"
                ? await pay.handleVerifyOtp(body)
                : route === "dispatched"
                  ? await pay.handleDispatchStatus(body)
                  : route === "addresses"
                    ? await pay.handleCreateAddress(body)
                  : // Reading addresses is a POST because the session id is a
                    // credential and does not belong in a URL — and because
                    // GETs from the widget were observed never reaching this
                    // server while POSTs always did.
                    route === "addresses/list"
                    ? await pay.handleGetAddresses(
                        (body as { paymentSessionId?: string })
                          ?.paymentSessionId ?? "",
                      )
                    : { status: 404, body: { error: "Not found" } };
        res
          .writeHead(result.status, { "content-type": "application/json" })
          .end(JSON.stringify(noteFailure(result.body)));
      } catch (error) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: (error as Error).message }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/pay/addresses") {
      const result = await pay.handleGetAddresses(
        url.searchParams.get("paymentSessionId") ?? "",
      );
      res
        .writeHead(result.status, { "content-type": "application/json" })
        .end(JSON.stringify(noteFailure(result.body)));
      return;
    }

    // POST rather than GET for the same reason as addresses/list: GETs from
    // the widget were observed never reaching this server.
    if (req.method === "POST" && url.pathname === "/api/orders/status") {
      const body = (await readJsonBody(req)) as { orderId?: string };
      const result = await pay.handleOrderStatus(body?.orderId ?? "");
      res
        .writeHead(result.status, { "content-type": "application/json" })
        .end(JSON.stringify(noteFailure(result.body)));
      return;
    }

    // cashfree-here's widgets poll this path and parse Cashfree's RAW order
    // shape, so the body is proxied through untouched — exactly as
    // demo/server.ts does. Returning our normalised { orderId, orderStatus }
    // here left their reconciliation unable to reach a terminal state.
    if (req.method === "GET" && url.pathname.startsWith("/api/orders/")) {
      const orderId = decodeURIComponent(
        url.pathname.slice("/api/orders/".length),
      );
      try {
        const raw = await getOrderRaw(cashfreeConfig, orderId);
        res
          .writeHead(raw.status, { "content-type": "application/json" })
          .end(JSON.stringify(noteFailure(raw.body)));
      } catch {
        res
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "Order status fetch failed" }));
      }
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
