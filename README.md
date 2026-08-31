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
  cart  →  phone  →  OTP  →  address  →  method
                                            ↓
                              Cashfree hosted checkout
                                            ↓
                       order summary  ←  Shopify order
```

**One Cashfree order carries the whole checkout.** It is created before the OTP
is sent — its `payment_session_id` is the header the OTP call needs — and the
same order is what the buyer pays. Picking UPI, card or netbanking deep-links
into that order's own hosted-checkout route rather than creating a second one.

**A paid order becomes a real Shopify order.** Once Cashfree reports `PAID`, the
server places it on the store through the Admin API: the actual cart lines, the
address the buyer picked, the customer associated, and the payment recorded as a
Cashfree transaction. The buyer gets an order number, and the merchant sees the
sale where every other sale is.

Every payment path ends on the same screen: what was bought, with quantities
and prices, the order id and status, and the Shopify order number once it
lands. Cashfree confirms that money moved, but it never saw the Shopify cart and
so cannot say what was in it.

Search again after paying and the widget starts a fresh shopping session — new
cart, no receipt left over. Buying twice in one conversation works.

## How it works

The server is four things at once:

- an **MCP server** to the AI host, exposing one model-facing tool
  (`SearchProducts`) plus a widget resource
- an **MCP client** to Shopify's storefront, speaking JSON-RPC to
  `https://{SHOP_DOMAIN}/api/ucp/mcp` — **no authentication**, the shop domain
  is the entire configuration
- a **REST client** to Cashfree, for order creation, OTP login, saved addresses
  and order status
- a **GraphQL client** to the Shopify Admin API, which places the real order
  once the payment lands. Optional: leave `SHOPIFY_ADMIN_TOKEN` unset and
  everything else still works.

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
the widget HTML as `window.__SERVER_URL__` each time the resource is served,
which is where `BASE_URL` in the widget comes from. It cannot be a build-time
constant: the bundle is built before the server knows its own public origin.

| Variable | Purpose |
|---|---|
| `SHOP_DOMAIN` | The store. Swap stores by editing this line and restarting. |
| `UCP_AGENT_PROFILE` | Required on every UCP call. Shopify's public example profile is fine for a demo. |
| `CASHFREE_ENV` | `sandbox` (default) or `production`. |
| `CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET` | Dashboard → Developers → API Keys. |
| `CASHFREE_RETURN_URL` | Where Cashfree returns the buyer. Defaults to a stable hosted page. |
| `SERVER_URL` | Public origin when tunnelling. The widget runs in the host's browser, so `localhost` means nothing there — leave this unset and every button fails while the screen still renders. |
| `PORT` | Defaults to 8787. |
| `SHOPIFY_ADMIN_TOKEN` | Admin API access token (`shpat_…`), scope `write_orders`. Unset means the order sync is off and the boot banner says so. Must belong to the **same store** as `SHOP_DOMAIN`. |
| `SHOPIFY_SEND_RECEIPT` | Shopify emails its own confirmation unless this is exactly `false`. On by default, matching pgcheckoutsvc — so the buyer gets two emails, Cashfree's and Shopify's. |
| `SHOPIFY_ADMIN_DOMAIN`, `SHOPIFY_ADMIN_API_VERSION` | Only if the Admin API lives elsewhere, or to pin a version. Defaults to `SHOP_DOMAIN` and `2026-07`. |
| `PAYMENT_ANNOTATIONS` | `honest` (default) or `readonly`. **Vestigial** — the widget no longer dispatches payment tools, so this changes nothing the buyer can reach. It survives because the annotation experiment it encodes is expensive to re-derive; see "Payment tool dispatch, and why it is gone". |

### The Shopify order

Set `SHOPIFY_ADMIN_TOKEN` and a paid Cashfree order also becomes a real order on
the store. Shopify admin → Settings → Apps and sales channels → Develop apps →
create an app → `write_orders` → Install → reveal the token. It is shown once,
and `orderCreate` is served only to apps holding an offline token, from API
version 2026-07 onward.

