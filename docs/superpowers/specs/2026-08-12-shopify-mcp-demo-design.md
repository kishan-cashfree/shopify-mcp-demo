# Shopify UCP storefront as an MCP App — milestone 1

**Date:** 2026-08-12
**Status:** Built and merged. Superseded in part by milestone A — checkout no
longer opens Shopify's hosted page; payment runs through Cashfree. See
`2026-08-12-milestone-a-occ-design.md`.
**Repo:** `/Users/kishankumarmaurya/Development/AI/shopify-mcp-demo` (greenfield)
**Demo store:** `sbox-mukul-store.myshopify.com`

## Problem

Cashfree needs a demo that shows a real merchant catalog being shopped from
inside an AI host (ChatGPT / Claude), ending in a real payment. `cashfree-here`
already ships the payment half as an MCP Apps SDK; `demo/` (good-food) shows the
widget pattern against invented data. Nothing yet connects an MCP App to a live
storefront.

Shopify exposes every store over MCP with **no authentication** — the shop
domain is the entire configuration. That makes a live-catalog demo cheap enough
to be worth building.

## Scope

Milestone 1 is **Shopify-only**. Browse a store's catalog, build a cart, open
Shopify's hosted checkout. The merchant has already configured Cashfree as a
payment method on that store, so Cashfree's payment page appears inside
Shopify's checkout without this project writing any payment code.

Milestone A — replacing Shopify's hosted checkout with Cashfree order creation,
`cashfreeCheckoutTool`, mobile-OTP login, saved addresses and offers — is
explicitly **out of scope** and gets its own spec once those Cashfree APIs are
documented. Neither `cashfree-here` nor `demo/` implements them today; the only
OTP in `cashfree-here` is card 3DS OTP, which is a different thing.

## Findings from the spike

All verified live against `sbox-mukul-store.myshopify.com` on 2026-08-12. These
override the published documentation, which is wrong in three places.

### `/api/mcp` is deprecated and must not be used

Every response from `/api/mcp` carries:

> DEPRECATION NOTICE: This tool is served by the Storefront MCP server at
> /api/mcp and will no longer be accessible after **August 31, 2026**. Migrate
> to the UCP-conforming tools at /api/ucp/mcp.

Nineteen days from the date of this spec. **This project targets
`/api/ucp/mcp` exclusively.** No legacy calls, no fallback path — a fallback to
an endpoint that disappears this month is a liability, not a safety net.

### The documented endpoint split is reversed

`shopify.dev` states catalog tools live on `/api/ucp/mcp` and cart tools on
`/api/mcp`. The reverse is true: `/api/mcp` serves the legacy set
(`search_catalog`, `get_cart`, `update_cart`, `get_product_details`,
`search_shop_policies_and_faqs`), and `/api/ucp/mcp` serves the full UCP set.

Since we are UCP-only, this collapses to a convenience: **one endpoint, one
client, one tool namespace.**

### The UCP tool surface

`/api/ucp/mcp` exposes 13 tools:

| Cluster | Tools |
|---|---|
| Catalog | `search_catalog`, `lookup_catalog`, `get_product` |
| Cart | `create_cart`, `update_cart`, `get_cart`, `cancel_cart` |
| Checkout | `create_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout` |
| Order | `get_order` |

Milestone 1 uses three: `search_catalog`, `create_cart`, `update_cart`.

The checkout cluster is agentic checkout — `create_checkout` accepts payment
instruments (`type: "card"` / `"token"`, with `handler_id` and billing address).
That is the probable home of milestone A's Cashfree work and is recorded here
so the decision is informed when the time comes. Not used now.

### Field names differ from the documentation

`update_cart` line items are documented as `merchandise_id`. The server rejects
that outright:

> Invalid arguments: object at `/add_items/0` is missing required properties:
> product_variant_id

Legacy requires `product_variant_id`. **UCP requires `line_items[].item.id`**,
which is what this project uses.

### `search_catalog` returns everything the grid needs

One call yields, per product: `id`, `title`, `description.html`, `price_range`,
product-level `media[]`, `categories[]`, `options[]`, and a full `variants[]`
array where each variant carries `id`, `title`, `price`, `availability.available`,
`options[]` and its own `media[]`.

This is why milestone 1 needs no product detail screen and never calls
`get_product` — the search response already contains variant ids and prices,
which is all the cart requires.

