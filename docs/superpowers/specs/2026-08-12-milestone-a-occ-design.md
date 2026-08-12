# Milestone A — Cashfree OCC inside the MCP widget

**Date:** 2026-08-12
**Status:** Built and merged to `main`. See "As built" below — the design held,
six decisions in it did not.
**Repo:** `/Users/kishankumarmaurya/Development/AI/shopify-mcp-demo`
**Builds on:** `docs/superpowers/specs/2026-08-12-shopify-mcp-demo-design.md` (milestone 1)
**API contract:** `docs/cashfree-occ-api.md` — verified live, not from published docs

## As built — where this diverged

The shape below is what shipped: order before login, OTP, saved addresses,
payment, reconciliation. Six decisions in the rest of this document were
overtaken by measurement, and the code follows the measurement. Recorded here
rather than edited away, because each was reasonable when made — and #2 is
recorded as a wrong diagnosis rather than deleted, because how it survived
matters more than the fix.

**1. Payment in the conversation is gated on tool annotations.** The spec
assumed dispatching `cashfree-here`'s tools would render their payment widget.
It does — but only if the tools understate what they do. Against the honest
annotations the library ships (`readOnlyHint: false, destructiveHint: true`)
the host declines: the model forms the intent, the host prefetches the tool's
`outputTemplate`, and no `tools/call` arrives.

`PAYMENT_ANNOTATIONS=readonly` overrides them, and four of five tools then
dispatch — UPI, netbanking, hosted checkout, new card. `CardPaymentTool` stays
blocked even so, despite carrying annotations identical to
`NewCardPaymentTool`, which works. So annotations gate most of the surface and
are not the whole mechanism. Unsolved.

The flag is a measurement, defaults off, and must not ship: a tool that charges
a card declaring itself read-only defeats the control that exists to catch
exactly that.

**2. Every widget-facing read is a POST — for a reason that turned out to be
wrong.** The claim was that GET from the widget iframe never reaches the
server. It does. `cashfree-here`'s reconciliation GET carries
`ngrok-skip-browser-warning`, which makes the request preflighted, and the
server's `Access-Control-Allow-Headers` did not name that header — so the
browser refused the preflight and the GET was never sent. Adding it fixed
reconciliation, which until then reported "Unable to verify payment status"
and showed Payment Failed on orders that were already PAID.

The wrong diagnosis survived as long as it did because OPTIONS was filtered out
of the request log as noise, which left a refused request indistinguishable
from one that was never made. The POST-only routes still work and were left
alone; they are not necessary.

**3. OCC feature flags are not set on the order.** The spec passed
`checkoutCollectAddress` and `checkoutAuthenticate`. Since the widget collects
both, leaving them on made Cashfree's hosted page offer to do it all again —
a second login on the way to paying. The OCC endpoints do not require them.

**4. `/api/orders/:id` proxies Cashfree's raw body.** The spec had one
normalised status route. `cashfree-here`'s reconciliation parses the raw
Cashfree shape, so a normalised body leaves it unable to reach a terminal
state. Our own verification uses `POST /api/orders/status`.

**5. Only one screen reports the outcome.** The spec had our `PaymentResult`
confirm every payment. Each `cashfree-here` tool already renders its own
success and failure screen and runs its own reconciliation, so both fired and
the buyer saw two verdicts on one payment. `PaymentResult` is now reserved for
the external-link path, where nothing else is watching.

**6. Two bugs were fixed in `cashfree-here`, not here.**
`useReconciliation.start()` assigned over `intervalRef` without clearing it,
and is called from an effect whose dependencies change on re-render — so
timers accumulated, each polling to SUCCESS and posting its own "Payment
completed successfully" to the chat. The success notification was also not
idempotent. Both were invisible while the CORS bug made every poll fail; fixing
recon surfaced them immediately.

**Still open, as the spec anticipated:** the selected address is not bound to
the order; no Shopify order is created; the session store is in-memory; offers
and coupons are deferred with both APIs proven.

**Newly open:** `CardPaymentTool` cannot be dispatched at all; UPI is offered
above its ₹1,00,000 per-transaction limit instead of being disabled, and fails
at Cashfree with "payment method is not eligible for this order" (bisected:
₹99,600 ok, ₹100,800 fail).

## Problem

