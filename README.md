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
origin, rebuild, and add `<public-origin>/mcp` as a connector in your host.

`SERVER_URL` must be set before `npm run build`, because the origin is injected
into the widget HTML at assembly time — the widget uses it to call
`/api/shop/cart`.

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
