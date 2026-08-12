# Shopify UCP Storefront MCP App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP App that lets a user browse a live Shopify store's catalog from inside ChatGPT/Claude, build a cart, and open Shopify's hosted checkout — where the merchant's existing Cashfree integration takes the payment.

**Architecture:** A Node HTTP server serves three things on one port: the MCP endpoint (`/mcp`) with one model-facing tool and one widget resource, a JSON route (`/api/shop/cart`) the widget calls directly, and the built widget bundle. The server is also an MCP *client*, speaking JSON-RPC over HTTP POST to `https://{SHOP_DOMAIN}/api/ucp/mcp`. The React widget renders two screens (Results, Cart) and ends by opening Shopify's `continue_url` in a popup.

**Tech Stack:** TypeScript, React 18, Vite 7, Tailwind 4, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `@openai/apps-sdk-ui`, `zod`, esbuild (server bundle), vitest + Testing Library (tests).

**Reference implementations** (read-only — do not modify):
- `/Users/kishankumarmaurya/Development/AI/demo` — the widget + server pattern this mirrors
- `/Users/kishankumarmaurya/Development/AI/cashfree-here` — the vitest setup this mirrors

**Spec:** `docs/superpowers/specs/2026-08-12-shopify-mcp-demo-design.md`

## Global Constraints

- **Target `/api/ucp/mcp` only.** `/api/mcp` is deprecated after **2026-08-31**. No legacy calls, no fallback path.
- **Every UCP call carries `meta["ucp-agent"].profile`.** It is in the `required` array of every UCP tool schema.
- **Cart line items use `line_items[].item.id`** with a `gid://shopify/ProductVariant/...` value. Not `merchandise_id`, not `product_variant_id`.
- **`update_cart` is declarative.** Send the complete desired `line_items` array every time; the response is the resulting cart. Never send deltas.
- **UCP money is minor units as integers**, with `currency` held once at cart level (`120000` + `"INR"` = ₹1,200.00). Normalise at the client boundary; raw amounts never reach a component.
- **The hosted checkout URL is `continue_url`** on the cart object.
- **Cart mutations are server-authoritative.** Re-render from the `update_cart` response. Never mutate cart state locally first.
- **`window.open` runs synchronously inside the click handler.** No `await` before it.
- **No Cashfree code in this milestone.** No `cashfree-here` dependency, no order creation, no payment SDK.
- **The widget never asserts a payment outcome.** Terminal state is "Checkout opened in a new tab" and nothing more.
- **Every zod tool schema uses `.passthrough()`.**
- Node 20+. Package name `shopify-mcp-demo`. `type: "module"`.

---

### Task 1: Project scaffold and test harness

Sets up the repo so every later task has a working `npm test`. No product code.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `index.html`, `.env`, `.env.example`, `src/main.css`, `src/index.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "shopify-mcp-demo",
  "version": "1.0.0",
  "description": "Shopify UCP storefront as an MCP App",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "npm run build:widget && npm run build:server",
    "build:widget": "vite build",
    "build:server": "esbuild server.ts --bundle --format=esm --outfile=dist/server.js --platform=node --packages=external",
    "start": "node --env-file=.env dist/server.js",
    "dev": "vite",
    "test": "vitest",
    "test:run": "vitest run",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/ext-apps": "^1.0.1",
    "@modelcontextprotocol/sdk": "^1.25.3",
    "@openai/apps-sdk-ui": "^0.2.1",
    "@tailwindcss/vite": "^4.1.18",
    "@vitejs/plugin-react": "^5.1.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "vite": "^7.3.1",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.3",
    "@types/node": "^22.10.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "esbuild": "^0.24.0",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4.1.18",
    "typescript": "^5.7.0",
    "vitest": "^3.2.7"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "server.ts", "*.config.ts"]
}
```

`"strict": true` is not negotiable — an `any` in the UCP normalisation layer is exactly where a Shopify shape change would slip through unnoticed.

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/widget",
    rollupOptions: {
      output: {
        entryFileNames: "widget.js",
        chunkFileNames: "widget-[name].js",
        assetFileNames: "widget.[ext]",
      },
    },
  },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 5: Create `vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Shopify Store Widget</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Copy `src/main.css` verbatim from the reference demo**

```bash
mkdir -p src
cp /Users/kishankumarmaurya/Development/AI/demo/src/main.css src/main.css
```

This file wires Tailwind to the Apps SDK CSS variables and carries a comment
block explaining why every `var()` needs a fallback. Rewriting it from scratch
would mean rediscovering that the hard way.

- [ ] **Step 8: Create `.env.example` and `.env`**

```bash
cat > .env.example <<'ENVEOF'
# The entire store configuration. Swap stores by editing this line and restarting.
SHOP_DOMAIN=sbox-mukul-store.myshopify.com

# UCP agent profile URI, required on every /api/ucp/mcp call.
# This is Shopify's public example profile — fine for a demo, replace for production.
UCP_AGENT_PROFILE=https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json

PORT=8787

# Set when tunnelling (ngrok) so the widget calls the public origin.
# SERVER_URL=https://your-tunnel.ngrok-free.app
ENVEOF
cp .env.example .env
```

- [ ] **Step 9: Create a placeholder `src/index.tsx` so the build resolves**

```tsx
import "./main.css";

// Replaced in Task 8 with the real host bridge and router.
export {};
```

- [ ] **Step 10: Install and verify the harness runs**

Run: `npm install && npx vitest run`
Expected: vitest starts and reports **"No test files found"** — exit code 1 with that message is the pass condition here. A module-resolution or config error is a failure.

Run: `npm run type-check`
Expected: exit 0, no output.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold project, vitest harness, and env config"
```

---

### Task 2: Capture live fixtures and define internal types

Everything downstream is typed from real captured payloads, not from the docs — the docs were wrong about the endpoint split, the field names, and the tool locations.

**Files:**
- Create: `src/lib/ucp/__fixtures__/search-catalog.json`, `src/lib/ucp/__fixtures__/cart.json`, `src/lib/ucp/types.ts`
- Test: `src/lib/ucp/types.test.ts`

**Interfaces:**
- Produces: `Money`, `Variant`, `Product`, `CartLine`, `Cart`, `RawSearchResponse`, `RawCart` — consumed by Tasks 3, 4, 5, 6, 9, 10.

- [ ] **Step 1: Capture the search fixture from the live store**

```bash
mkdir -p src/lib/ucp/__fixtures__
PROFILE='https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json'
curl -s -X POST https://sbox-mukul-store.myshopify.com/api/ucp/mcp \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"id\":1,\"params\":{\"name\":\"search_catalog\",\"arguments\":{\"meta\":{\"ucp-agent\":{\"profile\":\"$PROFILE\"}},\"catalog\":{\"query\":\"shirt\"},\"pagination\":{\"limit\":3}}}}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);process.stdout.write(JSON.stringify(JSON.parse(r.result.content[0].text),null,2))})" \
  > src/lib/ucp/__fixtures__/search-catalog.json
```

Note this stores the **inner** payload — the already-unwrapped object, not the JSON-RPC envelope. Task 3 tests the unwrapping separately with a hand-built envelope; the normalisation tests want the payload itself.

- [ ] **Step 2: Capture the cart fixture**

```bash
PROFILE='https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json'
VARIANT=$(node -e "const p=require('./src/lib/ucp/__fixtures__/search-catalog.json');console.log(p.products[0].variants[0].id)")
curl -s -X POST https://sbox-mukul-store.myshopify.com/api/ucp/mcp \
  -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"id\":1,\"params\":{\"name\":\"create_cart\",\"arguments\":{\"meta\":{\"ucp-agent\":{\"profile\":\"$PROFILE\"}},\"cart\":{\"line_items\":[{\"item\":{\"id\":\"$VARIANT\"},\"quantity\":2}]}}}}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);process.stdout.write(JSON.stringify(JSON.parse(r.result.content[0].text),null,2))})" \
  > src/lib/ucp/__fixtures__/cart.json
```

- [ ] **Step 3: Verify both fixtures have the shape the plan assumes**

```bash
node -e "
const s=require('./src/lib/ucp/__fixtures__/search-catalog.json');
const c=require('./src/lib/ucp/__fixtures__/cart.json');
const v=s.products[0].variants[0];
console.log('products:', s.products.length);
console.log('variant has id/price/availability:', !!v.id, !!v.price.amount, typeof v.availability.available);
console.log('cart continue_url:', typeof c.continue_url);
console.log('cart currency:', c.currency);
console.log('line item price is bare int:', typeof c.line_items[0].item.price);
"
```

Expected: products > 0, all `true`, `continue_url` is `string`, currency `INR`, line item price `number`.

**If any assertion fails, stop and report — do not adjust the types to match a broken capture.**

- [ ] **Step 4: Write the failing test**