Milestone 1 ends by opening Shopify's hosted checkout in a new tab. Two things
are wrong with that as a Cashfree demo. The buyer leaves the conversation, and
the widget cannot observe the outcome — the popup is cross-origin and Shopify
reports nothing without an Admin token, so the terminal state is "checkout
opened" and nothing more.

Cashfree One Click Checkout solves both, but not through the Shopify app: that
integration is a theme snippet (`{% render 'cashfree' %}`) which hijacks the
storefront's Buy Now button client-side. Our cart never touches the storefront,
so it is bypassed entirely — confirmed by inspection, the tokenized checkout
URL we open reaches Shopify's native checkout with no Cashfree present.

The headless path does work, and every endpoint has been verified against
sandbox from a server with no browser involved.

## Scope

Cart → **create order** → **OTP login** → **address select or capture** →
**method selection** → payment → reconciled success.

Everything happens inside the MCP widget. The buyer never leaves the
conversation until Cashfree's own payment widget takes over, which is itself
in-conversation.

**Out of scope**, each for a stated reason:

- **Offers and coupons.** Deferred by decision. Both APIs are verified and
  documented; they are additive UI over an already-priced response and can be
  layered on without changing the flow.
- **Attaching the selected address to the order.** Unresolved — see Open
  Questions. The address step still ships; what is deferred is binding the
  choice to the order.
- **Creating a Shopify order.** Requires Admin API authentication, which this
  project has deliberately avoided. The order lives in Cashfree only.
- **Product detail screen, pagination, multi-store.** Unchanged from milestone 1.

## Why the order is created before login

Every OCC call requires an `x-chxs-id` header, and **that value is the
`payment_session_id` returned by Create Order**. Proven by control: a fabricated
session id returns `{"code":"payment_session_id_invalid"}`.

This inverts the sequence originally sketched (login → address → order). The
order comes first.

It is created at **phone submission**, not at the Checkout tap, because Create
Order requires `customer_details.customer_phone`. Collecting the phone first
resolves the dependency and yields one `payment_session_id` that threads through
OTP, addresses, payment and reconciliation.

**Consequence, accepted:** a buyer who abandons after entering their phone
leaves an `ACTIVE` unpaid order. For a demo this is noise; for production it
would need an expiry or cancellation policy.

## Architecture

```
ChatGPT / Claude
   │ SearchProducts (model-facing, unchanged)
   ▼
our widget ──── /api/shop/cart ────► Shopify UCP        (milestone 1)
   │
   │ Checkout tapped
   ├─ PhoneEntry   ─► POST /api/pay/order      ─► Cashfree Create Order
   ├─ OtpEntry     ─► POST /api/pay/otp        ─► auth/initiate
   │                 POST /api/pay/otp/verify  ─► auth/sessions
   ├─ AddressStep  ─► GET/POST /api/pay/addresses
   └─ MethodSelector ── callTool("UpiTool", { paymentSessionId }) ──┐
                                                                    ▼
                                        cashfree-here's widget renders payment
                                                                    │
   ◄──── GET /api/orders/:id (recon) ◄───────────────────────────────┘
```

Our widget owns catalog → cart → phone → OTP → address → method choice. At the
moment a method is chosen, `cashfree-here`'s **separate widget resource** takes
over and renders UPI / card / netbanking itself. We write no payment UI.

## Components

### Server

| File | Responsibility |
|---|---|
| `src/lib/cashfree/config.ts` | Credentials and base URL from env; `sandbox` \| `production` |
| `src/lib/cashfree/orders.ts` | Create Order; `Cart` → `cart_items` mapping; order status fetch for recon |
| `src/lib/cashfree/occ.ts` | `auth/initiate`, `auth/sessions`, GET/POST addresses. Three-header calls |
| `src/lib/cashfree/session.ts` | In-memory `payment_session_id → { authToken, phone, orderId }` |
| `src/lib/server/payHandlers.ts` | Route handlers, mirroring `handlers.ts` |
| `server.ts` | New `/api/pay/*` and `/api/orders/:id` routes; register Cashfree widget + payment tools |

### Widget

| File | Responsibility |
|---|---|
| `src/components/PhoneEntry.tsx` | Ten-digit input, validation, submit |
| `src/components/OtpEntry.tsx` | OTP input, resend, error states |
| `src/components/AddressStep.tsx` | Saved-address list, or inline capture form when empty |
| `src/components/MethodSelector.tsx` | Method list, tool dispatch, waiting state |
| `src/hooks/useCheckoutFlow.ts` | The state machine across the five new screens |
| `src/hooks/useOrderStatus.ts` | Polls `/api/orders/:id` until a terminal status or timeout |