### `create_cart` returns the hosted checkout URL as `continue_url`

Top-level keys on the UCP cart: `ucp`, `id`, `line_items`, `currency`,
`discounts`, `totals`, `fulfillment`, `expires_at`, `links`, `messages`,
**`continue_url`**. The legacy endpoint calls the same thing `checkout_url`.
`continue_url` is the Checkout button's target.

Each `line_items[]` entry carries `id`, `quantity`, `totals[]`, and an `item`
object with `id`, `title` (already merged as `"short sleeve t-shirt - Red"`),
`price` and `image_url`. **The cart screen renders directly from this response
and needs no supplementary lookups.**

### Money formats differ between endpoints

UCP is consistently **minor units as integers** (`120000` = ₹1,200.00) with
`currency` held once at cart level, not per amount. Legacy returns decimal
strings in major units (`"2400.0"`) with a currency alongside.

We are UCP-only, so only the minor-unit form reaches us — but the boundary is
still the single place money is normalised, and it is tested. Raw amounts never
reach a component.

### `meta["ucp-agent"].profile` is mandatory

Every UCP tool lists `meta` in its `required` array, and `meta.ucp-agent.profile`
is required within it. Shopify's public example profile
(`https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json`)
is accepted and is what the demo ships with, via `UCP_AGENT_PROFILE` in `.env`.

A production integration hosts its own agent profile describing its real
capabilities. Borrowing Shopify's example is acceptable for a stakeholder demo
and unacceptable for anything else. This is recorded as a known shortcut.

## Architecture

Mirrors `demo/` (good-food), which is the proven shape for this stack.

```
ChatGPT / Claude (MCP host)
        │  tools/call SearchProducts({ query })
        ▼
Node MCP server  (server.ts, esbuild bundle)
  ├─ /mcp        MCP over HTTP  — 1 tool, 1 widget resource
  ├─ /api/shop/* JSON proxy for the widget
  └─ UCP client ──── HTTP POST JSON-RPC ───► https://{SHOP_DOMAIN}/api/ucp/mcp
        │  widget state + _meta
        ▼
React widget (Vite, Tailwind 4, @openai/apps-sdk-ui)
  ├─ Results screen — product grid
  └─ Cart screen    — line items, totals, Checkout
        │  user tap
        ▼
continue_url in _blank popup → Shopify hosted checkout → Cashfree payment page
```

**Stack:** React 18, TypeScript, Vite, Tailwind 4, `@modelcontextprotocol/sdk`,
`@modelcontextprotocol/ext-apps`, `@openai/apps-sdk-ui`, `zod`, esbuild for the
server bundle, vitest for tests. No `cashfree-here` dependency in milestone 1 —
adding a payment SDK that nothing calls would misrepresent what the demo does.

### Why the server proxies for the widget

The widget runs in a sandboxed cross-origin iframe. Shopify's CORS posture on
`/api/ucp/mcp` is unverified, and discovering it is broken in front of
stakeholders is the expensive way to find out. Proxying makes it a non-question
and keeps JSON-RPC envelope handling, response unwrapping and money
normalisation in exactly one place.

## Components

| File | Responsibility |
|---|---|
| `server.ts` | MCP server, widget resource, `SearchProducts` tool, `/api/shop/*` routes, static widget serving. Mirrors `demo/server.ts`. |
| `src/lib/ucp/client.ts` | UCP JSON-RPC caller. Builds the envelope, injects `meta.ucp-agent.profile`, POSTs, unwraps `result.content[0].text`, throws on `isError`. |
| `src/lib/ucp/normalise.ts` | UCP payloads → internal types. Money to a single `{ amountMinor, currency }` shape; product/variant flattening. |
| `src/lib/ucp/types.ts` | Internal `Product`, `Variant`, `Cart`, `CartLine`, `Money`. Hand-written from spike fixtures, not from docs. |
| `src/components/Results.tsx` | Product grid: image, title, price, variant subtext, Add button. |
| `src/components/Cart.tsx` | Line items, quantity steppers, total, Checkout button, blocked-popup fallback link. |
| `src/components/App.tsx` | Screen routing between Results and Cart. |
| `src/hooks/useWidgetState.ts` | Cart state persistence across host re-renders. Ported from `demo/`. |
| `src/hooks/useCart.ts` | Cart mutations against `/api/shop/cart`. Server response is authoritative. |