Create `src/lib/ucp/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import searchFixture from "./__fixtures__/search-catalog.json";
import cartFixture from "./__fixtures__/cart.json";
import type { RawSearchResponse, RawCart } from "./types";

describe("UCP fixtures match declared raw types", () => {
  it("search fixture satisfies RawSearchResponse", () => {
    const parsed = searchFixture as RawSearchResponse;
    expect(parsed.products.length).toBeGreaterThan(0);
    const variant = parsed.products[0].variants[0];
    expect(typeof variant.id).toBe("string");
    expect(typeof variant.price.amount).toBe("number");
    expect(typeof variant.price.currency).toBe("string");
    expect(typeof variant.availability.available).toBe("boolean");
  });

  it("cart fixture satisfies RawCart", () => {
    const parsed = cartFixture as RawCart;
    expect(typeof parsed.id).toBe("string");
    expect(typeof parsed.continue_url).toBe("string");
    expect(typeof parsed.currency).toBe("string");
    expect(typeof parsed.line_items[0].item.price).toBe("number");
    expect(parsed.totals.some((t) => t.type === "total")).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/lib/ucp/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 6: Write `src/lib/ucp/types.ts`**

```ts
// ─── Raw UCP wire types ──────────────────────────────────────────────────────
// Hand-written from captured fixtures, not from shopify.dev. The published
// docs were wrong about the endpoint split, the tool locations, and the cart
// line-item field name, so the live payloads are the only source of truth.
//
// Note the asymmetry: catalog prices are { amount, currency } objects, while
// cart line-item prices are bare integers with currency held once on the cart.
// That is not a transcription slip — it is what the server sends.

export interface RawMoney {
  amount: number;
  currency: string;
}

export interface RawMedia {
  type: string;
  url: string;
}

export interface RawVariant {
  id: string;
  title: string;
  price: RawMoney;
  availability: { available: boolean };
  options?: { name: string; label: string }[];
  media?: RawMedia[];
}

export interface RawProduct {
  id: string;
  title: string;
  description?: { html?: string };
  price_range?: { min: RawMoney; max: RawMoney };
  variants: RawVariant[];
  media?: RawMedia[];
}

export interface RawSearchResponse {
  products: RawProduct[];
}

export interface RawTotal {
  type: string;
  amount: number;
  display_text: string;
}

export interface RawCartLine {
  id: string;
  quantity: number;
  item: {
    id: string;
    title: string;
    price: number;
    image_url?: string;
  };
  totals: RawTotal[];
}

export interface RawCart {
  id: string;
  currency: string;
  line_items: RawCartLine[];
  totals: RawTotal[];
  continue_url: string;
}

// ─── Internal types ──────────────────────────────────────────────────────────
// What the server hands the widget. Money is always one shape here.

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Variant {
  id: string;
  title: string;
  price: Money;
  available: boolean;
  imageUrl?: string;
}

export interface Product {
  id: string;
  title: string;
  imageUrl?: string;
  variants: Variant[];
}

