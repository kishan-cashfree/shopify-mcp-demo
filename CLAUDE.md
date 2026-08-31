# CLAUDE.md

Guidance for Claude Code working in this repo. Read `README.md` too — it holds
the measured findings about Shopify, Cashfree and the AI hosts. This file is
about how to work here.

## What this is

A Shopify storefront exposed as an MCP App, paid for with Cashfree, running
inside ChatGPT and Claude. One server is four clients at once: an MCP server to
the host, an MCP client to Shopify's storefront (`/api/ucp/mcp`,
unauthenticated), a REST client to Cashfree, and a GraphQL client to the Shopify
**Admin** API that places the real order once the payment lands.

Only `SearchProducts` is model-facing. Everything after it — browsing, cart,
OTP, address, payment — is widget-to-server over `/api/*`, which keeps the flow
deterministic and out of the model's hands. The buyer browses a grid of
products, opens one for its detail screen, and adds from either.

Payment is a link to Cashfree's hosted checkout, deep-linked into the chosen
method's route on the one order the checkout already created. The model is not
involved; the retired tool-dispatch path is commented out in
`MethodSelector.tsx` and should stay that way — see `README.md` for what it
cost to learn.

## Commands

```bash
npm run build       # widget (vite) then server (esbuild) — both needed
npm start           # node --env-file=.env dist/server.js, port 8787
npm run test:run    # 562 tests, ~12s
npm test            # watch
npm run type-check
```

There is no lint step. `npm run type-check` and the tests are the gate.

## Verifying a change actually reached the browser

This has cost more time than every real bug in this repo combined.

1. `npm run build` — a rebuild alone changes nothing the host can see.
2. Restart the server. Two processes can end up bound to 8787 if the old one
   has not died; check `lsof -ti:8787` returns exactly one pid.
3. **Disconnect and reconnect the connector in the host.** A new chat is *not*
   enough. Claude has served a cached widget across both rebuilds and fresh
   conversations.
4. Confirm `POST /mcp (resources/read ui://widget/shopify-store-<build>.html)`
   appears in the log. No `resources/read` means the browser is running old
   code and anything you conclude from it is worthless.

The build id in that line is the *host's*, not the server's. A host will ask for
a URI from an earlier build — the server answers for any of them — so a
`resources/read` proves the host fetched something, not that it fetched what you
just built. Two ids in one conversation is normal. `window.__BUILD__` on the
payment screen is the only thing that says which bundle is executing.

**Do not rebuild while someone is testing.** It changes the build id mid-session
and mixes bundles inside one conversation, which makes the log unreadable
exactly when you need it.

Server logs go to stdout. When run in the background, tee them to a file — the
log is the primary evidence for anything involving the host.

The origin the widget calls back on is derived per request from the address it
arrived on (`requestOrigin.ts`) and injected as `window.__SERVER_URL__`. There
is nothing to configure and no restart needed when a tunnel URL changes. A
`SERVER_URL` setting used to do this by hand; it is gone, and `README.md`
records what that cost.

## Testing

Tests sit beside the code. TDD is expected: write the failing test first and
show it failing. Every bug fixed here got a test that reproduces the real
defect, not a proxy for it — the comment above each one records the measured
symptom (timestamps, ids, actual log lines) so the next person knows why it
exists.

- `src/lib/ucp/__fixtures__/` holds real captured Shopify responses. A shape
  change should fail a test, not a demo.
- Cashfree fixtures are hand-written and redacted. Its session tokens must
  never be committed.
- Mock at the boundary. `App` from `@modelcontextprotocol/ext-apps` is mocked
  at the package level so call *order* is observable — that ordering is the
  defect in several of these tests.

## Architecture notes that are easy to get wrong

**Widget state is not owned by widget state.** `useCart` and `useCheckoutFlow`
seed themselves at mount from what they are passed and never re-read it. They
are the real owners; `WidgetState` is a shadow copy they write into. Clearing
the shadow copy does nothing — the session is keyed on `searchId` so React
discards and re-seeds the hooks instead. If you add another stateful hook here,
it inherits this trap.

**Host state outlives the widget.** Every tool result carries a `searchId` so a
new search can be told from a repaint. Resets derive during render, never in an
effect, or the old screen paints first.

**A remount is routine, not an event.** Claude recreates the widget iframe as
the buyer scrolls and serves the HTML from its own cache, so no `resources/read`
marks it. Anything a hook fetches on mount is therefore fetched per scroll, per
widget — that is how three widgets became three `update_cart` calls per reload
and eventually a Shopify `429`. Persist what you would otherwise refetch, and
read `OPTIONS /api/*` in the log to spot a remount: a CORS preflight is cached
per document, so a fresh one means a fresh document.