### The double unwrap

MCP returns tool results as `result.content[0].text` — a **JSON string**, not an
object. Every UCP response therefore needs two parses: the JSON-RPC envelope,
then the text payload. Errors arrive the same way, as human-readable text with
`isError: true` alongside. `client.ts` is the only file that knows this; it is
the single reason that file exists.

## MCP surface

One model-facing tool:

```ts
name: "SearchProducts"
inputSchema: z.object({ query: z.string().min(1) }).passthrough()
```

`.passthrough()` for the same reason `cashfree-here` requires it: zod strips
unknown keys by default, which silently deletes host-injected arguments.

The handler calls `search_catalog`, then splits the response:

- **to the model:** a one-line text summary (`Found 12 products for "shirt"`)
- **to the widget:** the full normalised product array via `_meta`

This is the split `demo/server.ts` already uses. Sending a full catalog through
the model wastes context and invites it to hallucinate prices it half-remembers
rather than render the ones we returned.

Plus one widget resource registration. One tool, one resource, nothing else.

### Why only search is model-facing

Considered and rejected: registering `AddToCart` / `Checkout` as model-facing
tools. `cashfree-here`'s CheckoutTool spec records a measured result —
`NewCardPaymentTool` at **3 taps → 0 dispatches** — where ChatGPT's safety gate
refuses payment-shaped tools carrying honest annotations. A six-tool chain gives
that gate six chances to break the demo live. Cart mutations therefore stay
inside the widget over plain HTTP, exactly as `CardPayment.tsx` already handles
multi-step 3DS without returning to the model.

Search stays model-facing because that is the part worth demonstrating: the user
types "running shoes under 3000", the model calls our tool, the query reaches a
live merchant catalog. That is the MCP story. Everything after it is a funnel,
and funnels should be deterministic.

## HTTP routes

Served by the same Node server as `/mcp`, with CORS, mirroring `demo/server.ts`.

| Route | Purpose |
|---|---|
| `POST /api/shop/cart` | `{ cartId?, lines }` → normalised cart. Creates when `cartId` is absent, updates when present. |

One route, not two. There is no `/api/shop/search`: search reaches Shopify only
through the `SearchProducts` tool handler, and the widget has no search box in
milestone 1. Adding a search route the widget never calls would be dead code
shipped for symmetry.

The route delegates to `src/lib/ucp/client.ts`. No cart state on the server —
the cart id lives in widget state and Shopify holds the truth.

## Data flow

```
user     "show me shirts"
model  → SearchProducts({ query: "shirt" })
server → search_catalog                         → products[]
       → model: "Found 4 products"
       → widget: _meta.products (normalised)

widget   Results grid
user     taps Add
widget → POST /api/shop/cart { lines: [{ variantId, quantity: 1 }] }
server → create_cart                            → cart + continue_url
widget   stores cartId, renders Cart screen

user     adjusts quantity
widget → POST /api/shop/cart { cartId, lines }
server → update_cart                            → cart (authoritative)

user     taps Checkout
widget   window.open(continue_url, "_blank")    synchronously, in the handler
         → Shopify hosted checkout → Cashfree payment page
widget   "Checkout opened in a new tab."  ← terminal state
```

### Cart mutations never update locally first

Every quantity change round-trips `update_cart` and re-renders from the
response. Optimistic local mutation would need reconciliation against a server
that also applies discounts, availability limits and price changes — two
sources of truth for one cart, in a demo where a wrong total in front of
stakeholders is the worst possible failure. The round-trip costs a moment of
latency and buys correctness.

### The open must be behind a user tap

`window.open` must run synchronously inside the click handler. Calling it from
an async continuation is precisely what popup blockers suppress, and a blocked
`window.open` fails silently. `continue_url` is already in widget state from the
last cart response, so no await is needed before opening. This mirrors the
reasoning in `cashfree-here`'s CheckoutTool spec.

## The blind spot, stated plainly

After the popup opens, **the widget cannot know what happened.** The popup is
cross-origin at every hop (Shopify checkout → Cashfree → confirmation), so
nothing is readable from it. Shopify will not report order status without an
Admin API token, which reintroduces the authentication this design avoids.

So the widget's terminal state is "Checkout opened in a new tab" and nothing
more. **No success screen, no order confirmation, no polling.** Showing a
fabricated success would be worse than showing nothing: it would assert an
outcome we have not observed, about money.