export interface CartLine {
  lineId: string;
  variantId: string;
  title: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface Cart {
  cartId: string;
  currency: string;
  lines: CartLine[];
  total: Money;
  continueUrl: string;
}

/** What the widget posts to /api/shop/cart. */
export interface CartRequest {
  cartId?: string;
  lines: { variantId: string; quantity: number }[];
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/lib/ucp/types.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: capture live UCP fixtures and define wire + internal types"
```

---

### Task 3: UCP JSON-RPC client

The only file that knows MCP returns tool results as a JSON *string* nested inside the envelope.

**Files:**
- Create: `src/lib/ucp/client.ts`
- Test: `src/lib/ucp/client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createUcpClient(config: UcpConfig): UcpClient` where `UcpConfig = { shopDomain: string; agentProfile: string; timeoutMs?: number }` and `UcpClient = { call(toolName: string, args: Record<string, unknown>): Promise<unknown> }`. Also exports `UcpError`. Consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ucp/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createUcpClient, UcpError } from "./client";

const CONFIG = {
  shopDomain: "test-store.myshopify.com",
  agentProfile: "https://example.test/profile.json",
};

function envelope(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
    }),
  };
}

describe("createUcpClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a JSON-RPC envelope to the UCP endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ ok: 1 }) as never);
    const client = createUcpClient(CONFIG);

    await client.call("search_catalog", { catalog: { query: "shirt" } });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://test-store.myshopify.com/api/ucp/mcp");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("search_catalog");
    expect(body.params.arguments.catalog).toEqual({ query: "shirt" });
  });

  it("injects the ucp-agent profile into every call", async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ ok: 1 }) as never);
    const client = createUcpClient(CONFIG);

    await client.call("create_cart", { cart: { line_items: [] } });

    const body = JSON.parse(
      vi.mocked(fetch).mock.calls[0][1]?.body as string,
    );
    expect(body.params.arguments.meta["ucp-agent"].profile).toBe(
      "https://example.test/profile.json",
    );
  });

  it("double-unwraps result.content[0].text into an object", async () => {
    vi.mocked(fetch).mockResolvedValue(
      envelope({ products: [{ id: "gid://x" }] }) as never,
    );
    const client = createUcpClient(CONFIG);

    const result = await client.call("search_catalog", {});

    expect(result).toEqual({ products: [{ id: "gid://x" }] });
  });

  it("throws UcpError carrying Shopify's own message when isError is set", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            { type: "text", text: "Invalid arguments: missing product_variant_id" },
          ],
          isError: true,
        },
      }),
    } as never);
    const client = createUcpClient(CONFIG);

    await expect(client.call("update_cart", {})).rejects.toThrow(
      "Invalid arguments: missing product_variant_id",
    );
    await expect(client.call("update_cart", {})).rejects.toBeInstanceOf(UcpError);
  });

  it("throws when the HTTP request itself fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    } as never);
    const client = createUcpClient(CONFIG);

    await expect(client.call("search_catalog", {})).rejects.toThrow(/404/);
  });

  it("throws when the network rejects", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createUcpClient(CONFIG);

    await expect(client.call("search_catalog", {})).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("surfaces a JSON-RPC protocol error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }),
    } as never);
    const client = createUcpClient(CONFIG);

    await expect(client.call("nope", {})).rejects.toThrow("Method not found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ucp/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Write `src/lib/ucp/client.ts`**

```ts
export interface UcpConfig {
  shopDomain: string;
  agentProfile: string;
  timeoutMs?: number;
}

export interface UcpClient {
  call(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** A failure reported by Shopify, as opposed to a transport failure. */
export class UcpError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
  ) {
    super(message);
    this.name = "UcpError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createUcpClient(config: UcpConfig): UcpClient {
  const endpoint = `https://${config.shopDomain}/api/ucp/mcp`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let nextId = 1;

  async function call(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const body = {
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {
          // Required by every UCP tool schema. Injected here so no caller can
          // forget it.
          meta: { "ucp-agent": { profile: config.agentProfile } },
          ...args,
        },
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new UcpError(
        `Shopify returned ${response.status} for ${toolName}${text ? `: ${text}` : ""}`,
        toolName,
      );
    }

    const envelope = (await response.json()) as {
      error?: { message: string };
      result?: {
        content?: { type: string; text: string }[];
        isError?: boolean;
      };
    };

    if (envelope.error) {
      throw new UcpError(envelope.error.message, toolName);
    }

    const text = envelope.result?.content?.[0]?.text;
    if (text === undefined) {
      throw new UcpError(`Empty response from ${toolName}`, toolName);
    }

    // Shopify reports tool-level failures as isError with a human-readable
    // string in the same content slot — not as JSON, and not as a JSON-RPC
    // error. Its validation messages are specific and worth surfacing intact.
    if (envelope.result?.isError) {
      throw new UcpError(text, toolName);
    }

    // MCP nests the payload as a JSON *string* inside the envelope, so every
    // successful response needs two parses. This is the reason this file exists.
    try {
      return JSON.parse(text);
    } catch {
      throw new UcpError(
        `${toolName} returned a non-JSON payload: ${text.slice(0, 200)}`,
        toolName,
      );
    }
  }

  return { call };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ucp/client.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add UCP JSON-RPC client with envelope double-unwrap"
```

---

### Task 4: Normalisation and money formatting

The single boundary where UCP's two money shapes become one, and where a currency's decimal count is decided.

**Files:**
- Create: `src/lib/ucp/normalise.ts`
- Test: `src/lib/ucp/normalise.test.ts`

**Interfaces:**
- Consumes: types from Task 2.
- Produces: `normaliseProducts(raw: unknown): Product[]`, `normaliseCart(raw: unknown): Cart`, `formatMoney(money: Money): string`. Consumed by Tasks 5, 6, 9, 10.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ucp/normalise.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normaliseProducts, normaliseCart, formatMoney } from "./normalise";
import searchFixture from "./__fixtures__/search-catalog.json";
import cartFixture from "./__fixtures__/cart.json";

describe("formatMoney", () => {
  it("renders INR minor units as major units", () => {
    expect(formatMoney({ amountMinor: 120000, currency: "INR" })).toContain(
      "1,200.00",
    );
  });

  it("does not divide zero-decimal currencies", () => {
    // 5000 JPY is ¥5,000 — not ¥50. Dividing by 100 unconditionally is the
    // classic money bug and this test is the guard against it.
    expect(formatMoney({ amountMinor: 5000, currency: "JPY" })).toContain(
      "5,000",
    );
    expect(formatMoney({ amountMinor: 5000, currency: "JPY" })).not.toContain(
      "50.00",
    );
  });

  it("renders zero", () => {
    expect(formatMoney({ amountMinor: 0, currency: "INR" })).toContain("0.00");
  });
});

describe("normaliseProducts", () => {
  it("maps the live fixture into internal products", () => {
    const products = normaliseProducts(searchFixture);

    expect(products.length).toBeGreaterThan(0);
    const first = products[0];
    expect(first.id).toMatch(/^gid:\/\/shopify\/Product\//);
    expect(typeof first.title).toBe("string");
    expect(first.variants.length).toBeGreaterThan(0);
  });

  it("carries variant id, price and availability", () => {
    const variant = normaliseProducts(searchFixture)[0].variants[0];

    expect(variant.id).toMatch(/^gid:\/\/shopify\/ProductVariant\//);
    expect(variant.price.amountMinor).toBeGreaterThan(0);
    expect(variant.price.currency).toBe("INR");
    expect(typeof variant.available).toBe("boolean");
  });

  it("falls back to product-level media when a variant has none", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          media: [{ type: "image", url: "https://cdn.test/p.jpg" }],
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 100, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    const [product] = normaliseProducts(raw);

    expect(product.imageUrl).toBe("https://cdn.test/p.jpg");
    expect(product.variants[0].imageUrl).toBe("https://cdn.test/p.jpg");
  });

  it("marks unavailable variants rather than dropping them", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          variants: [
            {
              id: "v1",
              title: "Sold out",
              price: { amount: 100, currency: "INR" },
              availability: { available: false },
            },
          ],
        },
      ],
    };

    const [product] = normaliseProducts(raw);

    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].available).toBe(false);
  });

  it("returns an empty array when the store matched nothing", () => {
    expect(normaliseProducts({ products: [] })).toEqual([]);
  });

  it("throws when the payload has no products key", () => {
    expect(() => normaliseProducts({ nope: true })).toThrow(
      /unexpected search payload/i,
    );
  });
});

describe("normaliseCart", () => {
  it("maps the live fixture into an internal cart", () => {
    const cart = normaliseCart(cartFixture);

    expect(cart.cartId).toMatch(/^gid:\/\/shopify\/Cart\//);
    expect(cart.continueUrl).toMatch(/^https:\/\//);
    expect(cart.currency).toBe("INR");
    expect(cart.lines.length).toBeGreaterThan(0);
  });

  it("applies cart-level currency to bare line-item prices", () => {
    const cart = normaliseCart(cartFixture);
    const line = cart.lines[0];

    expect(line.unitPrice.currency).toBe("INR");
    expect(line.unitPrice.amountMinor).toBeGreaterThan(0);
    expect(line.variantId).toMatch(/^gid:\/\/shopify\/ProductVariant\//);
  });

  it("reads the total from the totals array entry typed 'total'", () => {
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [],
      totals: [
        { type: "subtotal", amount: 100, display_text: "Subtotal" },
        { type: "total", amount: 150, display_text: "Total" },
      ],
    };

    expect(normaliseCart(raw).total.amountMinor).toBe(150);
  });

  it("falls back to zero when no total entry is present", () => {
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [],
      totals: [],
    };

    expect(normaliseCart(raw).total).toEqual({
      amountMinor: 0,
      currency: "INR",
    });
  });

  it("throws when continue_url is missing", () => {
    // Without it the Checkout button has no target, and a cart we cannot check
    // out of is worse than an error.
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      line_items: [],
      totals: [],
    };

    expect(() => normaliseCart(raw)).toThrow(/continue_url/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ucp/normalise.test.ts`
Expected: FAIL — cannot resolve `./normalise`.

- [ ] **Step 3: Write `src/lib/ucp/normalise.ts`**

```ts
import type {
  Cart,
  CartLine,
  Money,
  Product,
  RawCart,
  RawProduct,
  RawSearchResponse,
  Variant,
} from "./types";

/**
 * Format money for display. The decimal count comes from Intl rather than a
 * hardcoded 100, so zero-decimal currencies (JPY, KRW, VND) are not silently
 * divided into a hundredth of their real value.
 */
export function formatMoney(money: Money, locale = "en-IN"): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(money.amountMinor / 10 ** digits);
}

function firstImage(media: { url: string }[] | undefined): string | undefined {
  return media?.[0]?.url;
}

function normaliseVariant(
  raw: RawProduct["variants"][number],
  productImage: string | undefined,
): Variant {
  return {
    id: raw.id,
    title: raw.title,
    price: { amountMinor: raw.price.amount, currency: raw.price.currency },
    available: raw.availability?.available ?? false,
    imageUrl: firstImage(raw.media) ?? productImage,
  };
}

export function normaliseProducts(raw: unknown): Product[] {
  const payload = raw as RawSearchResponse;
  if (!payload || !Array.isArray(payload.products)) {
    throw new Error("Unexpected search payload: no products array");
  }

  return payload.products.map((product) => {
    const productImage = firstImage(product.media);
    return {
      id: product.id,
      title: product.title,
      imageUrl: productImage,
      variants: (product.variants ?? []).map((v) =>
        normaliseVariant(v, productImage),
      ),
    };
  });
}

export function normaliseCart(raw: unknown): Cart {
  const payload = raw as RawCart;
  if (!payload || typeof payload.id !== "string") {
    throw new Error("Unexpected cart payload: no cart id");
  }
  if (typeof payload.continue_url !== "string") {
    throw new Error(
      "Unexpected cart payload: continue_url missing — nothing to check out to",
    );
  }

  const currency = payload.currency;

  const lines: CartLine[] = (payload.line_items ?? []).map((line) => {
    const unitMinor = line.item.price;
    return {
      lineId: line.id,
      variantId: line.item.id,
      title: line.item.title,
      imageUrl: line.item.image_url,
      quantity: line.quantity,
      // Cart line prices arrive as bare integers; the currency lives once on
      // the cart. Rejoining them here is the whole point of this function.
      unitPrice: { amountMinor: unitMinor, currency },
      lineTotal: {
        amountMinor:
          line.totals?.find((t) => t.type === "total")?.amount ??
          unitMinor * line.quantity,
        currency,
      },
    };
  });

  const totalMinor =
    payload.totals?.find((t) => t.type === "total")?.amount ?? 0;

  return {
    cartId: payload.id,
    currency,
    lines,
    total: { amountMinor: totalMinor, currency },
    continueUrl: payload.continue_url,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ucp/normalise.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: normalise UCP payloads and format money by currency decimals"
```

---

### Task 5: Shop service — search and cart operations

Wraps the client with the three UCP calls this milestone needs, so neither the tool handler nor the HTTP route builds UCP arguments by hand.

**Files:**
- Create: `src/lib/ucp/shop.ts`
- Test: `src/lib/ucp/shop.test.ts`

**Interfaces:**
- Consumes: `createUcpClient`, `UcpClient` (Task 3); `normaliseProducts`, `normaliseCart` (Task 4); types (Task 2).
- Produces: `createShopService(client: UcpClient): ShopService` where `ShopService = { searchProducts(query: string): Promise<Product[]>; saveCart(request: CartRequest): Promise<Cart> }`. Consumed by Tasks 6 and 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ucp/shop.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createShopService } from "./shop";
import searchFixture from "./__fixtures__/search-catalog.json";
import cartFixture from "./__fixtures__/cart.json";
import type { UcpClient } from "./client";

function fakeClient(payload: unknown): UcpClient & {
  call: ReturnType<typeof vi.fn>;
} {
  return { call: vi.fn().mockResolvedValue(payload) };
}

describe("searchProducts", () => {
  it("calls search_catalog with the query", async () => {
    const client = fakeClient(searchFixture);

    await createShopService(client).searchProducts("shirt");

    expect(client.call).toHaveBeenCalledWith("search_catalog", {
      catalog: { query: "shirt" },
      pagination: { limit: 12 },
    });
  });

  it("returns normalised products", async () => {
    const client = fakeClient(searchFixture);

    const products = await createShopService(client).searchProducts("shirt");

    expect(products[0].variants[0].price.currency).toBe("INR");
  });
});

describe("saveCart", () => {
  it("calls create_cart when no cartId is given", async () => {
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 2 }],
    });

    expect(client.call).toHaveBeenCalledWith("create_cart", {
      cart: {
        line_items: [
          { item: { id: "gid://shopify/ProductVariant/1" }, quantity: 2 },
        ],
      },
    });
  });

