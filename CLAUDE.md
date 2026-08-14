# CLAUDE.md

Guidance for Claude Code working in this repo. Read `README.md` too — it holds
the measured findings about Shopify, Cashfree and the AI hosts. This file is
about how to work here.

## What this is

A Shopify storefront exposed as an MCP App, paid for with Cashfree, running
inside ChatGPT and Claude. One server is an MCP server to the host, an MCP
client to Shopify (`/api/ucp/mcp`, unauthenticated), and a REST client to
Cashfree.

Only `SearchProducts` is model-facing. Everything after it — cart, OTP, address,
payment — is widget-to-server over `/api/*`, which keeps the flow deterministic
and out of the model's hands.

## Commands

```bash
npm run build       # widget (vite) then server (esbuild) — both needed
npm start           # node --env-file=.env dist/server.js, port 8787
npm run test:run    # 318 tests, ~50s (MethodSelector's timers dominate)
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

Server logs go to stdout. When run in the background, tee them to a file — the
log is the primary evidence for anything involving the host.

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

## Layout

```
server.ts              MCP registration, HTTP routes, CSP, request logging
src/components/        Screens: Results, Cart, PhoneEntry, OtpEntry,
                       AddressStep, MethodSelector, PaymentResult
src/hooks/             useCart, useCheckoutFlow, useOrderStatus,
                       useWidgetState, useMcpApp
src/lib/ucp/           Shopify UCP client, normalisation, types, fixtures
src/lib/cashfree/      Orders, sessions, config, checkout URLs
src/lib/server/        Tool handlers, widget meta, logging, CSP
src/lib/widget/        Session reset rules
src/utils/platform.ts  The host bridge — legacy OpenAI and MCP Apps clients
docs/                  Verified Cashfree OCC contract, spikes, specs
```

## Conventions

- Comments explain *why*, with the evidence that made it necessary — a measured
  symptom, a timestamp, a log line. Match that density; it is the house style,
  not decoration.
- Keep `README.md` honest. When a claim in it turns out wrong, correct it in
  place rather than adding a caveat elsewhere. Several sections say "this file
  used to claim X" precisely because that matters.
- Commit messages: 1–2 lines, imperative, no co-author trailer.
- Don't add dependencies for things the standard library covers.

## When debugging host behaviour

Read the log before theorising. Static reading of the SDK types has pointed at
the wrong layer more than once here; a five-line diagnostic endpoint that
reports what the widget actually received settled in one round what two rounds
of reasoning got wrong. Add instrumentation, gather evidence, then fix — and
remove the instrumentation once the question is closed.