`PaymentMethodSelector.tsx` in the reference demo is 1,015 lines and mixes the
method list, tool dispatch, prompt construction, waiting states and
reconciliation. We take its behaviour, not its shape: dispatch lives in
`MethodSelector`, flow state in `useCheckoutFlow`, polling in `useOrderStatus`.

### Reconciliation is ours to write

`cashfree-here` has a `useReconciliation` hook, but **it cannot be imported**.
The package's export map exposes only `dist/server/index.js` (the tools and
widget registration); `src/hooks/` is not exported and `build:server` does not
compile it into `dist`.

So `useOrderStatus` is new — roughly forty lines: poll `/api/orders/:id` on an
interval, stop at the first terminal status, stop at a timeout. Writing it also
means we can test it against our own fake clock rather than a vendored one, and
it keeps the widget's only dependency on `cashfree-here` at the server layer,
where the export map actually supports it.

## The auth token never reaches the widget

`authentication_token` is a bearer credential for a customer's address book. The
widget runs in a browser inside a third-party host, so it holds only the
`payment_session_id`; the server looks the token up when calling OCC.

`session.ts` is an in-memory `Map`. It dies on restart, which means an
in-progress checkout cannot be resumed across a server restart. For a demo that
is acceptable and it is stated here rather than discovered later. A real
deployment needs shared storage with a TTL.

## HTTP routes

All widget-facing, same shape and CORS treatment as `/api/shop/cart`.

| Route | Body | Returns |
|---|---|---|
| `POST /api/pay/order` | `{ cartId, phone }` | `{ orderId, paymentSessionId, amount }` |
| `POST /api/pay/otp` | `{ paymentSessionId }` | `{ sent: true }` |
| `POST /api/pay/otp/verify` | `{ paymentSessionId, otp }` | `{ ok: true }` |
| `GET /api/pay/addresses` | `?paymentSessionId=` | `{ addresses: [...] }` |
| `POST /api/pay/addresses` | `{ paymentSessionId, address }` | `{ addresses: [...] }` |
| `GET /api/orders/:orderId` | — | order status, for reconciliation |

`POST /api/pay/order` re-reads the cart from Shopify by `cartId` rather than
trusting amounts posted by the widget. A client-supplied price is a client-
supplied price; the server prices the order from the source of truth.

**Order creation and OTP dispatch are two calls, not one.** Submitting the phone
calls `/api/pay/order`, and the widget then immediately calls `/api/pay/otp`.
Folding them together would save a round trip but would give resend no endpoint
of its own — resend is the same `auth/initiate` call, and it needs to be
reachable without creating a second order.

## Cart → `cart_items` mapping

Every field is available. `handle` and `list_price` are already in
`search_catalog`'s response but are dropped by the current `normalise.ts`, so
that file gains two fields.

| Cashfree | Source | Note |
|---|---|---|
| `item_id` | `line.variantId` | |
| `item_name` | `line.title` | |
| `item_description` | `product.description.html` | |
| `item_details_url` | `https://{SHOP_DOMAIN}/products/{handle}` | constructed |
| `item_image_url` | `line.imageUrl` | |
| `item_original_unit_price` | `variant.list_price` ÷ 100 | |
| `item_discounted_unit_price` | `variant.price` ÷ 100 | |
| `item_quantity` | `line.quantity` | |
| `item_currency` | `cart.currency` | |
| `order_amount` | `cart.total.amountMinor` ÷ 100 | major units |

**Two money formats meet here.** Shopify UCP is minor-unit integers with
currency held once on the cart; Cashfree is major-unit decimals per field. The
conversion happens only in `orders.ts` and is tested, including a zero-decimal
currency case.

## Screen flow and state

`useCheckoutFlow` drives a linear machine, persisted through `useWidgetState` so
a host re-render does not drop the buyer mid-checkout:

```
cart → phone → otp → address → method → paying → done
                ↑______ resend / wrong otp
         address ←─ back
```

Only `paymentSessionId`, `orderId`, `phone` and the chosen address id are
persisted. The OTP is never persisted.

Once `method` dispatches, our widget yields to Cashfree's. On return, `paying`
polls `/api/orders/:orderId` via `useOrderStatus`.

## Payment dispatch