  it("calls update_cart with the id when a cartId is given", async () => {
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      cartId: "gid://shopify/Cart/abc",
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 3 }],
    });

    expect(client.call).toHaveBeenCalledWith("update_cart", {
      id: "gid://shopify/Cart/abc",
      cart: {
        line_items: [
          { item: { id: "gid://shopify/ProductVariant/1" }, quantity: 3 },
        ],
      },
    });
  });

  it("sends the complete line set, because update_cart is declarative", async () => {
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      cartId: "gid://shopify/Cart/abc",
      lines: [
        { variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
        { variantId: "gid://shopify/ProductVariant/2", quantity: 5 },
      ],
    });

    const args = client.call.mock.calls[0][1] as {
      cart: { line_items: unknown[] };
    };
    expect(args.cart.line_items).toHaveLength(2);
  });

  it("drops lines whose quantity has reached zero", async () => {
    // Removal is expressed by omitting the line, since the call replaces the
    // whole set. Sending quantity 0 is not a documented removal signal.
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      cartId: "gid://shopify/Cart/abc",
      lines: [
        { variantId: "gid://shopify/ProductVariant/1", quantity: 0 },
        { variantId: "gid://shopify/ProductVariant/2", quantity: 2 },
      ],
    });

    const args = client.call.mock.calls[0][1] as {
      cart: { line_items: { item: { id: string } }[] };
    };
    expect(args.cart.line_items).toHaveLength(1);
    expect(args.cart.line_items[0].item.id).toBe(
      "gid://shopify/ProductVariant/2",
    );
  });

  it("returns a normalised cart carrying continueUrl", async () => {
    const client = fakeClient(cartFixture);

    const cart = await createShopService(client).saveCart({
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
    });

    expect(cart.continueUrl).toMatch(/^https:\/\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ucp/shop.test.ts`
Expected: FAIL — cannot resolve `./shop`.

- [ ] **Step 3: Write `src/lib/ucp/shop.ts`**

```ts
import type { UcpClient } from "./client";
import { normaliseCart, normaliseProducts } from "./normalise";
import type { Cart, CartRequest, Product } from "./types";

/** First-page size. Pagination is out of scope for this milestone. */
const SEARCH_LIMIT = 12;

export interface ShopService {
  searchProducts(query: string): Promise<Product[]>;
  saveCart(request: CartRequest): Promise<Cart>;
}

export function createShopService(client: UcpClient): ShopService {
  async function searchProducts(query: string): Promise<Product[]> {
    const raw = await client.call("search_catalog", {
      catalog: { query },
      pagination: { limit: SEARCH_LIMIT },
    });
    return normaliseProducts(raw);
  }

  async function saveCart(request: CartRequest): Promise<Cart> {
    // update_cart replaces the entire line set, so removal is expressed by
    // omission. Filtering here keeps that rule in one place.
    const lineItems = request.lines
      .filter((line) => line.quantity > 0)
      .map((line) => ({
        item: { id: line.variantId },
        quantity: line.quantity,
      }));

    const raw = request.cartId
      ? await client.call("update_cart", {
          id: request.cartId,
          cart: { line_items: lineItems },
        })
      : await client.call("create_cart", {
          cart: { line_items: lineItems },
        });

    return normaliseCart(raw);
  }

  return { searchProducts, saveCart };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ucp/shop.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add shop service wrapping UCP search and cart calls"
```

---

### Task 6: MCP server — tool, resource, and cart route

**Files:**
- Create: `server.ts`, `src/lib/server/config.ts`, `src/lib/server/handlers.ts`
- Test: `src/lib/server/handlers.test.ts`

**Interfaces:**
- Consumes: `createShopService`, `ShopService` (Task 5); `createUcpClient` (Task 3); `UcpError` (Task 3).
- Produces: `handleSearchProducts(shop: ShopService, query: string)` returning `{ content: [{ type: "text"; text: string }]; _meta: { products: Product[] } }`; `handleCartRequest(shop: ShopService, body: unknown)` returning `{ status: number; body: unknown }`. Consumed by `server.ts` only.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/handlers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { handleSearchProducts, handleCartRequest } from "./handlers";
import { UcpError } from "../ucp/client";
import type { ShopService } from "../ucp/shop";
import type { Cart, Product } from "../ucp/types";

const PRODUCT: Product = {
  id: "gid://shopify/Product/1",
  title: "short sleeve t-shirt",
  imageUrl: "https://cdn.test/a.jpg",
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "Red",
      price: { amountMinor: 120000, currency: "INR" },
      available: true,
    },
  ],
};

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  lines: [],
  total: { amountMinor: 0, currency: "INR" },
  continueUrl: "https://store.test/cart/c/abc",
};

function fakeShop(overrides: Partial<ShopService> = {}): ShopService {
  return {
    searchProducts: vi.fn().mockResolvedValue([PRODUCT]),
    saveCart: vi.fn().mockResolvedValue(CART),
    ...overrides,
  };
}

describe("handleSearchProducts", () => {
  it("sends a short summary to the model, not the catalog", async () => {
    const result = await handleSearchProducts(fakeShop(), "shirt");

    const text = result.content[0].text;
    expect(text).toContain("1");
    expect(text).toContain("shirt");
    // The model must not receive prices — it will paraphrase them from memory.
    expect(text).not.toContain("120000");
    expect(text).not.toContain("1,200");
  });

  it("sends the full product array to the widget via _meta", async () => {
    const result = await handleSearchProducts(fakeShop(), "shirt");

    expect(result._meta.products).toEqual([PRODUCT]);
  });

  it("reports an empty result without erroring", async () => {
    const shop = fakeShop({ searchProducts: vi.fn().mockResolvedValue([]) });

    const result = await handleSearchProducts(shop, "unobtainium");

    expect(result.content[0].text).toMatch(/no products/i);
    expect(result._meta.products).toEqual([]);
  });

  it("surfaces Shopify's own message when the store rejects the call", async () => {
    const shop = fakeShop({
      searchProducts: vi
        .fn()
        .mockRejectedValue(new UcpError("Invalid arguments", "search_catalog")),
    });

    const result = await handleSearchProducts(shop, "shirt");

    expect(result.content[0].text).toContain("Invalid arguments");
    expect(result._meta.products).toEqual([]);
  });
});

describe("handleCartRequest", () => {
  it("returns 200 and the normalised cart", async () => {
    const result = await handleCartRequest(fakeShop(), {
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 2 }],
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(CART);
  });

  it("passes cartId through when present", async () => {
    const shop = fakeShop();

    await handleCartRequest(shop, {
      cartId: "gid://shopify/Cart/abc",
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
    });

    expect(shop.saveCart).toHaveBeenCalledWith({
      cartId: "gid://shopify/Cart/abc",
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
    });
  });

  it("rejects a body with no lines array", async () => {
    const result = await handleCartRequest(fakeShop(), { cartId: "x" });

    expect(result.status).toBe(400);
  });

  it("rejects a line with a non-numeric quantity", async () => {
    const result = await handleCartRequest(fakeShop(), {
      lines: [{ variantId: "v1", quantity: "two" }],
    });

    expect(result.status).toBe(400);
  });

  it("returns 502 with Shopify's message when the store rejects the cart", async () => {
    const shop = fakeShop({
      saveCart: vi
        .fn()
        .mockRejectedValue(new UcpError("Variant unavailable", "update_cart")),
    });

    const result = await handleCartRequest(shop, {
      lines: [{ variantId: "v1", quantity: 1 }],
    });

    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "Variant unavailable" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/handlers.test.ts`
Expected: FAIL — cannot resolve `./handlers`.

- [ ] **Step 3: Write `src/lib/server/handlers.ts`**

```ts
import { z } from "zod";
import { UcpError } from "../ucp/client";
import type { ShopService } from "../ucp/shop";
import type { Product } from "../ucp/types";

export interface SearchToolResult {
  content: { type: "text"; text: string }[];
  _meta: { products: Product[] };
}

const cartRequestSchema = z
  .object({
    cartId: z.string().min(1).optional(),
    lines: z.array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(0),
      }),
    ),
  })
  .passthrough();

/**
 * The model gets a one-line summary; the widget gets the catalog via _meta.
 * Sending products through the model burns context and invites it to quote
 * prices from memory instead of rendering the ones we returned.
 */
export async function handleSearchProducts(
  shop: ShopService,
  query: string,
): Promise<SearchToolResult> {
  let products: Product[] = [];
  let summary: string;

  try {
    products = await shop.searchProducts(query);
    summary =
      products.length === 0
        ? `No products matched "${query}" in this store.`
        : `Found ${products.length} product${products.length === 1 ? "" : "s"} for "${query}".`;
  } catch (error) {
    // Shopify's validation messages are specific and useful — pass them
    // through rather than replacing them with a generic failure.
    summary =
      error instanceof UcpError
        ? `Couldn't search this store: ${error.message}`
        : `Couldn't reach this store: ${(error as Error).message}`;
  }

  return {
    content: [{ type: "text", text: summary }],
    _meta: { products },
  };
}

export async function handleCartRequest(
  shop: ShopService,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const parsed = cartRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Invalid cart request", details: parsed.error.issues },
    };
  }

  try {
    const cart = await shop.saveCart({
      cartId: parsed.data.cartId,
      lines: parsed.data.lines,
    });
    return { status: 200, body: cart };
  } catch (error) {
    return { status: 502, body: { error: (error as Error).message } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/handlers.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write `src/lib/server/config.ts`**

```ts
export interface AppConfig {
  shopDomain: string;
  agentProfile: string;
  port: number;
  serverUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const shopDomain = env.SHOP_DOMAIN;
  if (!shopDomain) {
    throw new Error("SHOP_DOMAIN is required — it is the whole store config");
  }

  const agentProfile = env.UCP_AGENT_PROFILE;
  if (!agentProfile) {
    throw new Error(
      "UCP_AGENT_PROFILE is required — every UCP call must carry it",
    );
  }

  const port = Number(env.PORT ?? 8787);

  return {
    shopDomain,
    agentProfile,
    port,
    serverUrl: env.SERVER_URL || `http://localhost:${port}`,
  };
}
```

- [ ] **Step 6: Write `server.ts`**

```ts
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
    res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
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
```

- [ ] **Step 7: Verify the server boots and the cart route works end to end**

```bash
npm run build
npm start &
sleep 2
curl -s http://localhost:8787/
echo ""
VARIANT=$(node -e "console.log(require('./src/lib/ucp/__fixtures__/search-catalog.json').products[0].variants[0].id)")
curl -s -X POST http://localhost:8787/api/shop/cart \
  -H 'Content-Type: application/json' \
  -d "{\"lines\":[{\"variantId\":\"$VARIANT\",\"quantity\":2}]}" | head -c 400
kill %1
```

Expected: the root line names the store, and the cart response is JSON containing `cartId`, `total`, and a `continueUrl` beginning `https://`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add MCP server with SearchProducts tool, widget resource, and cart route"
```

---

### Task 7: Port the host bridge

The four host-integration files are proven against both ChatGPT legacy mode and MCP Apps mode. Copy them verbatim rather than reimplementing; they encode host quirks that are expensive to rediscover.

**Files:**
- Create: `src/utils/platform.ts`, `src/hooks/useOpenAiGlobal.ts`, `src/hooks/useMcpApp.ts`, `src/hooks/useHostContext.ts`, `src/hooks/useWidgetState.ts`, `src/types/index.ts`

- [ ] **Step 1: Copy the bridge files verbatim**

```bash
mkdir -p src/utils src/hooks src/types
SRC=/Users/kishankumarmaurya/Development/AI/demo/src
cp "$SRC/utils/platform.ts" src/utils/platform.ts
cp "$SRC/hooks/useOpenAiGlobal.ts" src/hooks/useOpenAiGlobal.ts
cp "$SRC/hooks/useMcpApp.ts" src/hooks/useMcpApp.ts
cp "$SRC/hooks/useHostContext.ts" src/hooks/useHostContext.ts
cp "$SRC/hooks/useWidgetState.ts" src/hooks/useWidgetState.ts
```

- [ ] **Step 2: Write `src/types/index.ts`**

Do **not** copy the reference `src/types/index.ts` — it is full of restaurant and subscription types that have nothing to do with this project. Write only what this widget needs:

```ts
import type { Cart, Product } from "../lib/ucp/types";

export type Screen = "results" | "cart";

export interface WidgetState {
  screen: Screen;
  cartId?: string;
  /** Desired quantities keyed by variant id. The server holds the real cart. */
  quantities: Record<string, number>;
  checkoutOpened?: boolean;
}

/** Delivered by the host as _meta on the SearchProducts response. */
export interface ToolResponseMetadata {
  products?: Product[];
}

export type ToolOutput = unknown;

export type { Cart, Product };
```

- [ ] **Step 3: Type-check the ported files**

Run: `npm run type-check`
Expected: exit 0.

If `platform.ts` or `useMcpApp.ts` reference a type that only existed in the reference project's `types/index.ts`, add just that type to `src/types/index.ts` — do not import the reference file and do not widen anything to `any`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: port host bridge hooks and define widget types"
```

---

### Task 8: Results screen

**Files:**
- Create: `src/components/Results.tsx`
- Test: `src/components/Results.test.tsx`

**Interfaces:**
- Consumes: `Product` (Task 2), `formatMoney` (Task 4).
- Produces: `<Results products={Product[]} query={string} onAdd={(variantId: string) => void} />`. Consumed by Task 10.

- [ ] **Step 1: Write the failing test**

Create `src/components/Results.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Results } from "./Results";
import type { Product } from "../lib/ucp/types";

const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    variants: [
      {
        id: "gid://shopify/ProductVariant/1",
        title: "Red",
        price: { amountMinor: 120000, currency: "INR" },
        available: true,
        imageUrl: "https://cdn.shopify.com/a.jpg",
      },
    ],
  },
  {
    id: "gid://shopify/Product/2",
    title: "Sold Out Hoody",
    variants: [
      {
        id: "gid://shopify/ProductVariant/2",
        title: "Black",
        price: { amountMinor: 250000, currency: "INR" },
        available: false,
      },
    ],
  },
];

describe("Results", () => {
  it("renders title, formatted price and image", () => {
    render(<Results products={PRODUCTS} query="shirt" onAdd={vi.fn()} />);

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
    expect(screen.getByText(/1,200\.00/)).toBeInTheDocument();
    expect(screen.getByAltText("short sleeve t-shirt")).toHaveAttribute(
      "src",
      "https://cdn.shopify.com/a.jpg",
    );
  });

  it("shows the variant name so the chosen option is never a surprise", () => {
    render(<Results products={PRODUCTS} query="shirt" onAdd={vi.fn()} />);

    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  it("calls onAdd with the variant id, not the product id", async () => {
    const onAdd = vi.fn();
    render(<Results products={PRODUCTS} query="shirt" onAdd={onAdd} />);

    await userEvent.click(screen.getAllByRole("button", { name: /add/i })[0]);

    expect(onAdd).toHaveBeenCalledWith("gid://shopify/ProductVariant/1");
  });

  it("disables Add for an unavailable variant", () => {
    render(<Results products={PRODUCTS} query="shirt" onAdd={vi.fn()} />);

    const buttons = screen.getAllByRole("button", { name: /add|unavailable/i });
    expect(buttons[1]).toBeDisabled();
  });

  it("renders an empty state echoing the query", () => {
    render(<Results products={[]} query="unobtainium" onAdd={vi.fn()} />);

    expect(screen.getByText(/unobtainium/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });

  it("renders a product with no image without crashing", () => {
    render(<Results products={[PRODUCTS[1]]} query="hoody" onAdd={vi.fn()} />);

    expect(screen.getByText("Sold Out Hoody")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Results.test.tsx`
Expected: FAIL — cannot resolve `./Results`.

- [ ] **Step 3: Write `src/components/Results.tsx`**

```tsx
import { formatMoney } from "../lib/ucp/normalise";
import type { Product, Variant } from "../lib/ucp/types";

interface ResultsProps {
  products: Product[];
  query: string;
  onAdd: (variantId: string) => void;
}

/**
 * Milestone 1 has no product detail screen, so a card represents its first
 * available variant — falling back to the first variant when none are in
 * stock, so the card can still render as unavailable rather than vanish.
 */
function pickVariant(product: Product): Variant | undefined {
  return product.variants.find((v) => v.available) ?? product.variants[0];
}

export function Results({ products, query, onAdd }: ResultsProps) {
  if (products.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
        <p className="text-base font-medium">No products matched “{query}”.</p>
        <p className="mt-1 text-sm text-secondary">
          Try a different search term.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
      {products.map((product) => {
        const variant = pickVariant(product);
        if (!variant) return null;

        const image = variant.imageUrl ?? product.imageUrl;

        return (
          <div
            key={product.id}
            className="flex flex-col overflow-hidden rounded-xl border border-black/10"
          >
            {image ? (
              <img
                src={image}
                alt={product.title}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="aspect-square w-full bg-black/5" />
            )}

            <div className="flex flex-1 flex-col gap-1 p-3">
              <p className="line-clamp-2 text-sm font-medium">{product.title}</p>
              {/* Naming the variant matters: with no detail screen, this is the
                  only place the user learns which option is being added. */}
              <p className="text-xs text-secondary">{variant.title}</p>
              <p className="mt-auto text-sm font-semibold">
                {formatMoney(variant.price)}
              </p>

              <button
                type="button"
                disabled={!variant.available}
                onClick={() => onAdd(variant.id)}
                className="mt-2 rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {variant.available ? "Add" : "Unavailable"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Results.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Results screen with variant-aware product grid"
```

---

### Task 9: Cart screen

**Files:**
- Create: `src/components/Cart.tsx`
- Test: `src/components/Cart.test.tsx`

**Interfaces:**
- Consumes: `Cart` type (Task 2), `formatMoney` (Task 4).
- Produces: `<CartView cart={Cart | null} busy={boolean} error={string | null} checkoutOpened={boolean} popupBlocked={boolean} onQuantityChange={(variantId: string, quantity: number) => void} onCheckout={() => void} onBack={() => void} />`. Consumed by Task 10.

- [ ] **Step 1: Write the failing test**

Create `src/components/Cart.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartView } from "./Cart";
import type { Cart } from "../lib/ucp/types";

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "gid://shopify/CartLine/1",
      variantId: "gid://shopify/ProductVariant/1",
      title: "short sleeve t-shirt - Red",
      imageUrl: "https://cdn.shopify.com/a.jpg",
      quantity: 2,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 240000, currency: "INR" },
    },
  ],
  total: { amountMinor: 240000, currency: "INR" },
};

const BASE = {
  busy: false,
  error: null,
  checkoutOpened: false,
  popupBlocked: false,
  onQuantityChange: vi.fn(),
  onCheckout: vi.fn(),
  onBack: vi.fn(),
};

describe("CartView", () => {
  it("renders line items and the server-provided total", () => {
    render(<CartView {...BASE} cart={CART} />);

    expect(screen.getByText("short sleeve t-shirt - Red")).toBeInTheDocument();
    expect(screen.getByText(/2,400\.00/)).toBeInTheDocument();
  });

  it("increments through onQuantityChange rather than local state", async () => {
    const onQuantityChange = vi.fn();
    render(
      <CartView {...BASE} cart={CART} onQuantityChange={onQuantityChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /increase/i }));

    expect(onQuantityChange).toHaveBeenCalledWith(
      "gid://shopify/ProductVariant/1",
      3,
    );
    // The displayed quantity must not move until the server confirms.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("decrements to zero so a line can be removed", async () => {
    const onQuantityChange = vi.fn();
    const single = {
      ...CART,
      lines: [{ ...CART.lines[0], quantity: 1 }],
    };
    render(
      <CartView {...BASE} cart={single} onQuantityChange={onQuantityChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /decrease/i }));

    expect(onQuantityChange).toHaveBeenCalledWith(
      "gid://shopify/ProductVariant/1",
      0,
    );
  });

  it("disables the steppers and checkout while a mutation is in flight", () => {
    render(<CartView {...BASE} cart={CART} busy />);

    expect(screen.getByRole("button", { name: /increase/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /checkout/i })).toBeDisabled();
  });

  it("shows an error with a retry affordance", () => {
    render(<CartView {...BASE} cart={CART} error="Variant unavailable" />);

    expect(screen.getByText(/Variant unavailable/)).toBeInTheDocument();
  });

  it("fires onCheckout when Checkout is tapped", async () => {
    const onCheckout = vi.fn();
    render(<CartView {...BASE} cart={CART} onCheckout={onCheckout} />);

    await userEvent.click(screen.getByRole("button", { name: /checkout/i }));

    expect(onCheckout).toHaveBeenCalledTimes(1);
  });

  it("renders a fallback link when the popup was blocked", () => {
    render(<CartView {...BASE} cart={CART} popupBlocked />);

    expect(screen.getByRole("link", { name: /checkout/i })).toHaveAttribute(
      "href",
      "https://store.test/cart/c/abc",
    );
  });

  it("states only that checkout opened, never that payment succeeded", () => {
    render(<CartView {...BASE} cart={CART} checkoutOpened />);

    expect(screen.getByText(/opened in a new tab/i)).toBeInTheDocument();
    // The widget cannot observe the payment outcome, so it must never imply one.
    expect(screen.queryByText(/success|paid|complete|thank you/i)).toBeNull();
  });

  it("renders an empty cart without a checkout button", () => {
    render(
      <CartView {...BASE} cart={{ ...CART, lines: [], total: { amountMinor: 0, currency: "INR" } }} />,
    );

    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /checkout/i })).toBeNull();
  });

  it("renders nothing but a message when there is no cart yet", () => {
    render(<CartView {...BASE} cart={null} />);

    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Cart.test.tsx`
Expected: FAIL — cannot resolve `./Cart`.

- [ ] **Step 3: Write `src/components/Cart.tsx`**

```tsx
import { formatMoney } from "../lib/ucp/normalise";
import type { Cart } from "../lib/ucp/types";

interface CartViewProps {
  cart: Cart | null;
  busy: boolean;
  error: string | null;
  checkoutOpened: boolean;
  popupBlocked: boolean;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onCheckout: () => void;
  onBack: () => void;
}

export function CartView({
  cart,
  busy,
  error,
  checkoutOpened,
  popupBlocked,
  onQuantityChange,
  onCheckout,
  onBack,
}: CartViewProps) {
  const isEmpty = !cart || cart.lines.length === 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back to products
      </button>

      {isEmpty ? (
        <p className="py-12 text-center text-sm text-secondary">
          Your cart is empty.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {cart.lines.map((line) => (
              <li
                key={line.lineId}
                className="flex items-center gap-3 rounded-xl border border-black/10 p-2"
              >
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt={line.title}
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-lg bg-black/5" />
                )}

                <div className="flex-1">
                  <p className="text-sm font-medium">{line.title}</p>
                  <p className="text-xs text-secondary">
                    {formatMoney(line.unitPrice)} each
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Decrease quantity of ${line.title}`}
                    disabled={busy}
                    onClick={() =>
                      onQuantityChange(line.variantId, line.quantity - 1)
                    }
                    className="h-7 w-7 rounded-full border border-black/15 disabled:opacity-40"
                  >
                    −
                  </button>
                  {/* Rendered from the server response. It does not move until
                      Shopify confirms the new quantity. */}
                  <span className="w-5 text-center text-sm">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase quantity of ${line.title}`}
                    disabled={busy}
                    onClick={() =>
                      onQuantityChange(line.variantId, line.quantity + 1)
                    }
                    className="h-7 w-7 rounded-full border border-black/15 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-sm text-secondary">Total</span>
            <span className="text-base font-semibold">
              {formatMoney(cart.total)}
            </span>
          </div>
        </>
      )}

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error} — your cart was restored to its last saved state. Try again.
        </p>
      )}

      {!isEmpty && (
        <button
          type="button"
          disabled={busy}
          onClick={onCheckout}
          className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Checkout
        </button>
      )}

      {popupBlocked && cart && (
        <a
          href={cart.continueUrl}
          target="_blank"
          rel="noreferrer"
          className="text-center text-sm underline"
        >
          Your browser blocked the popup — open checkout here
        </a>
      )}

      {checkoutOpened && (
        // Deliberately non-committal. The popup is cross-origin at every hop,
        // so the widget cannot observe whether payment happened. Asserting an
        // outcome we have not seen — about money — is the worst thing this
        // widget could do.
        <p className="text-center text-sm text-secondary">
          Checkout opened in a new tab. Complete your payment there.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Cart.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Cart screen with server-authoritative quantities"
```