The sync is driven by the order-status poll the widget was already making, not
by a webhook — a webhook needs a public URL that survives a restart, and this
repo's tunnel does not. It is idempotent on `session.shopifyOrder`, because that
poll fires every couple of seconds and does not stop at the first success.

What the order carries:

| | |
|---|---|
| Line items | Real variant gids and quantities, each priced from the cart, each carrying the variant's own `requiresShipping` |
| Customer | One `email OR phone` search, then an **exact** match — email first, phone second. Associated if found, created if not, and the order's own `email` is omitted unless it agrees with the matched customer |
| Addresses | The one the buyer picked, as shipping and billing |
| Discount | The cart's discount as an `itemFixedDiscountCode`, so the totals reconcile |
| Transaction | `SALE` / `SUCCESS`, gateway `Cashfree Payments`, `test: true` while Cashfree is in sandbox |
| Attributes | `pg_order_id` and `cart_token`, so an order can be traced back to the payment |
| Tags | `CASHFREE_PG`, `cashfree-here` |

Five named refusals, each logged: `no-admin-token`, `not-paid`, `no-session`,
`no-cart`, `no-address`. Only `not-paid` is routine — it is every poll before
the buyer finishes. The other four mean a **paid** order did not reach Shopify,
which is why none of them is a silent boolean.

A failure is not recorded, so the poll retries it (four extra attempts, then it
gives up rather than polling a paid buyer for three minutes). The governing rule
in this code: **nothing optional may be able to fail the mutation that records
the money.** Four separate defects here — a blank surname, a duplicate customer
phone, an email disagreeing with the associated customer, a variant lookup —
each lost an order that had already been paid for.

## What to expect when you run it

**Payment is a link to Cashfree's hosted checkout, and it works.** The buyer
picks UPI, card or netbanking; the widget opens that method's route on the
order that already exists — `/checkout/payment-method/{upi,card,net-banking}?pt=…`
— and Cashfree's own page takes it from there. Pay in the tab, come back, and
the widget confirms the order and shows the Shopify order number.

Those routes are real, not a single-page app answering every path with the same
shell: measured against both hosts, `upi`, `card`, `net-banking` and `emi`
return 200 and differ in size from each other, while an invented
`/payment-method/banana` is a hard 404. `credit-card`, `debit-card` and the
unhyphenated `netbanking` are 404s too — hence one card row, not two.

This replaced `order_meta.payment_methods`, which is the only lever that
narrows what the hosted page offers and is settable **solely at Create Order**.
Filtering that way meant creating a second order once the buyer had picked, so
one purchase produced two Cashfree orders and the address was attached to the
wrong one. The Orders API cannot help: it has Create, Get, Terminate and Get +
Update Order Extended, and none of them updates `order_meta`.

**One order for the whole checkout, including a failed OTP.** The order has to
exist before the OTP is sent, so a failed send used to leave a good order
stranded and create another on retry — measured 2026-08-27: three OTP 502s in a
row, four orders for one checkout. The widget now offers its existing session
back as `resumeSessionId`, and the server reuses it only if five checks pass,
one of which is that `orderAmountMinor` still equals the cart. It is a hint; the
server decides, and refuses on any mismatch. Charging a buyer a total they no
longer have is worse than a spare order.

**Payment tool dispatch, and why it is gone.** The widget used to hand payment
to the model, which called a `cashfree-here` tool so the host would render that
tool's widget in the conversation. That path is retired and commented out in
`MethodSelector.tsx` rather than deleted, because the measurements in it are
expensive to re-derive:

- The host gates payment tools on their MCP annotations. Against the honest ones
  — `{ readOnlyHint: false, destructiveHint: true }` for a tool that charges a
  card — the host declines: the model forms the intent, the host prefetches the
  widget template, and no `tools/call` ever arrives.
  `PAYMENT_ANNOTATIONS=readonly` flips them and four of five tools dispatch.
  That flag was a measurement, never a fix: it makes a tool that moves money
  claim it does nothing, to the exact control that exists to catch it.
