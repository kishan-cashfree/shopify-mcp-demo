# Shopify MCP Demo

Shop a live Shopify store from inside ChatGPT or Claude and pay with Cashfree —
catalog, cart, OTP login, saved addresses and payment, without leaving the
conversation.

```
"show me shirts from the store"
      ↓  SearchProducts
  product grid  →  cart  →  phone  →  OTP  →  address  →  payment
                                                              ↓
                                              Cashfree  →  order summary
```

Every payment path ends on the same screen: what was bought, with quantities
and prices, plus the order id and status. Cashfree confirms that money moved,
but it never saw the Shopify cart and so cannot say what was in it.

Search again after paying and the widget starts a fresh shopping session — new
cart, no receipt left over. Buying twice in one conversation works.

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
| `PAYMENT_ANNOTATIONS` | `honest` (default) or `readonly`. Flip it in `.env` and restart to test both dispatch paths. `readonly` makes the payment tools claim to be read-only so the host will dispatch them — diagnostic only, see above. A shell variable overrides the file, because `--env-file` does not override an already-set environment variable. |

## What to expect when you run it

**Payment works, except saved cards.** The host gates payment tools on their
MCP annotations. `cashfree-here` ships the honest ones —
`{ readOnlyHint: false, destructiveHint: true }` for a tool that charges a
card — and against those the host declines to dispatch: the model forms the
intent, the host prefetches the tool's widget template, and no `tools/call`
ever arrives.

Setting `PAYMENT_ANNOTATIONS=readonly` overrides them to
`{ readOnlyHint: true, destructiveHint: false }` and four of the five tools
dispatch: UPI, netbanking, hosted checkout, new card — and, once the handoff
lands, saved card too.

That flag is a measurement, not a fix. It makes a tool that moves money claim
it does nothing, which is a lie to the exact control that exists to catch it.
It defaults off, prints a warning on first use, and must not ship.

When a tool is blocked the widget says so and offers a Cashfree link, which
works. Pay in the tab, come back, and the widget confirms the order.

**The handoff is late, not lost — and "blocked" can be wrong.** This file used
to say the widget-to-model handoff dropped about half the time. One captured
session says otherwise: `CheckoutTool` was declared blocked after the widget's
two attempts (2 × 4s), the buyer took the Cashfree link, and the `tools/call`
then arrived anyway — roughly 2-4s after the click, so somewhere around 12-20s
end to end. The server handled it in 37ms. Every millisecond of that delay was
upstream.

`sendFollowUpMessage` does not ask the host to run a tool. It posts a user turn
and resolves once that message is *delivered*, so the widget's confirmation
window starts at enqueue time and then measures a full model inference turn on
the host's infrastructure — which the 4s timeout was never calibrated against.

The consequence is worse than a slow screen: the buyer paid on the external
link while a Cashfree widget for the same `payment_session_id` rendered behind
them. Two live payment surfaces for one order. `DISPATCH_ATTEMPTS = 2` sends
the follow-up twice, so two widgets is possible too.

**The "drops half the time" reading was our own bug.** Two `App` instances were
being opened on the one postMessage channel the MCP Apps transport gives you:
`useMcpApp` built and connected one for rendering, `getClientPlatform()` built
and connected another for the payment handoff. The handshakes raced, and
whichever lost answered **"Not connected"** to everything afterwards — a buyer
picked a payment method and no `tools/call` ever reached the server. A coin-flip
handoff is what a two-way race looks like, not a flaky host. The hook now
subscribes to the shared client, `connect()` is idempotent, and unmounting no
longer calls `close()` on a singleton that outlives the React tree.

Since that fix every dispatch has landed first try. `attemptsFor()` already
returns 1 on MCP Apps hosts, so the retry only applies to ChatGPT, which uses
`LegacyOpenAiClient` and never had this race — there is no measurement
justifying its removal, so it stays.

**UPI fails above ₹1,00,000** with "payment method is not eligible for this
order" — UPI's per-transaction limit, confirmed by bisection at ₹99,600 (ok) /
₹100,800 (fail). Netbanking and hosted checkout have higher limits. The cart
has no ceiling, so a few taps on `+` can walk past it with no warning.

**The build id is printed on the payment screen.** Hosts cache widget
instances, and a cached one is indistinguishable from a current one — several
rounds of debugging once went into code that had already been deleted. If the
build id does not match the running server, you are looking at a stale widget.

**A rebuild does not reach the browser, and neither does a new chat.** The
widget URI carries the build id so every build is a distinct resource, and that
is still not enough: Claude served a cached widget across rebuilds *and* fresh
conversations, with no `resources/read` in the log at all. Two rounds of
debugging went into instrumentation that was never executing. The only reliable
way to force a re-read is to **disconnect and reconnect the connector**. Check
for `POST /mcp (resources/read ui://widget/shopify-store-<build>.html)` in the
log before trusting anything you see.

## Known limitations