---

### Task 10: App shell — cart mutations, screen routing, checkout popup

**Files:**
- Create: `src/hooks/useCart.ts`, `src/components/App.tsx`
- Modify: `src/index.tsx` (replace the Task 1 placeholder)
- Test: `src/hooks/useCart.test.tsx`, `src/components/App.test.tsx`

**Interfaces:**
- Consumes: `Results` (Task 8), `CartView` (Task 9), `WidgetState`, `ToolResponseMetadata` (Task 7), `Cart`, `Product`, `CartRequest` (Task 2).
- Produces: `useCart(baseUrl: string, persisted: CartSnapshot, onPersist: (snapshot: CartSnapshot) => void)` returning `{ cart: Cart | null; busy: boolean; error: string | null; setQuantity(variantId: string, quantity: number): Promise<void> }`, where `CartSnapshot = { cartId?: string; quantities: Record<string, number> }`; `<App toolMeta={ToolResponseMetadata | null} toolInput={unknown} />`.

**Why the hook takes a snapshot:** MCP hosts re-render widgets freely, and a
cart that evaporates mid-demo is the failure mode this guards against. The
cart id and desired quantities are the only state worth surviving — the cart
body itself is re-fetched from Shopify, which remains the authority.

- [ ] **Step 1: Write the failing test for `useCart`**