- **The handoff was late, not lost.** `sendFollowUpMessage` does not ask the
  host to run a tool — it posts a user turn and resolves when that message is
  *delivered*, so the widget's 4s confirmation window was measuring a full model
  inference turn on the host's infrastructure. One captured session declared
  `CheckoutTool` blocked, the buyer took the link, and the `tools/call` arrived
  anyway ~12-20s in. The server handled it in 37ms.
- The consequence was worse than a slow screen: two live payment surfaces for
  one `payment_session_id`, the buyer paying on one while a Cashfree widget
  rendered behind them.
- **The "drops half the time" reading was our own bug.** Two `App` instances
  were opened on the one postMessage channel the MCP Apps transport gives you.
  The handshakes raced and the loser answered **"Not connected"** to everything
  afterwards. A coin-flip handoff is what a two-way race looks like, not a flaky
  host. That fix stands and matters beyond payment — see "One host bridge, ever"
  in `CLAUDE.md`.

The deciding argument was neither of those: the widget-to-model handoff drops
the `paymentSessionId` entirely on Claude. A link has no such dependency.

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

- **Card entry cannot render in Claude, and will not be fixed upstream.** No
  longer on the critical path — cards are paid on Cashfree's hosted page — but
  it is why in-conversation card entry is not an option here.
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
  is the shape this repo settled on too.

  Keeping card entry in-conversation is possible — plain `<input>` fields (no
  iframe) posting straight to this server, which is what `cashfree-here`
  shipped before commit `55da139` replaced it with Elements. It puts raw PANs
  through our server (SAQ-D territory) and 3DS still redirects out, so it buys
  the form and not the flow. Not built; a product decision, not a technical
  one.
- **Saved cards are not offered.** The hosted page decides what it shows, and
  this widget only picks the method. The retired tool path did list saved cards,
  and paying with one returned `HTTP 500` from `/pg/orders/sessions/js` —
  isolated on one order, with UPI and netbanking returning 200 against the same
  `payment_session_id`. A generic 500 is a Cashfree-side fault; their validation
  errors are 400s with specific messages. Never diagnosed, now moot here.
- **UPI is offered above its ₹1,00,000 limit** and fails on Cashfree's page
  rather than being disabled in the picker. The cart has no ceiling, so a few
  taps on `+` walk past it with no warning.
- **`cashfree-here` is patched in place.** Two fixes live in the sibling
  checkout, not in this repo: `useReconciliation.start()` now clears the
  previous poll timer, and the payment-success notification fires once per
  order. Without them a paid order posted "Payment completed successfully" to
  the chat every few seconds, forever.
- **The selected address reaches Shopify, not Cashfree.** The Shopify order
  carries it as shipping and billing. Cashfree is still not told which of the
  buyer's saved addresses they picked; unresolved, and needs an answer from the
  OCC team.
- **The session store is in-memory, and the order sync depends on it.** A
  restart mid-checkout loses the cart and the address, so a payment that lands
  afterwards is skipped with `no-session` — the money moved and no Shopify order
  exists. Logged loudly, not silently swallowed, but a real deployment needs
  shared storage with a TTL.
- **A cancelled Shopify order cannot be deleted.** Orders paid through a
  third-party gateway are cancel-and-archive only. Probing against a real store
  leaves permanent rows.
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
- **A price limit in the query string is matched as text and ignored.** Measured
  against belvish on 2026-08-31: `"perfumes under 5k"` sent as one query
  returned 100 products of which **49 broke the ceiling**, the dearest at
  Rs 20,900. Shopify matches "perfumes" and reads "under 5k" as noise, because a
  constraint has nothing in a product to match against. `catalog.filters.price`
  is the real thing, it takes **minor units**, and it excludes rather than
  re-ranks — a Rs 2,500 ceiling returned a different, cheaper set topping out at
  Rs 2,450. `SearchProducts` now carries `priceMin`/`priceMax` for exactly this.
