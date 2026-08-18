# Shopify MCP Demo

Shop a live Shopify store from inside ChatGPT or Claude and pay with Cashfree —
catalog, cart, OTP login, saved addresses and payment, without leaving the
conversation.

```
"show me shirts from the store"
      ↓  SearchProducts
  product grid  ⇄  product detail
        └────────┬───────┘
                 ↓
  cart  →  phone  →  OTP  →  address  →  payment
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

Browsing is two screens. The grid shows one card per product with its price
range and how many options it has; tapping one opens a detail screen with the
description, the variant picker and Add to cart. A product with a single
variant can be added straight from its card, and a product already in the cart
gets a quantity stepper there — so the common cases cost one tap and only a
real choice costs a screen. Both screens badge what is already in the cart, and
the two counts come from the same function.

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

**Reloading the host window is safe, in both hosts.** Cart, checkout step, saved
addresses and the payment screen all come back; the cart body is restored from
persisted state rather than refetched, so a reload costs no calls to Shopify at
all in Claude. ChatGPT does not re-deliver the tool result, so it costs one
`search_catalog` to rebuild the product grid and nothing more. Measured across
four flows with reloads at several steps: 18 upstream calls, none of them a
repeat.

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

Reconnecting is still not the whole story: the host's cached tool metadata can
name a URI from an earlier build, so even a fresh conversation may ask for a
build id this server no longer has. It answers for any of them — see "Versioning
the widget URI retires it" below — but the id in that `resources/read` line is
the host's, not necessarily the running server's. `window.__BUILD__` on the
payment screen is what tells you which bundle is executing.

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
- `search_catalog` returns product descriptions as **HTML**, and variants carry
  their axes as `options: [{ name, label }]`. The description is reduced to
  plain text in `normalise.ts` before it reaches React: it is store-controlled
  content rendering on the same screen that collects an OTP, and no formatting
  in it is worth an injection surface.
- A single-variant product still has one option — Shopify's
  `{ name: "Title", label: "Default Title" }` placeholder. Rendering it puts
  "1 titles" under a product that has no choices to make.

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

**The widget**

- **A card is a product; a cart line is a variant, and they do not line up.**
  Collapsing three colours of one t-shirt into one card is right for browsing
  and ambiguous for a stepper — a minus under a card holding one Red and one
  Blue has to guess which to take away. The card counts how many of the
  product's variants are in the cart and offers a stepper only when the answer
  is exactly one; otherwise it badges the total and sends the buyer to the
  detail screen. Refusing is cheaper than removing something they did not pick.
- **The detail screen holds no state of its own.** The selected product and
  variant live in widget state, because the widget is remounted as the buyer
  scrolls (see below) and a local `useState` would lose the selection with it.
  They are cleared on a new `searchId`, or the previous search's product would
  re-open over the new results.

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
- **A widget is remounted far more often than it looks, and the CORS preflight
  is how you know.** Claude destroys and recreates the widget iframe as the
  buyer scrolls, and serves the HTML from its own cache — so no `resources/read`
  appears and the remount is invisible in the log. What gives it away is
  `OPTIONS /api/shop/cart`: a preflight is cached per document, so a fresh one
  means a fresh document. Measured at 22:48:29 and 22:52:25 while nothing but
  scrolling happened. Every latch, ref and observer inside the widget dies with
  it, so "load this once on mount" is not a rate limit — it is a rate *per
  scroll*, per widget.
- **`IntersectionObserver` does not tell you the widget is on screen.** The
  obvious fix above is to fetch only when visible. It does not work: with a null
  root inside a nested browsing context, the observer measures against *that
  iframe's* viewport, not the host page's. Every widget scrolled far out of
  sight reports itself fully visible. Built, tested, measured, deleted — three
  widgets still fetched on every reload.
- **Cache what the host will not hand back.** With a remount routine rather than
  rare, anything refetched on mount is refetched constantly: three widgets alive
  meant three carts reloaded per host reload, and Shopify eventually answered
  `429 Rate limit exceeded`. The cart body is now persisted with the cart id and
  a timestamp, and only refetched past a TTL. A three-flow session went from
  19–20 upstream calls to 13, and two reloads that used to cost six calls now
  cost none.

  The TTL was 30s first, which prevented nothing: measured across three flows,
  the gap between a cart's last fetch and its next mount was 32s, 41s, 41s, 42s,
  53s, 80s and 143s — every one of them expired the window. It is 10 minutes
  now. The body is display-only; a quantity change re-seeds from the server and
  the payment is priced from Shopify's cart, so a stale figure cannot be paid.
- **Versioning the widget URI retires it, so serve every build.** The URI
  carries a build id (see below) to defeat host caching. The cost is that a
  rebuild invalidates the id every widget already in a conversation was created
  with: the host re-reads the URI it remembers, the server answers
  `-32602 Resource not found`, and those widgets render "store could not load".
  A `ResourceTemplate` for `ui://widget/shopify-store-{build}.html` now serves
  the current bundle for retired ids, which upgrades them instead of bricking
  them. Note this bites in a *new* conversation too — the host's cached tool
  metadata still names the old URI.
- **A CSP warning can be about something you never chose to ship.** MCPJam
  reported `https://cdn.openai.com` blocked on every tool. The twenty
  references were `@font-face` rules in `katex.min.css`, pulled in by the Apps
  SDK's `./css` barrel, for math this widget does not render. Declaring the
  domain would have made a Shopify and Cashfree widget depend on OpenAI's CDN
  inside Claude; importing the other six sheets by path instead removed the
  reference and 21KB of CSS. Note also that the MCP Apps CSP model has no
  `scriptSrc` — only `connectDomains`, `resourceDomains` and `frameDomains` —
  so a script-source complaint is not something the server can answer.
- **Decline the GET leg of streamable HTTP with 405, not 404.** The transport
  is stateless, so there is no server-to-client stream to open. MCPJam opened
  that leg 97 times in one session and took the 404 without aborting, so this
  is not what breaks it there; stricter clients are reported to give up before
  `initialize`. 404 reads as "no such endpoint", which is a different and
  wrong answer.
- **Reload costs differ by host, and it is ChatGPT that pays.** In Claude a
  reload now costs nothing: state and cart body both come back from storage. In
  ChatGPT the catalog is not re-delivered, so `useProducts` asks this server for
  it — one `search_catalog` per reload, and nothing else.

## Endpoints

| Path | Purpose |
|---|---|
| `POST /mcp` | MCP over HTTP for the AI host |
| `POST /api/shop/cart` | Cart create/update against Shopify |
| `POST /api/shop/search` | Catalog recovery for a host that reloaded without re-delivering the tool result |
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
- `docs/superpowers/specs/` — design specs for each milestone.
- `docs/superpowers/plans/` — the task-by-task implementation plans they became.