Create `src/hooks/useCart.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCart } from "./useCart";
import type { Cart } from "../lib/ucp/types";

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "l1",
      variantId: "v1",
      title: "Tee - Red",
      quantity: 2,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 240000, currency: "INR" },
    },
  ],
  total: { amountMinor: 240000, currency: "INR" },
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const EMPTY = { quantities: {} };
let onPersist: ReturnType<typeof vi.fn>;

describe("useCart", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    onPersist = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a cart on the first add, with no cartId", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() => useCart("http://localhost:8787", EMPTY, onPersist));

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.cartId).toBeUndefined();
    expect(body.lines).toEqual([{ variantId: "v1", quantity: 1 }]);
    expect(result.current.cart?.cartId).toBe("gid://shopify/Cart/abc");
  });

  it("sends the cartId and the full line set on later changes", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() => useCart("http://localhost:8787", EMPTY, onPersist));

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v2", 4);
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(body.cartId).toBe("gid://shopify/Cart/abc");
    // Declarative: the whole desired set, not a delta.
    expect(body.lines).toHaveLength(2);
  });

  it("renders from the server response, not from the requested quantity", async () => {
    // Requested 9, server says 2 — the server wins.
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() => useCart("http://localhost:8787", EMPTY, onPersist));

    await act(async () => {
      await result.current.setQuantity("v1", 9);
    });

    expect(result.current.cart?.lines[0].quantity).toBe(2);
  });

  it("keeps the previous cart and reports the error when a mutation fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(CART) as never)
      .mockResolvedValueOnce(
        jsonResponse({ error: "Variant unavailable" }, 502) as never,
      );
    const { result } = renderHook(() => useCart("http://localhost:8787", EMPTY, onPersist));

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v1", 5);
    });

    expect(result.current.error).toBe("Variant unavailable");
    expect(result.current.cart).toEqual(CART);
  });

  it("reports a network failure without discarding the cart", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(CART) as never)
      .mockRejectedValueOnce(new Error("Failed to fetch"));
    const { result } = renderHook(() => useCart("http://localhost:8787", EMPTY, onPersist));

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v1", 5);
    });

    await waitFor(() => expect(result.current.error).toMatch(/Failed to fetch/));
    expect(result.current.cart).toEqual(CART);
  });

  it("clears a previous error on the next successful mutation", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 502) as never)
      .mockResolvedValueOnce(jsonResponse(CART) as never);
    const { result } = renderHook(() => useCart("http://localhost:8787", EMPTY, onPersist));

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v1", 2);
    });

    expect(result.current.error).toBeNull();
  });

  it("persists the cart id and quantities after a successful mutation", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });

    expect(onPersist).toHaveBeenCalledWith({
      cartId: "gid://shopify/Cart/abc",
      // Re-seeded from the server response, not from what was requested.
      quantities: { v1: 2 },
    });
  });

  it("resumes from a persisted snapshot after a host re-render", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart(
        "http://localhost:8787",
        { cartId: "gid://shopify/Cart/existing", quantities: { v9: 3 } },
        onPersist,
      ),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.cartId).toBe("gid://shopify/Cart/existing");
    // The pre-existing line survives, because the call replaces the whole set.
    expect(body.lines).toContainEqual({ variantId: "v9", quantity: 3 });
    expect(body.lines).toContainEqual({ variantId: "v1", quantity: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useCart.test.tsx`