- **`catalog.filters.categories` is accepted and does nothing.** A valid
  taxonomy id, a collection handle and the string `"totally-not-a-category"` all
  return byte-identical results to sending no filter at all — same 50 ids, same
  order, verified by hash. `filters.available` does work, and `filters.price`
  does; only categories is inert. The schema is `additionalProperties: true`, so
  an invented filter key is dropped just as quietly. Assume nothing in `filters`
  works until you have diffed the result ids with and without it.
- **A gender word is ranking, not a filter.** `"mens perfume"` returned 92 men's
  and zero women's, `"womens perfume"` the reverse, against a 21/21 split for
  plain `"perfume"` — so it genuinely narrows, but by scoring. Nothing excludes,
  so the tail thins rather than stopping. The product payload does carry
  `collections` (`men-fragrances`, 178 products; `women-fragrances`, 147), which
  is where a hard gender filter would have to come from.
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
- `order_meta.payment_methods` is settable **only at Create Order**. Nothing in
  the Orders API updates it afterwards — Create, Get, Terminate, Get + Update
  Order Extended, and none of them touches `order_meta`. Filter at open time
  with a `/payment-method/…` route instead of creating a second order.
- A 504 from `/pg/orders` is worth ten seconds of proof before you debug your
  own payload. Sandbox 504s at 17:15-17:17 on 2026-08-27 looked exactly like a
  bug here; hitting `POST /pg/orders` directly with the same body returned in
  0.22s once it recovered at 17:19.

**Shopify Admin**

