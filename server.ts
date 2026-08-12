import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

const config = loadConfig();
const shop = createShopService(
  createUcpClient({
    shopDomain: config.shopDomain,
    agentProfile: config.agentProfile,
  }),
);

const WIDGET_URI = "ui://widget/shopify-store.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

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
  <script>window.__SERVER_URL__ = ${JSON.stringify(config.serverUrl)};</script>
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
      const connectDomains = [config.serverUrl, "https://*.ngrok-free.app"];
      return {
        contents: [
          {
            uri: WIDGET_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: loadWidgetHtml(),
            _meta: {
              "openai/widgetPrefersBorder": true,
              "openai/widgetDescription":
                "Browse a Shopify store's catalog and build a cart",
              "openai/widgetCSP": {
                connect_domains: connectDomains,
                // Product images are served from Shopify's CDN. Without this
                // the grid renders with every image blocked.
                resource_domains: ["https://cdn.shopify.com"],
                frame_domains: [],
                // The Checkout button opens the store's hosted checkout.
                redirect_domains: [
                  `https://${config.shopDomain}`,
                  "https://checkout.shopify.com",
                ],
              },
              ui: { csp: { connectDomains } },
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
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
      },
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
        // ChatGPT delivers _meta to the widget and hides it from the model.
        _meta: { ...result._meta, "openai/outputTemplate": WIDGET_URI },
      };
    },
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

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "content-type, mcp-session-id",
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

    if (req.method === "POST" && url.pathname === "/api/shop/cart") {
      try {
        const result = await handleCartRequest(shop, await readJsonBody(req));
        res
          .writeHead(result.status, { "content-type": "application/json" })
          .end(JSON.stringify(result.body));
      } catch (error) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: (error as Error).message }));
      }
      return;
    }

    if (url.pathname === MCP_PATH && req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createStoreServer();
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, await readJsonBody(req));
      return;
    }

    res.writeHead(404).end("Not Found");
  },
);

httpServer.listen(config.port, () => {
  console.log(`Shopify MCP demo on http://localhost:${config.port}${MCP_PATH}`);
  console.log(`Store: ${config.shopDomain}`);
});