Expected: FAIL — cannot resolve `./useCart`.

- [ ] **Step 3: Write `src/hooks/useCart.ts`**

```ts
import { useCallback, useRef, useState } from "react";
import type { Cart } from "../lib/ucp/types";

export interface CartSnapshot {
  cartId?: string;
  quantities: Record<string, number>;
}

export interface UseCartResult {
  cart: Cart | null;
  busy: boolean;
  error: string | null;
  setQuantity: (variantId: string, quantity: number) => Promise<void>;
}

export function useCart(
  baseUrl: string,
  persisted: CartSnapshot,
  onPersist: (snapshot: CartSnapshot) => void,
): UseCartResult {
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Desired quantities are tracked separately from the rendered cart, because
  // update_cart is declarative: every call must carry the complete set.
  // Seeded from persisted widget state so a host re-render does not drop the
  // cart the user has already built.
  const quantities = useRef<Record<string, number>>({ ...persisted.quantities });
  const cartId = useRef<string | undefined>(persisted.cartId);

  const setQuantity = useCallback(
    async (variantId: string, quantity: number) => {
      const previous = { ...quantities.current };
      quantities.current[variantId] = Math.max(0, quantity);

      const lines = Object.entries(quantities.current)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => ({ variantId: id, quantity: qty }));

      setBusy(true);
      try {
        const response = await fetch(`${baseUrl}/api/shop/cart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cartId: cartId.current, lines }),
        });

        const body = await response.json();

        if (!response.ok) {
          // Roll the desired quantities back so the next change starts from
          // the state Shopify actually holds, not from the rejected one.
          quantities.current = previous;
          setError(
            typeof body?.error === "string" ? body.error : "Couldn't update cart",
          );
          return;
        }

        const next = body as Cart;
        cartId.current = next.cartId;
        // Re-seed from the server's answer: it is the only authority on what
        // is in the cart after discounts and availability limits apply.
        quantities.current = Object.fromEntries(
          next.lines.map((line) => [line.variantId, line.quantity]),
        );
        setCart(next);
        setError(null);
        onPersist({ cartId: next.cartId, quantities: quantities.current });
      } catch (caught) {
        quantities.current = previous;
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, onPersist],
  );

  return { cart, busy, error, setQuantity };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useCart.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing test for `App`**

Create `src/components/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type { Cart, Product } from "../lib/ucp/types";

const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    variants: [
      {
        id: "v1",
        title: "Red",
        price: { amountMinor: 120000, currency: "INR" },
        available: true,
      },
    ],
  },
];

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "l1",
      variantId: "v1",
      title: "short sleeve t-shirt - Red",
      quantity: 1,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 120000, currency: "INR" },
    },
  ],
  total: { amountMinor: 120000, currency: "INR" },
};

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => CART }),
    );
    vi.stubGlobal("open", vi.fn().mockReturnValue({}));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the results grid from tool metadata", () => {
    render(<App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />);

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
  });

  it("moves to the cart screen after adding an item", async () => {
    render(<App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />);

    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    expect(await screen.findByRole("button", { name: /checkout/i })).toBeInTheDocument();
  });

  it("opens continue_url in a new tab on checkout", async () => {
    render(<App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />);

    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await userEvent.click(await screen.findByRole("button", { name: /checkout/i }));

    expect(window.open).toHaveBeenCalledWith(
      "https://store.test/cart/c/abc",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows the fallback link when the popup is blocked", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    render(<App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />);

    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await userEvent.click(await screen.findByRole("button", { name: /checkout/i }));

    expect(
      await screen.findByRole("link", { name: /open checkout here/i }),
    ).toHaveAttribute("href", "https://store.test/cart/c/abc");
  });

  it("returns to the results grid from the cart", async () => {
    render(<App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />);

    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await userEvent.click(await screen.findByRole("button", { name: /back to products/i }));

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
  });

  it("shows a waiting state when no products have arrived yet", () => {
    render(<App toolMeta={null} toolInput={null} />);

    expect(screen.getByText(/searching|no products/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/components/App.test.tsx`
Expected: FAIL — cannot resolve `./App`.

**If, once `App.tsx` exists, these tests fail inside `useWidgetState` rather
than on an assertion:** the ported `getClientPlatform()` is looking for a host
bridge that does not exist under jsdom. Fix it in the test, not in the hook —
add a host stub to `beforeEach`:

```tsx
vi.stubGlobal("openai", {
  widgetState: null,
  setWidgetState: vi.fn(),
});
```

If the failure persists, read `src/utils/platform.ts` to see what
`getClientPlatform()` actually probes for and stub that instead. Do not weaken
the hook to accommodate a test environment — the hook is the piece that works
in production.

- [ ] **Step 7: Write `src/components/App.tsx`**