Gating on visibility does not work — `IntersectionObserver` with a null root
measures against the widget's own iframe viewport, so every offscreen widget
reports itself visible. That was built and deleted; don't rebuild it.

**Every build id must keep working.** `WIDGET_URI` is versioned per bundle, so a
rebuild retires the id that widgets already in a conversation were created with.
A `ResourceTemplate` serves the current bundle for retired ids; without it those
widgets render "store could not load".

**One host bridge, ever.** The MCP Apps transport is a single postMessage
channel. `getClientPlatform()` owns the only `App`; `useMcpApp` subscribes to
it. Constructing a second one races the handshake and the loser answers
"Not connected" to everything after it. Never call `new App()` outside
`platform.ts`, and never `close()` the singleton on unmount.

**Two host ecosystems, different key names.** `src/lib/server/widgetMeta.ts`
emits both `openai/*` and `_meta.ui.*` from one source. Hand-writing either
block again will let them drift, which is how product images ended up blocked
on Claude while working in ChatGPT.

**Nested iframes are blocked on Claude** and will not be unblocked — see the
card entry limitation in `README.md`. Do not design anything around an iframe
to a third-party origin.

**A card is a product; a cart line is a variant.** The grid collapsed to one
card per product, so the two no longer line up. `cardControl` in `Results.tsx`
decides what a card may offer by counting how many of that product's variants
are in the cart: exactly one is a stepper, several is a badge and no stepper,
none is Add — and Add on a multi-variant product opens the detail screen rather
than choosing a colour on the buyer's behalf. Where the mapping is ambiguous,
refuse; a minus that removes a colour the buyer did not pick is worse than an
extra tap.

**`ProductDetail` holds no state.** The selected product and variant live in
`WidgetState` and arrive as props, because the widget remounts as the buyer
scrolls and a local `useState` would drop the selection with it. The same
reason the cart body is persisted applies here.

**Nothing optional may be able to fail the mutation that records the money.**
`createPaidOrder` in `src/lib/shopify/admin.ts` runs after the buyer has paid,
so a rejected mutation is a lost order, not a retry. Four separate niceties took
one down: a blank surname, a customer phone Shopify considered taken, an order
email disagreeing with the associated customer, and a variant's shipping flag.
Anything you add to that payload must either be guaranteed valid or be omitted
when it is not — never sent hopefully.

**Every refusal to place an order is named.** `orderSync.ts` returns
`no-admin-token`, `not-paid`, `no-session`, `no-cart` or `no-address`, never a
boolean. Two are configuration, one is a lost session, one is an incomplete
checkout, and the flow ends with money already taken — a log line saying which
is the difference between a five-minute fix and an afternoon. A *failure* is
deliberately not recorded on the session, so the poll retries it; only a success
is, and that record is the whole idempotency story, because the poll fires every
couple of seconds and does not stop at the first success.

**One Cashfree order per checkout, created before the OTP.** It has to be — its
`payment_session_id` is the `x-chxs-id` header `/auth/initiate` needs. That
makes a failed OTP send leave a good order behind, which is what
`resumeSessionId` reuses. The resume is a *hint*: `resumable()` in
`payHandlers.ts` re-checks five things server-side, including that
`orderAmountMinor` still equals the cart. Never widen that without asking what
it would cost to charge a buyer a total they no longer have.

**Money is minor units until the last moment.** `src/lib/money.ts` owns the
conversion and takes the decimal count from `Intl`. Comparing or arithmetic on
major units is how a zero-decimal currency silently becomes 100× wrong.

**`server.ts` opens a socket on import, so nothing in it can be unit-tested.**
Logic worth a test goes in `src/lib/server/` and is imported back —
`mcpRouting.ts` exists for exactly that reason. A branch added to `server.ts`
itself is a branch no test can reach.

## Conventions

- Comments explain *why*, with the evidence that made it necessary — a measured
  symptom, a timestamp, a log line. Match that density; it is the house style,
  not decoration.
- Keep `README.md` honest. When a claim in it turns out wrong, correct it in
  place rather than adding a caveat elsewhere. Several sections say "this file
  used to claim X" precisely because that matters.
- Commit messages: 1–2 lines, imperative, no co-author trailer.
- Don't add dependencies for things the standard library covers.
- A JSX text child is text, not a string literal. `{"\u2212"}` renders a minus;
  a bare `\u2212` between tags renders those six characters, and did ship once.
  Template literals are fine — that is why the price range beside it was right.

## When debugging host behaviour

Read the log before theorising. Static reading of the SDK types has pointed at
the wrong layer more than once here; a five-line diagnostic endpoint that
reports what the widget actually received settled in one round what two rounds
of reasoning got wrong. Add instrumentation, gather evidence, then fix — and
remove the instrumentation once the question is closed.