- `orderCreate` needs an **offline** token (a custom app's `shpat_…` is one)
  and API version **2026-07** or later.
- `OrderCreateLineItemInput.requiresShipping` defaults to **false** and is *not*
  inherited from the variant. Order #1617 came out "Shipping not required" for a
  plainly shippable t-shirt. The flag is now read per variant in one batched
  `nodes(ids:)` query, defaulting to true.
- `OrderCreateOrderTransactionInput.test` also defaults to false, so sandbox
  payments were landing in the store's real reporting as genuine sales.
- Shopify enforces **phone and email uniqueness across customers**, and the
  order-level fields are checked against the associated customer. Setting
  `phone` cost a paid order to "Customer phone number has already been taken";
  an `email` that disagreed with the matched customer cost another. Associate
  with `customer.toAssociate`, omit `phone`, and send `email` only when it
  matches.
- Search by phone **or** email returns either match, so `edges[0]` will happily
  associate the wrong person. Match exactly — email first, then phone.
- `customer.lastName` cannot be blank. A one-word buyer name failed live
  checkout; the last token is the surname even when it is the only token.
- A discount must be told to Shopify or the order simply does not balance.
  Order #1623 landed `PAID` with `price=1000 received=900 outstanding=100
  discounts=0`. With `discountCode.itemFixedDiscountCode` (code capped at 254
  chars) #1624 gave `price=900 outstanding=0 discounts=100`.
- The pattern behind all six: **nothing optional may be able to fail the
  mutation that records the money.** Every one of those was a nicety —
  a name, a phone, an email, a shipping flag — that took the order down with it.

**The widget**

- **A card is a product; a cart line is a variant, and they do not line up.**
  Collapsing three colours of one t-shirt into one card is right for browsing
  and ambiguous for a stepper — a minus under a card holding one Red and one
  Blue has to guess which to take away. The card counts how many of the
  product's variants are in the cart and offers a stepper only when the answer
  is exactly one; otherwise it badges the total and sends the buyer to the
  detail screen. Refusing is cheaper than removing something they did not pick.
- **A backgrounded iframe's timers barely run, and the receipt waits on one.**
  The order poll backs off to 15s, but measured 2026-08-27 two live polls landed
  **58 seconds apart** while the buyer was on Cashfree's tab. The payment had
  already gone through. A `visibilitychange` listener now polls the instant the
  widget is looked at again and resets the backoff — rate-limited to one per
  second, because Claude flips visibility as the buyer scrolls and this repo has
  already taken a Shopify `429` from exactly that shape of fan-out.
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
- **Two 400s at the start of every connection are Claude, not a bug.** Captured
  off the wire on 2026-08-31: `Claude-User` opens with
  `MCP-Protocol-Version: 2026-07-28` and `server/discover` (id literally
  `server-discover-probe-1`), a newer-spec one-round-trip handshake. The SDK
  tops out at `2025-11-25` and rejects the *version header* before it ever looks
  at the method, so both probes 400 and Claude falls back to `initialize` a
  second later. Cost: 22ms per connection.

  Do not "fix" it by widening `SUPPORTED_PROTOCOL_VERSIONS`. Tried: the probe
  then returns 200 with `-32601 Method not found`, because the SDK has no
  `server/discover` handler either — so the fallback happens anyway and the only
  gain is a tidier log. Meanwhile `initialize` starts negotiating `2026-07-28`,
  which makes the server claim a protocol it does not implement. `1.30.0` is the
  newest published SDK and there is no prerelease; the spec is simply ahead of
  it.
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
| `POST /api/shop/search` | Catalog recovery for a host that reloaded without re-delivering the tool result. Carries `priceMin`/`priceMax`, or a reload silently widens the grid back out |
| `POST /api/pay/order` | Create the Cashfree order, priced from the Shopify cart |
| `POST /api/pay/otp`, `/otp/verify` | OTP login |
| `POST /api/pay/addresses/list`, `/addresses` | Saved addresses: read and create |
| `POST /api/pay/addresses/select` | Bind the address the buyer picked to the session, so the Shopify order can use it |
| `POST /api/pay/dispatched` | Did a payment tool handler actually run? Vestigial — the widget no longer asks |
| `POST /api/orders/status` | Order status, and the trigger that places the Shopify order once it reports `PAID` |
| `GET /api/orders/:id` | Raw order body for `cashfree-here`'s reconciliation |

## Logs

Every request logs method, path, status and duration; MCP calls name the method
and tool, and resource reads name the URI — `POST /mcp` alone is unreadable
when every host call looks identical.

```
13:59:48.201 → POST /mcp (tools/call SearchProducts) 200 328ms
13:59:52.884 → POST /api/shop/cart 200 904ms
14:00:03.117 → POST /api/pay/order 200 1026ms
14:00:09.640 ✗ POST /api/pay/addresses 502 121ms — Address line must be 10-185 characters
14:00:31.902 → POST /api/orders/status (ACTIVE) 200 210ms
14:00:44.118 → POST /api/orders/status (PAID #1626) 200 1804ms
```

The timestamp is there because durations alone cannot measure the gap *between*
two requests, which is the only question that matters when a payment dispatch
arrives late. Failures carry their reason: a live 502 on `/api/pay/otp` once
logged only its status, so the cause survived nowhere but the buyer's screen.

Successful `/api/*` responses carry an outcome where there is one worth saying.
The order poll logged only `200` for a long time, which made "did the widget
ever *see* the payment land?" unanswerable — a poll that stops on a terminal
status looks exactly like a poll that stopped for any other reason.

The order sync gets its own lines, one per outcome:

```
↑ shopify order #1626 for order_1756...
✗ shopify order for order_1756...: Customer last name can't be blank
· shopify order for order_1756... skipped: no-session
```

Every skip except `not-paid` is printed. The flow ends with money already taken,
so "nothing happened" is never an acceptable thing to discover later.

## Tests

```bash
npm test          # watch
npm run test:run
npm run type-check
```

562 tests, ~12s. Tests sit beside the code they cover. Fixtures under `src/lib/ucp/__fixtures__/`
are real captured Shopify responses, so a shape change fails a test rather than
a demo. Cashfree fixtures are hand-written and redacted — its session tokens
must not be committed.

## Documents

- `docs/cashfree-occ-api.md` — the OCC contract, verified live. Not in
  Cashfree's published docs.
- `docs/spikes/2026-08-12-occ-spike.md` — what the spike measured.
- `docs/superpowers/specs/` — design specs for each milestone.
- `docs/superpowers/plans/` — the task-by-task implementation plans they became.