```tsx
import { useCallback, useState } from "react";
import { Results } from "./Results";
import { CartView } from "./Cart";
import { useCart, type CartSnapshot } from "../hooks/useCart";
import { useWidgetState } from "../hooks/useWidgetState";
import type { ToolResponseMetadata, WidgetState } from "../types";

interface AppProps {
  toolMeta: ToolResponseMetadata | null;
  toolInput: unknown;
}

/**
 * The widget calls its own server, which is the origin that served this
 * bundle. In an inlined-HTML widget there is no document origin to infer, so
 * the server injects it at build time via VITE_SERVER_URL, falling back to the
 * dev port.
 */
const BASE_URL =
  (import.meta.env?.VITE_SERVER_URL as string | undefined) ??
  "http://localhost:8787";

export function App({ toolMeta, toolInput }: AppProps) {
  const products = toolMeta?.products ?? [];
  const query =
    (toolInput as { query?: string } | null)?.query ?? "";

  // Persisted through the host so a re-render does not discard the cart the
  // user has already built. Only the cart id and desired quantities are kept —
  // the cart body is re-fetched, because Shopify is the authority on it.
  const [widgetState, setWidgetState] = useWidgetState<WidgetState>({
    screen: "results",
    quantities: {},
  });

  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const screen = widgetState.screen;
  const setScreen = useCallback(
    (next: "results" | "cart") =>
      setWidgetState((prev) => ({ ...prev, screen: next })),
    [setWidgetState],
  );

  const handlePersist = useCallback(
    (snapshot: CartSnapshot) =>
      setWidgetState((prev) => ({
        ...prev,
        cartId: snapshot.cartId,
        quantities: snapshot.quantities,
      })),
    [setWidgetState],
  );

  const { cart, busy, error, setQuantity } = useCart(
    BASE_URL,
    { cartId: widgetState.cartId, quantities: widgetState.quantities },
    handlePersist,
  );

  const handleAdd = useCallback(
    async (variantId: string) => {
      const existing =
        cart?.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
      await setQuantity(variantId, existing + 1);
      setScreen("cart");
    },
    [cart, setQuantity],
  );

  const handleCheckout = useCallback(() => {
    if (!cart) return;
    // Synchronous inside the click handler. Awaiting anything first is exactly
    // what popup blockers suppress, and a blocked window.open fails silently.
    const opened = window.open(cart.continueUrl, "_blank", "noopener,noreferrer");
    if (opened) {
      setCheckoutOpened(true);
      setPopupBlocked(false);
    } else {
      setPopupBlocked(true);
    }
  }, [cart]);

  if (screen === "cart") {
    return (
      <CartView
        cart={cart}
        busy={busy}
        error={error}
        checkoutOpened={checkoutOpened}
        popupBlocked={popupBlocked}
        onQuantityChange={(variantId, quantity) => {
          void setQuantity(variantId, quantity);
        }}
        onCheckout={handleCheckout}
        onBack={() => setScreen("results")}
      />
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-secondary">Searching the store…</p>
      </div>
    );
  }

  return (
    <Results
      products={products}
      query={query}
      onAdd={(variantId) => {
        void handleAdd(variantId);
      }}
    />
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/components/App.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 9: Replace `src/index.tsx` with the real router**

```tsx
// Must be imported first so Tailwind layers exist before any component styles.
import "./main.css";

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDocumentTheme } from "@openai/apps-sdk-ui/theme";
import { LoadingIndicator } from "@openai/apps-sdk-ui/components/Indicator";
import {
  useToolResponseMetadata,
  useToolInput,
} from "./hooks/useOpenAiGlobal";
import { useMcpApp } from "./hooks/useMcpApp";
import { App } from "./components/App";
import { isOpenAiLegacy } from "./utils/platform";
import type { ToolResponseMetadata } from "./types";

function applyHostContext(ctx: any) {
  if (ctx?.theme) {
    document.documentElement.setAttribute("data-theme", ctx.theme);
  }
  if (ctx?.styles?.variables) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(ctx.styles.variables)) {
      if (value !== undefined) {
        root.style.setProperty(`--${key}`, value as string);
      }
    }
  }
}

function OpenAiToolRouter() {
  const toolMeta = useToolResponseMetadata() as ToolResponseMetadata | null;
  const toolInput = useToolInput();
  useDocumentTheme();
  return <App toolMeta={toolMeta} toolInput={toolInput} />;
}

function McpToolRouter() {
  const {
    isConnected,
    error,
    toolResponseMetadata,
    toolInput,
    hostContext,
  } = useMcpApp();

  useEffect(() => {
    if (hostContext) applyHostContext(hostContext);
  }, [hostContext]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <p className="text-lg font-medium text-red-500">Connection Error</p>
        <p className="mt-2 text-sm text-secondary">{error.message}</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <LoadingIndicator size={48} strokeWidth={4} />
        <p className="mt-4 text-sm text-secondary">Connecting…</p>
      </div>
    );
  }

  return (
    <App
      toolMeta={toolResponseMetadata as ToolResponseMetadata | null}
      toolInput={toolInput}
    />
  );
}

function Root() {
  return isOpenAiLegacy() ? <OpenAiToolRouter /> : <McpToolRouter />;
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Root />);
}
```

The unused `useState`/`useCallback` imports from the reference file are omitted
deliberately — `noUnusedLocals` is on and would reject them.

- [ ] **Step 10: Inject the server origin at widget build time**

Modify `server.ts` — in `loadWidgetHtml`, before the `<script>` tag, add the
origin so the widget's `fetch` targets the right host when tunnelling:

```ts
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
```

Then change `BASE_URL` in `src/components/App.tsx` to read it:

```tsx
const BASE_URL =
  (window as { __SERVER_URL__?: string }).__SERVER_URL__ ??
  "http://localhost:8787";
```

`import.meta.env` is resolved at Vite build time, which is before the server
knows its own public origin — so it cannot carry an ngrok URL. Injecting a
global at HTML assembly time can.

- [ ] **Step 11: Run the full suite and type-check**

Run: `npx vitest run && npm run type-check`
Expected: all tests PASS, type-check exits 0.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: add cart hook, app shell, screen routing, and checkout popup"
```

---

### Task 11: End-to-end verification against the live store

Nothing here is a unit test — this is the gate that proves the demo works before it is shown to anyone.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Build and start**

```bash
npm run build && npm start
```

Expected: `Shopify MCP demo on http://localhost:8787/mcp` and `Store: sbox-mukul-store.myshopify.com`.

- [ ] **Step 2: Verify the MCP endpoint lists the tool and the widget resource**

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' | head -c 500
```

Expected: a JSON-RPC result naming `Shopify Store`.

- [ ] **Step 3: Create a real cart through the proxy route**

```bash
VARIANT=$(node -e "console.log(require('./src/lib/ucp/__fixtures__/search-catalog.json').products[0].variants[0].id)")
curl -s -X POST http://localhost:8787/api/shop/cart \
  -H 'Content-Type: application/json' \
  -d "{\"lines\":[{\"variantId\":\"$VARIANT\",\"quantity\":2}]}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);console.log('total:',c.total);console.log('continueUrl:',c.continueUrl)})"
```

Expected: a `total` of twice the unit price in minor units, and a `continueUrl`
beginning `https://`. **Copy that URL — the next step needs it.**

- [ ] **Step 4: Open the checkout URL in a browser and confirm Cashfree appears**

Take the `continueUrl` from Step 3 and open it. Expected: Shopify's hosted
checkout loads, and at the payment step **Cashfree's payment options appear**,
because the merchant configured Cashfree on this store.

**If Cashfree does not appear, stop and report it.** That is a store
configuration matter, not a code defect — but the demo does not work without
it, and finding out during the presentation is the failure this step exists to
prevent.

- [ ] **Step 5: Connect a real MCP host and run the whole flow**

Expose the server (`ngrok http 8787`), set `SERVER_URL` in `.env` to the public
origin, rebuild, restart, and add the connector at `<public-origin>/mcp`.

Then, in the host, ask: **"show me shirts from the store"**.

Verify, in order:
1. The model calls `SearchProducts`.
2. The widget renders a product grid with **images visible** — if images are blocked, the `resource_domains` CSP entry for `https://cdn.shopify.com` is wrong.
3. Add moves to the cart with the correct variant name.
4. The quantity stepper changes the total, and the total matches Shopify.
5. Checkout opens Shopify's hosted checkout in a new tab.
6. The widget says only "Checkout opened in a new tab" — no success claim.

- [ ] **Step 6: Write `README.md`**

```markdown
# Shopify MCP Demo

Browse a live Shopify store from inside ChatGPT or Claude, build a cart, and
check out through Shopify's hosted checkout — where the merchant's Cashfree
integration takes the payment.

## How it works

The server is both an MCP **server** (to the AI host) and an MCP **client** (to
Shopify). It exposes one tool, `SearchProducts`, and one widget resource. The
widget renders results and a cart, then opens Shopify's `continue_url`.

Shopify's UCP MCP endpoint requires **no authentication** — the shop domain is
the entire configuration.

## Setup

```bash
npm install
cp .env.example .env   # edit SHOP_DOMAIN
npm run build
npm start
```

Then expose it (`ngrok http 8787`), set `SERVER_URL` in `.env` to the public
origin, rebuild, and add `<public-origin>/mcp` as a connector in your host.

## Scope

Milestone 1 is Shopify-only. There is no Cashfree code here: Cashfree appears
because the merchant configured it on the store.

**The widget cannot see the payment outcome.** The checkout popup is
cross-origin at every hop and Shopify will not report order status without an
Admin API token, so the widget's terminal state is "Checkout opened in a new
tab" and nothing more. Closing that gap is milestone A's job.

Other known limits: no product detail screen (a card represents its first
available variant), no pagination, no cart persistence across sessions, and the
UCP agent profile is Shopify's public example rather than our own.

## Endpoints

| Path | Purpose |
|---|---|
| `POST /mcp` | MCP over HTTP for the AI host |
| `POST /api/shop/cart` | Cart create/update for the widget |

## Tests

```bash
npm test
```
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: add README and record end-to-end verification steps"
```

---

## Verification checklist

Before declaring this done, per `superpowers:verification-before-completion`:

- [ ] `npx vitest run` — all tests pass, output shown
- [ ] `npm run type-check` — exits 0
- [ ] `npm run build` — both widget and server bundles produced
- [ ] Task 11 Step 4 confirmed Cashfree appears on the store's hosted checkout
- [ ] Task 11 Step 5 completed in a real host, all six checks observed
- [ ] No `any` introduced outside the ported bridge files
- [ ] No Cashfree dependency in `package.json`
- [ ] The widget never claims a payment succeeded