`MethodSelector` calls `callTool(toolName, { paymentSessionId, ... })` **first**,
falling back to `sendFollowUpMessage` only if `callTool` is unavailable.

The reference demo does the opposite. That ordering matters: `sendFollowUpMessage`
asks the *model* to invoke the tool, which puts it behind the host safety gate
that `cashfree-here`'s CheckoutTool spec measured refusing `NewCardPaymentTool`
at 3 taps → 0 dispatches. `callTool` dispatches directly from the widget, with
no model in the loop. All four payment tools are registered with
`openai/widgetAccessible: true`, which is what permits this.

Methods offered: UPI, saved card, new card, netbanking — the four
`cashfree-here` exposes. Hosted checkout (`cashfreeCheckoutTool`) is registered
as a fallback entry, so a buyer whose method fails still has a route to pay.

## Reconciliation and the success state

With `orderId` and credentials we can finally poll. `GET /api/orders/:orderId`
proxies Cashfree's order status; the widget polls it with `useOrderStatus`.

Terminal states: `PAID` → success; `FAILED` → error with retry; timeout →
**non-committal copy**. A timeout means we do not know, not that payment failed.
Telling a buyer their payment failed when their card may have been charged is
the worst thing this widget can do, and the copy never asserts failure on a
timeout. Milestone 1's blindness is gone, but the discipline behind it is not.

## Error handling

| Failure | Behaviour |
|---|---|
| Invalid phone (not 10 digits) | Inline validation; no request sent |
| Create Order rejected | Surface Cashfree's `message`; stay on phone screen |
| OCC rejects the session | "Your checkout session expired" → restart from cart |
| Wrong OTP | Inline error, input retained, resend offered |
| OTP resend limit | Cashfree's message surfaced verbatim |
| No saved addresses | Not an error — capture form is the expected path |
| Address create fails | Form retained with values, error shown |
| Payment tool won't dispatch | Fall back to `sendFollowUpMessage`, then hosted checkout |
| Recon timeout | Non-committal; offer to check again |
| Server restarted mid-flow | Session lookup fails → "session expired", restart from cart |

## Testing

vitest, RED → GREEN → REFACTOR, as milestone 1.

**Fixtures are hand-written and redacted.** Unlike the Shopify work, live OCC
responses must not be committed: `authentication_token`, `payment_session_id`
and `customer_uid` are per-session secrets. Shapes come from
`docs/cashfree-occ-api.md`.

**Server** — `fetch` mocked at the boundary:
- `cart_items` mapping produces every field; money converts minor → major
- Zero-decimal currency is not divided
- Create Order sends `products.one_click_checkout` with both feature flags
- `/api/pay/order` prices from the Shopify cart, ignoring any client-sent amount
- OCC calls carry exactly the three required headers
- Auth token is looked up server-side and never returned in any response body
- Unknown `paymentSessionId` → 400, not a crash
- Cashfree error messages are surfaced, not replaced

**Widget** — Testing Library:
- Phone validation rejects short, non-numeric, and empty input
- OTP screen shows resend and preserves input on error
- Address list renders saved addresses; empty list renders the capture form
- Address selection advances to method
- `MethodSelector` calls `callTool` and only falls back when it is absent
- Recon states each render; timeout renders non-committal copy
- No response body or widget state ever contains the auth token

## Open questions, carried deliberately

**How a selected address binds to the order is unresolved.** `POST …/addresses`
adds to the customer's address book; nothing observed marks one as this order's
shipping address, and the GET returns several with no selection field.
Candidates: an unfound endpoint, a field at payment time, or the checkout
defaulting to most-recent. The address step ships regardless — the buyer sees
and picks an address — but the binding is deferred and must be resolved before
this is more than a demo.

**Whether the OCC feature flags must stay enabled.** We pass
`checkoutCollectAddress` and `checkoutAuthenticate` on the order even though we
collect both ourselves, because the OCC endpoints may require an OCC-enabled
session. If Cashfree's payment widget then re-asks for either, the flags come
off and we retest. First spike in the plan.

**Whether all four payment tools dispatch via `callTool`.** Verified for none of
them yet. Second spike. If some do not, the method list shrinks to those that do.

## Known limitations

- Order exists in Cashfree only; Shopify sees nothing
- In-memory session store; no resume across restart
- OCC endpoints are internal, unversioned, and may change without notice
- Selected address is displayed but not bound to the order
- INR only, matching the demo stores