This is the honest ceiling of milestone 1 and precisely the gap milestone A
closes — Cashfree order creation is what buys back `/api/orders` reconciliation
and a real success state.

## Configuration

`.env`, mirroring `demo/.env.example`:

```
SHOP_DOMAIN=sbox-mukul-store.myshopify.com
UCP_AGENT_PROFILE=https://shopify.dev/ucp/agent-profiles/examples/2026-04-08/valid-with-capabilities.json
PORT=8787
# SERVER_URL=https://your-tunnel.ngrok-free.app   # set when tunnelling
```

`SHOP_DOMAIN` is the whole store configuration. Swapping stores is a one-line
edit and a restart — which is the demo-able point about Shopify's MCP.

## Error handling

| Failure | Detection | Behaviour |
|---|---|---|
| Unknown / typo'd shop domain | Non-200 from Shopify | "Couldn't reach this store." Domain shown so the typo is visible. |
| Search returns nothing | Empty `products[]` | Empty state with the query echoed. Not an error. |
| `isError: true` from UCP | Flagged in the envelope | Surface Shopify's own message — its validation text is specific and useful. |
| Cart mutation fails | Non-200 or `isError` | Revert to last known server cart, show retry. Never leave a wrong total on screen. |
| Shopify timeout | No response in 10s | One retry, then surface. |
| Popup blocked | No window handle from `window.open` | Render `continue_url` as a plain clickable link. |
| Variant unavailable | `availability.available === false` | Add button disabled on the card. |

## Testing

vitest, following `cashfree-here` (which has tests) rather than `demo/` (which
has none). RED → GREEN → REFACTOR per `superpowers:test-driven-development`.

Spike responses are committed as fixtures under `src/lib/ucp/__fixtures__/` —
real captured payloads from `sbox-mukul-store.myshopify.com`, not hand-written
approximations. Types are derived from these, so a Shopify shape change fails a
test instead of a demo.

**UCP client** (`testing-node-backend`, mocking `fetch` only)

- Builds a well-formed JSON-RPC envelope with `meta.ucp-agent.profile` injected
- Double-unwraps `result.content[0].text` into an object
- Throws with Shopify's message when `isError: true`
- Surfaces a network failure rather than returning an empty result

**Normalisation**

- Minor units + cart-level currency → internal `Money`; `120000` INR renders as ₹1,200.00
- Zero-decimal currencies (JPY) are not divided
- Products with a single variant, and with several, both flatten correctly
- Unavailable variants are marked, not dropped

**Tool handler**

- Model receives the summary text only; product data goes to `_meta`
- Empty query is rejected by the schema
- Unknown keys survive `.passthrough()`

**Components** (`testing-react-web`)

- Grid renders title, formatted price and image from fixture data
- Add posts the correct `variantId`
- Quantity change re-renders from the server response, not from local state
- A failed mutation reverts to the previous cart and shows retry
- Empty search renders the empty state
- Checkout opens `continue_url` with `_blank`
- Blocked popup renders the fallback link
- Unavailable variant renders a disabled Add

Mocking is at the boundary only: `fetch`, `window.open`, the clock. No mocking
of our own components or hooks.

## Known limitations, carried deliberately

- **No payment outcome visibility.** Cross-origin popup, no Admin token. See above.
- **Borrowed UCP agent profile.** Shopify's public example. Fine for a demo, not for production.
- **No product detail screen.** Two screens by decision. Variants resolve to the first available option with the variant name as cart-row subtext. Stores whose products differ meaningfully by variant (size-driven apparel, footwear) will look thin. Accepted for a stakeholder demo; the fix is milestone A's detail screen.
- **No cart persistence across sessions.** Cart id lives in widget state and dies with it.
- **INR-shaped.** The demo store is INR. Formatting is currency-driven and tested against a zero-decimal case, but only INR is exercised live.

## Out of scope

- Any Cashfree code: order creation, `cashfreeCheckoutTool`, OTP login, sessions, saved addresses, offers
- UCP's `create_checkout` / `complete_checkout` agentic checkout cluster
- Product detail screen and variant picker
- `lookup_catalog`, `get_product`, `search_shop_policies_and_faqs`, `get_order`
- Order confirmation or reconciliation of any kind
- Multi-store support, store switching at runtime
- Pagination beyond the first page of search results
