# Shopify MCP Demo

Shop a live Shopify store from inside ChatGPT or Claude and pay with Cashfree —
catalog, cart, OTP login, saved addresses and payment, without leaving the
conversation.

```
"show me shirts from the store"
      ↓  SearchProducts
  product grid  →  cart  →  phone  →  OTP  →  address  →  payment
                                                              ↓
                                              Cashfree  →  "Payment received"
```

## How it works

The server is three things at once:

- an **MCP server** to the AI host, exposing one model-facing tool
  (`SearchProducts`) plus a widget resource
- an **MCP client** to Shopify, speaking JSON-RPC to
  `https://{SHOP_DOMAIN}/api/ucp/mcp` — **no authentication**, the shop domain
  is the entire configuration
- a **REST client** to Cashfree, for order creation, OTP login, saved addresses
  and order status

The React widget owns the whole journey. Only product search reaches the model;
everything after it is widget-to-server, which keeps the flow deterministic.

## Setup

```bash
npm install
cp .env.example .env      # set SHOP_DOMAIN and the Cashfree keys
npm run build
npm start
```

Expose it (`ngrok http 8787`), set `SERVER_URL` in `.env` to the public origin,
**restart**, then add `<public-origin>/mcp` as a connector in your host.

A restart is enough — no rebuild. The origin is read at boot and injected into
the widget HTML each time the resource is served.

| Variable | Purpose |
|---|---|
| `SHOP_DOMAIN` | The store. Swap stores by editing this line and restarting. |
| `UCP_AGENT_PROFILE` | Required on every UCP call. Shopify's public example profile is fine for a demo. |
| `CASHFREE_ENV` | `sandbox` (default) or `production`. |
| `CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET` | Dashboard → Developers → API Keys. |
| `CASHFREE_RETURN_URL` | Where Cashfree returns the buyer. Defaults to a stable hosted page. |
| `SERVER_URL` | Public origin when tunnelling. |
| `PORT` | Defaults to 8787. |

## What to expect when you run it

**The payment step will say the chat blocked it.** That is not a bug in this
code. The host suppresses in-conversation payment tool dispatches — measured
across many sessions: the model forms the intent, the host prefetches the
tool's widget template, and no `tools/call` ever arrives. The widget detects
that and offers a Cashfree link, which works. Pay in the tab, come back, and
the widget confirms the order on its own.

**The build id is printed on the payment screen.** Hosts cache widget
instances, and a cached one is indistinguishable from a current one — several
rounds of debugging once went into code that had already been deleted. If the
build id does not match the running server, you are looking at a stale widget:
start a new chat.

## Known limitations

- **In-conversation payment is suppressed by the host.** See above. Softening
  the tools' annotations gets past it and is deliberately not done — a tool
  that charges a card is exactly what that gate exists for.
- **The selected address is not bound to the order.** The buyer picks one and
  Cashfree is not told. Unresolved; needs an answer from the OCC team.
- **No Shopify order is created.** The order lives in Cashfree only. Creating
  one needs Shopify Admin API credentials, which this project deliberately
  avoids.
- **The session store is in-memory.** A server restart loses an in-flight
  checkout.
- **Offers and coupons are deferred.** Both APIs are proven and documented in
  `docs/cashfree-occ-api.md`; only the UI is missing.
- **INR only**, matching the demo stores.

## Notes for anyone extending this

Findings that cost real time to establish. Each is measured, not assumed.

**Shopify**

- Target `/api/ucp/mcp` only. The older `/api/mcp` is deprecated after
  **2026-08-31** and says so on every response.
- The published docs are wrong in three places: they reverse the catalog/cart
  endpoint split, and document cart lines as `merchandise_id` when UCP requires
  `line_items[].item.id`. Types here come from captured payloads in
  `src/lib/ucp/__fixtures__/`, not from the docs.
- `update_cart` is declarative — send the complete desired line set every time;
  removal is expressed by omitting a line.
- Money is minor units with the currency held once at cart level. `formatMoney`
  takes the decimal count from `Intl`, so zero-decimal currencies are not
  divided.
- A password-protected store still serves catalog, cart and checkout links. Only
  browsing the storefront hits the password page.

**Cashfree**

- `x-chxs-id` **is** the `payment_session_id` from Create Order. That forces the
  order to exist before login. A fabricated one returns
  `payment_session_id_invalid`.
- The OCC calls need exactly three headers. None of the browser fingerprinting
  in captured requests — device ids, Forter token, cookies, origin — is
  enforced.
- Addresses require a combined address line of **10–185 characters**. Shorter
  is a 400 with no clue at the UI unless you check for it.
- The address create response is `{ shipping_address, billing_address }`, not a
  list. Parsing it as one returns an empty array on success.
- `/api/orders/:id` proxies Cashfree's **raw** body, because `cashfree-here`'s
  reconciliation parses that shape.

**This host**

- **GET requests from the widget iframe never reach the server. Every POST
  does.** Widget-facing reads are POSTs for that reason — and it is why
  `cashfree-here`'s GET-based reconciliation reports "unable to verify payment
  status" on a perfectly healthy order.
- Only a **model-invoked** tool call makes the host render that tool's
  `outputTemplate`. `callTool` runs the handler and renders nothing.
- `window.open` is blocked in the widget iframe, and the host's external-open
  navigated away and killed the MCP connector mid-payment. A plain
  `<a target="_blank">` is the one thing that works.
- The MCP transport is stateless (`sessionIdGenerator: undefined`). Issuing
  session ids while building a fresh server per request makes everything after
  `initialize` fail with "Server not initialized".

## Endpoints

| Path | Purpose |
|---|---|
| `POST /mcp` | MCP over HTTP for the AI host |
| `POST /api/shop/cart` | Cart create/update against Shopify |
| `POST /api/pay/order` | Create the Cashfree order, priced from the Shopify cart |
| `POST /api/pay/otp`, `/otp/verify` | OTP login |
| `POST /api/pay/addresses/list`, `/addresses` | Saved addresses: read and create |
| `POST /api/pay/dispatched` | Did a payment tool handler actually run? |
| `POST /api/orders/status` | Order status for our own verification screen |
| `GET /api/orders/:id` | Raw order body for `cashfree-here`'s reconciliation |

## Logs

Every request logs method, path, status and duration; MCP calls name the method
and tool, and resource reads name the URI — `POST /mcp` alone is unreadable
when every host call looks identical.

```
→ POST /mcp (tools/call SearchProducts) 200 328ms
→ POST /api/shop/cart 200 904ms
→ POST /api/pay/order 200 1026ms
✗ POST /api/pay/addresses 502 121ms
```

## Tests

```bash
npm test          # watch
npm run test:run
npm run type-check
```

Tests sit beside the code they cover. Fixtures under `src/lib/ucp/__fixtures__/`
are real captured Shopify responses, so a shape change fails a test rather than
a demo. Cashfree fixtures are hand-written and redacted — its session tokens
must not be committed.

## Documents

- `docs/cashfree-occ-api.md` — the OCC contract, verified live. Not in
  Cashfree's published docs.
- `docs/spikes/2026-08-12-occ-spike.md` — what the spike measured.
- `docs/superpowers/specs/` — design specs for both milestones.
