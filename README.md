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

```
ChatGPT / Claude
      │  SearchProducts({ query })
      ▼
this server ──── JSON-RPC over HTTP ───► https://{SHOP_DOMAIN}/api/ucp/mcp
      │  products via _meta
      ▼
React widget → Results grid → Cart → continue_url (new tab)
                                          ▼
                            Shopify hosted checkout → Cashfree
```

## Setup

```bash
npm install
cp .env.example .env   # edit SHOP_DOMAIN
npm run build
npm start
```

Then expose it (`ngrok http 8787`), set `SERVER_URL` in `.env` to the public
origin, **restart the server**, and add `<public-origin>/mcp` as a connector in
your host.

A restart is enough — no rebuild. The origin is read from the environment at
boot and injected into the widget HTML each time the resource is served, so the
widget always calls back to whatever `SERVER_URL` the running process was
started with.

## The store must not be password protected

Shopify's **"Restrict access to visitors with a password"** setting breaks this
demo in a way that is easy to misdiagnose: the UCP MCP endpoints ignore the
gate, so catalog search and cart creation succeed normally, and only the
checkout link redirects to the password page. Everything looks healthy right up
to the payment step.

The server probes for this at boot and prints a warning naming the exact
setting. It still starts — a gated store is fine for working on the catalog.

> Shopify admin → Online Store → Preferences → Restrict access → uncheck
> "Restrict access to visitors with a password"

## Logs

Every request is logged with method, path, status and duration, and MCP calls
name the method and tool — `POST /mcp` alone is unreadable when every host call
looks identical:

```
→ GET / 200 1ms
→ POST /mcp (tools/list) 200 20ms
→ POST /mcp (tools/call SearchProducts) 200 446ms
→ POST /api/shop/cart 200 1022ms
✗ POST /api/shop/cart 400 6ms
```

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

## Notes for anyone extending this

- **Target `/api/ucp/mcp` only.** The older `/api/mcp` is deprecated after
  **2026-08-31** and every response from it says so.
- **The published docs are wrong in three places.** They reverse the catalog/cart
  endpoint split, and they document cart lines as `merchandise_id` when the
  server requires `line_items[].item.id` on UCP. Types here are derived from
  captured live payloads in `src/lib/ucp/__fixtures__/`, not from the docs.
- **`update_cart` is declarative** — send the complete desired line set every
  time; removal is expressed by omitting a line.
- **Money is minor units** with the currency held once at cart level.
  `formatMoney` derives the decimal count from `Intl`, so zero-decimal
  currencies like JPY are not divided.
- **The MCP transport is stateless** (`sessionIdGenerator: undefined`). Issuing
  session ids while constructing a fresh server per request makes everything
  after `initialize` fail with "Server not initialized".

## Endpoints

| Path | Purpose |
|---|---|
| `POST /mcp` | MCP over HTTP for the AI host |
| `POST /api/shop/cart` | Cart create/update for the widget |

## Tests

```bash
npm test        # watch
npm run test:run
npm run type-check
```