- **Card entry cannot render in Claude, and will not be fixed upstream.**
  Cashfree Elements mounts its PCI fields as nested cross-origin iframes.
  Claude enforces `frame-src 'self' blob: data:` and ignores the
  `frameDomains` a UI resource declares, so the fields load as empty,
  unclickable boxes. This is policy, not a bug in transit: an Anthropic
  engineer stated on 2026-04-09 in
  [claude-ai-mcp#40](https://github.com/anthropics/claude-ai-mcp/issues/40)
  that nested iframes are not allowed for security reasons, and two later asks
  of "permanent or temporary?" went unanswered. `connectDomains` and
  `resourceDomains` *were* fixed in April and do work — only framing is
  blocked, so `fetch` from the widget to this server is fine.

  Stripe hit the same wall: their MCP Apps documentation opens a hosted
  Checkout page with `app.openLink()` rather than embedding card fields. That
  is the same shape as `CheckoutTool` here, which works today and is the
  recommended path for cards on Claude.

  Keeping card entry in-conversation is possible — plain `<input>` fields (no
  iframe) posting straight to this server, which is what `cashfree-here`
  shipped before commit `55da139` replaced it with Elements. It puts raw PANs
  through our server (SAQ-D territory) and 3DS still redirects out, so it buys
  the form and not the flow. Not built; a product decision, not a technical
  one.
- **Saved-card payment fails inside Cashfree.** `CardPaymentTool` dispatches
  and lists saved cards correctly, but paying with one returns
  `HTTP 500 {"message":"Internal Server Error"}` from
  `/pg/orders/sessions/js`. Isolated on one order: UPI and netbanking both
  return 200 against the same `payment_session_id` and headers; only the
  `payment_method.card.instrument_id` branch 500s, with or without a CVV. A
  generic 500 is a Cashfree-side fault — their validation errors are 400s with
  specific messages. Needs Cashfree.
- **UPI is offered above its ₹1,00,000 limit** and fails at Cashfree rather
  than being disabled in the picker.
- **`cashfree-here` is patched in place.** Two fixes live in the sibling
  checkout, not in this repo: `useReconciliation.start()` now clears the
  previous poll timer, and the payment-success notification fires once per
  order. Without them a paid order posted "Payment completed successfully" to
  the chat every few seconds, forever.
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

- **Check `Access-Control-Allow-Headers` before blaming the platform.** This
  file used to claim GET requests from the widget iframe never reach the
  server. They do. `cashfree-here` sends `ngrok-skip-browser-warning` on its
  reconciliation GET, which makes the request preflighted; our allow-list did
  not name that header, so the browser refused the preflight and the GET was
  never sent. Recon then reported "Unable to verify payment status" and showed
  **Payment Failed on orders that were already PAID**.

  Two things made it look like a platform wall: no GET ever appeared in the
  log, and preflights were filtered out of the log as noise — so a refused
  request and a request never made were indistinguishable. Preflights on
  `/api/*` are logged now.

  The POST-only endpoints (`/api/pay/addresses/list`, `/api/orders/status`)
  were built on that wrong diagnosis. They work, but they are not necessary.
- Only a **model-invoked** tool call makes the host render that tool's
  `outputTemplate`. `callTool` runs the handler and renders nothing.
- `window.open` is blocked in the widget iframe, and the host's external-open
  navigated away and killed the MCP connector mid-payment. A plain
  `<a target="_blank">` is the one thing that works.
- The MCP transport is stateless (`sessionIdGenerator: undefined`). Issuing
  session ids while building a fresh server per request makes everything after
  `initialize` fail with "Server not initialized".
- **Widget state outlives the widget, so every tool result must be dated.**
  The host keeps state for the whole conversation and re-hydrates each new
  widget from it. A search after a payment therefore woke up holding
  `screen: "checkout"` and answered "show me shirts" with the previous
  receipt — and the next item added landed in a cart Shopify had already
  completed. `SearchProducts` now stamps a `searchId` per call and the widget
  resets on one it has not shown.
- **Whatever owns the state is what a reset has to clear.** `useCart` and
  `useCheckoutFlow` seed themselves at mount and never re-read what they were
  passed, so clearing widget state alone did nothing and they wrote their stale
  values straight back one render later. The session is keyed on `searchId` so
  React discards them instead.
- **Derive a reset during render, not in an effect.** An effect paints the old
  screen first; a buyer asking for pants watched the previous order's
  "Payment received" appear and then get replaced.
- **Nothing orders writes between live widgets.** Every earlier widget in a
  conversation stays running and writes to one origin-wide `localStorage` key.
  A `revision` counter stops a stale snapshot replacing a fresher one *within*
  an instance; it does not order writes *across* instances, because each
  ratchets its own counter. Keying state per conversation would fix it
  properly.

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
13:59:48.201 → POST /mcp (tools/call SearchProducts) 200 328ms
13:59:52.884 → POST /api/shop/cart 200 904ms
14:00:03.117 → POST /api/pay/order 200 1026ms
14:00:09.640 ✗ POST /api/pay/addresses 502 121ms
```

The timestamp is there because durations alone cannot measure the gap
*between* two requests, which is the only question that matters when a payment
dispatch arrives late.

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
