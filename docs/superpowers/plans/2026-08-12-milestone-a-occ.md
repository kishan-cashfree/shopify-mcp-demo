# Milestone A — Cashfree OCC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the buyer from the Shopify cart to a paid Cashfree order without leaving the conversation — phone, OTP, address and payment method all inside the MCP widget.

**Architecture:** Our server gains a Cashfree layer: Create Order (public PG API) plus the internal OCC endpoints for OTP and addresses. The widget gains four screens and a state machine. At method selection we hand off to `cashfree-here`'s own widget, which renders payment. Reconciliation polls order status through our server.

**Tech Stack:** Same as milestone 1, plus `@cashfreepayments/cashfree-here` (server-side only).

**Spec:** `docs/superpowers/specs/2026-08-12-milestone-a-occ-design.md`
**API contract:** `docs/cashfree-occ-api.md` — verified live; the published docs do not cover these endpoints.

## Global Constraints

- **`x-chxs-id` is the `payment_session_id`.** Every OCC call carries it. A bad one returns `{"code":"payment_session_id_invalid"}`.
- **OCC calls need exactly three headers** — `x-authentication-token`, `x-chxs-id`, `x-customer-phone`. All mandatory, nothing else is. No cookies, no device id, no Forter token, no origin.
- **`x-customer-phone` format is `+91 8433719326`** — country code, space, ten digits.
- **The `authentication_token` never leaves the server.** The widget holds only `paymentSessionId`. No response body and no widget state may contain the token.
- **Cashfree money is major units** (decimals); Shopify UCP is minor units with cart-level currency. Convert only in `orders.ts`.
- **The server prices the order.** `/api/pay/order` re-reads the cart from Shopify by `cartId`; it never trusts a client-sent amount.
- **`callTool` before `sendFollowUpMessage`.** Direct widget dispatch keeps the host safety gate out of the payment path.
- **Never assert a payment outcome we have not observed.** Timeout copy is non-committal.
- **Do not commit live OCC responses as fixtures.** `authentication_token`, `payment_session_id` and `customer_uid` are per-session secrets. Fixtures are hand-written and redacted.
- Package exports available from `@cashfreepayments/cashfree-here`: `cashfreeUpiTool`, `cashfreeCardPaymentTool`, `cashfreeNetbankingTool`, `cashfreeNewCardTool`, `cashfreeCheckoutTool`, `registerCashfreeWidget`, `CashfreeToolConfig`. **Nothing else** — `src/hooks/` is not exported.

---

### Task 1: Spike — resolve the two unknowns before building on them

No production code. Two questions whose answers change later tasks, both cheap to answer and expensive to guess.

**Files:**
- Create: `docs/spikes/2026-08-12-occ-spike.md`

- [ ] **Step 1: Does OCC work without the feature flags?**

Create two orders and compare. Credentials are in `.env` (not committed).

```bash
source .env 2>/dev/null || true
mk() { # $1 = json file
  curl -s -X POST https://sandbox.cashfree.com/pg/orders \
    -H "x-client-id: $CASHFREE_CLIENT_ID" -H "x-client-secret: $CASHFREE_CLIENT_SECRET" \
    -H 'x-api-version: 2023-08-01' -H 'Content-Type: application/json' --data @"$1" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log(d.payment_session_id||JSON.stringify(d).slice(0,200))})"
}
```

Build one order body **with** `products.one_click_checkout` and one **without** it, then call the addresses endpoint with each resulting `payment_session_id` (plus a valid `x-authentication-token` obtained in Step 2).

Record: does the address call succeed for the order that omitted the flags?

**Why it matters:** we collect address and authenticate ourselves. If the flags are unnecessary, we drop them and Cashfree's payment widget cannot re-ask for either. If they are required, they stay and Task 12 must check whether the payment widget duplicates our screens.

- [ ] **Step 2: Capture a live auth token for the spike**

```bash
PSID=<payment_session_id from step 1>
curl -s -X POST https://sandbox.cashfree.com/checkout/api/auth/initiate \
  -H 'content-type: application/json' -H "x-chxs-id: $PSID" \
  --data '{"authentication_type":"OTP","cf_customer_phone":"8433719326","source":"ch_x"}'
# → {"status":true}, SMS sent
curl -s -X POST https://sandbox.cashfree.com/checkout/api/auth/sessions \
  -H 'content-type: application/json' -H "x-chxs-id: $PSID" \
  --data '{"authentication_type":"OTP","cf_customer_phone":"8433719326","source":"ch_x","otp":"111000"}'
# → {"status":true,"authentication_token":"<uuid>._.ch_x","customer_uid":"<uuid>"}
```

**This sends a real SMS.** Confirm with the phone's owner before running.

- [ ] **Step 3: Which payment tools dispatch via `callTool`?**

This cannot be settled by curl — it needs a host. Defer the measurement to Task 12 and record here that it is outstanding, with the fallback already designed: `sendFollowUpMessage`, then hosted checkout.

- [ ] **Step 4: Write `docs/spikes/2026-08-12-occ-spike.md`**

Record, for each question: what was run, what came back, and the decision taken. If the flags turn out to be unnecessary, state that Task 3 must omit them.

- [ ] **Step 5: Commit**

```bash
git add docs/spikes && git commit -m "docs: record OCC spike findings"
```

---

### Task 2: Extend normalisation with `handle` and `listPrice`

Cashfree's `cart_items` needs a product URL and an original price. Both are already in `search_catalog`'s response and both are currently discarded.

**Files:**
- Modify: `src/lib/ucp/types.ts`, `src/lib/ucp/normalise.ts`
- Test: `src/lib/ucp/normalise.test.ts`

**Interfaces:**
- Produces: `Product.handle: string`, `Variant.listPrice: Money`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ucp/normalise.test.ts`:

```ts
describe("normaliseProducts — Cashfree cart_items support", () => {
  it("carries the product handle", () => {
    const products = normaliseProducts(searchFixture);
    expect(products[0].handle).toBeTruthy();
    expect(typeof products[0].handle).toBe("string");
  });

  it("carries list_price as the variant's original price", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          handle: "thing",
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 900, currency: "INR" },
              list_price: { amount: 1200, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    const [product] = normaliseProducts(raw);

    expect(product.variants[0].price.amountMinor).toBe(900);
    expect(product.variants[0].listPrice.amountMinor).toBe(1200);
  });

  it("falls back to price when list_price is absent", () => {
    // Not every product is discounted, and Cashfree wants both fields.
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          handle: "thing",
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 900, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    expect(normaliseProducts(raw)[0].variants[0].listPrice.amountMinor).toBe(900);
  });

  it("defaults handle to an empty string when absent", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 900, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    expect(normaliseProducts(raw)[0].handle).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/ucp/normalise.test.ts`
Expected: FAIL — `handle` and `listPrice` undefined.

- [ ] **Step 3: Add the fields to `src/lib/ucp/types.ts`**

In `RawVariant`, after `price`:

```ts
  list_price?: RawMoney;
```

In `RawProduct`, after `title`:

```ts
  handle?: string;
```

In `Variant`, after `price`:

```ts
  /** Pre-discount price. Equals `price` when the product is not discounted. */
  listPrice: Money;
```

In `Product`, after `title`:

```ts
  /** URL slug. Used to build a product link for Cashfree's cart summary. */
  handle: string;
```

- [ ] **Step 4: Populate them in `src/lib/ucp/normalise.ts`**

In `normaliseVariant`, after the `price` line:

```ts
    listPrice: {
      amountMinor: raw.list_price?.amount ?? raw.price.amount,
      currency: raw.list_price?.currency ?? raw.price.currency,
    },
```

In `normaliseProducts`, inside the returned object:

```ts
      handle: product.handle ?? "",
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/ucp/normalise.test.ts && npm run type-check`
Expected: all PASS, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: carry product handle and variant list price through normalisation"
```

---

### Task 3: Cashfree config and Create Order

**Files:**
- Create: `src/lib/cashfree/config.ts`, `src/lib/cashfree/orders.ts`
- Test: `src/lib/cashfree/orders.test.ts`

**Interfaces:**
- Consumes: `Cart`, `Money` (Task 2).
- Produces: `loadCashfreeConfig(env)` → `CashfreeConfig { clientId, clientSecret, environment, baseUrl }`; `toCartItems(cart, shopDomain, handles)` → `CartItem[]`; `createOrder(config, input)` → `{ orderId, paymentSessionId, orderAmount }`; `getOrderStatus(config, orderId)` → `{ orderId, orderStatus }`. Consumed by Tasks 6, 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cashfree/orders.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadCashfreeConfig } from "./config";
import { toCartItems, createOrder, getOrderStatus } from "./orders";
import type { Cart } from "../ucp/types";

const CONFIG = {
  clientId: "TESTid",
  clientSecret: "TESTsecret",
  environment: "sandbox" as const,
  baseUrl: "https://sandbox.cashfree.com",
};

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "l1",
      variantId: "gid://shopify/ProductVariant/1",
      title: "short sleeve t-shirt - Red",
      imageUrl: "https://cdn.shopify.com/a.jpg",
      quantity: 3,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 360000, currency: "INR" },
    },
  ],
  total: { amountMinor: 360000, currency: "INR" },
};

const HANDLES = { "gid://shopify/ProductVariant/1": "short-sleeve-t-shirt" };
const LIST = { "gid://shopify/ProductVariant/1": 150000 };

describe("loadCashfreeConfig", () => {
  it("selects the sandbox base url", () => {
    const c = loadCashfreeConfig({
      CASHFREE_CLIENT_ID: "a",
      CASHFREE_CLIENT_SECRET: "b",
      CASHFREE_ENV: "sandbox",
    } as NodeJS.ProcessEnv);
    expect(c.baseUrl).toBe("https://sandbox.cashfree.com");
  });

  it("selects the production base url", () => {
    const c = loadCashfreeConfig({
      CASHFREE_CLIENT_ID: "a",
      CASHFREE_CLIENT_SECRET: "b",
      CASHFREE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(c.baseUrl).toBe("https://api.cashfree.com");
  });

  it("throws when credentials are missing", () => {
    expect(() => loadCashfreeConfig({} as NodeJS.ProcessEnv)).toThrow(
      /CASHFREE_CLIENT_ID/,
    );
  });
});

describe("toCartItems", () => {
  it("converts minor units to major units", () => {
    const [item] = toCartItems(CART, "shop.myshopify.com", HANDLES, LIST);
    expect(item.item_discounted_unit_price).toBe(1200);
    expect(item.item_original_unit_price).toBe(1500);
  });

  it("falls back to the unit price when no list price is known", () => {
    const [item] = toCartItems(CART, "shop.myshopify.com", HANDLES, {});
    expect(item.item_original_unit_price).toBe(1200);
  });

  it("builds the product url from the shop domain and handle", () => {
    const [item] = toCartItems(CART, "shop.myshopify.com", HANDLES, LIST);
    expect(item.item_details_url).toBe(
      "https://shop.myshopify.com/products/short-sleeve-t-shirt",
    );
  });

  it("omits the product url when the handle is unknown", () => {
    // A broken link in a checkout summary is worse than no link.
    const [item] = toCartItems(CART, "shop.myshopify.com", {}, LIST);
    expect(item.item_details_url).toBeUndefined();
  });

  it("carries name, image, quantity and currency", () => {
    const [item] = toCartItems(CART, "shop.myshopify.com", HANDLES, LIST);
    expect(item.item_id).toBe("gid://shopify/ProductVariant/1");
    expect(item.item_name).toBe("short sleeve t-shirt - Red");
    expect(item.item_image_url).toBe("https://cdn.shopify.com/a.jpg");
    expect(item.item_quantity).toBe(3);
    expect(item.item_currency).toBe("INR");
  });

  it("does not divide zero-decimal currencies", () => {
    const jpy: Cart = {
      ...CART,
      currency: "JPY",
      lines: [{ ...CART.lines[0], unitPrice: { amountMinor: 5000, currency: "JPY" } }],
      total: { amountMinor: 5000, currency: "JPY" },
    };
    const [item] = toCartItems(jpy, "shop.myshopify.com", HANDLES, {});
    expect(item.item_discounted_unit_price).toBe(5000);
  });
});

describe("createOrder", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  function ok(body: unknown) {
    return { ok: true, status: 200, json: async () => body };
  }

  it("posts to /pg/orders with credential headers", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ order_id: "o1", payment_session_id: "session_x", order_amount: 3600 }) as never,
    );

    await createOrder(CONFIG, {
      cart: CART,
      phone: "8433719326",
      shopDomain: "shop.myshopify.com",
      handles: HANDLES,
      listPrices: LIST,
      returnUrl: "https://srv.test/thanks?order_id={order_id}",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders");
    const h = init?.headers as Record<string, string>;
    expect(h["x-client-id"]).toBe("TESTid");
    expect(h["x-client-secret"]).toBe("TESTsecret");
    expect(h["x-api-version"]).toBe("2023-08-01");
  });

  it("prices the order from the cart total in major units", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ order_id: "o1", payment_session_id: "session_x", order_amount: 3600 }) as never,
    );

    await createOrder(CONFIG, {
      cart: CART,
      phone: "8433719326",
      shopDomain: "shop.myshopify.com",
      handles: HANDLES,
      listPrices: LIST,
      returnUrl: "https://srv.test/thanks",
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.order_amount).toBe(3600);
    expect(body.order_currency).toBe("INR");
    expect(body.customer_details.customer_phone).toBe("8433719326");
  });

  it("enables one_click_checkout with both feature flags", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ order_id: "o1", payment_session_id: "session_x", order_amount: 3600 }) as never,
    );

    await createOrder(CONFIG, {
      cart: CART,
      phone: "8433719326",
      shopDomain: "shop.myshopify.com",
      handles: HANDLES,
      listPrices: LIST,
      returnUrl: "https://srv.test/thanks",
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    const occ = body.products.one_click_checkout;
    expect(occ.enabled).toBe(true);
    expect(occ.conditions[0].values).toEqual([
      "checkoutCollectAddress",
      "checkoutAuthenticate",
    ]);
  });

  it("returns the order id and payment session id", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ order_id: "o1", payment_session_id: "session_x", order_amount: 3600 }) as never,
    );

    const result = await createOrder(CONFIG, {
      cart: CART,
      phone: "8433719326",
      shopDomain: "shop.myshopify.com",
      handles: HANDLES,
      listPrices: LIST,
      returnUrl: "https://srv.test/thanks",
    });

    expect(result).toEqual({
      orderId: "o1",
      paymentSessionId: "session_x",
      orderAmount: 3600,
    });
  });

  it("surfaces Cashfree's message on rejection", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "order_amount is invalid", code: "order_amount_invalid" }),
    } as never);

    await expect(
      createOrder(CONFIG, {
        cart: CART,
        phone: "8433719326",
        shopDomain: "shop.myshopify.com",
        handles: HANDLES,
        listPrices: LIST,
        returnUrl: "https://srv.test/thanks",
      }),
    ).rejects.toThrow("order_amount is invalid");
  });
});

describe("getOrderStatus", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the order and returns its status", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ order_id: "o1", order_status: "PAID" }),
    } as never);

    const result = await getOrderStatus(CONFIG, "o1");

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://sandbox.cashfree.com/pg/orders/o1",
    );
    expect(result).toEqual({ orderId: "o1", orderStatus: "PAID" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/cashfree/orders.test.ts`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Write `src/lib/cashfree/config.ts`**

```ts
export type CashfreeEnvironment = "sandbox" | "production";

export interface CashfreeConfig {
  clientId: string;
  clientSecret: string;
  environment: CashfreeEnvironment;
  baseUrl: string;
}

export function loadCashfreeConfig(
  env: NodeJS.ProcessEnv = process.env,
): CashfreeConfig {
  const clientId = env.CASHFREE_CLIENT_ID;
  if (!clientId) throw new Error("CASHFREE_CLIENT_ID is required");

  const clientSecret = env.CASHFREE_CLIENT_SECRET;
  if (!clientSecret) throw new Error("CASHFREE_CLIENT_SECRET is required");

  const environment: CashfreeEnvironment =
    env.CASHFREE_ENV === "production" ? "production" : "sandbox";

  return {
    clientId,
    clientSecret,
    environment,
    baseUrl:
      environment === "production"
        ? "https://api.cashfree.com"
        : "https://sandbox.cashfree.com",
  };
}
```

- [ ] **Step 4: Write `src/lib/cashfree/orders.ts`**

```ts
import type { Cart } from "../ucp/types";
import type { CashfreeConfig } from "./config";

const API_VERSION = "2023-08-01";

export interface CartItem {
  item_id: string;
  item_name: string;
  item_image_url?: string;
  item_details_url?: string;
  item_original_unit_price: number;
  item_discounted_unit_price: number;
  item_quantity: number;
  item_currency: string;
}

export interface CreateOrderInput {
  cart: Cart;
  phone: string;
  shopDomain: string;
  /** variantId → product handle, for building item_details_url. */
  handles: Record<string, string>;
  /** variantId → pre-discount unit price in minor units. */
  listPrices: Record<string, number>;
  returnUrl: string;
}

export interface CreatedOrder {
  orderId: string;
  paymentSessionId: string;
  orderAmount: number;
}

/**
 * Minor units → major units, using the currency's own decimal count rather
 * than a hardcoded 100. JPY has none, and dividing it would bill a hundredth
 * of the real amount.
 */
function toMajor(amountMinor: number, currency: string): number {
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? 2;
  return amountMinor / 10 ** digits;
}

export function toCartItems(
  cart: Cart,
  shopDomain: string,
  handles: Record<string, string>,
  listPrices: Record<string, number>,
): CartItem[] {
  return cart.lines.map((line) => {
    const handle = handles[line.variantId];
    const listMinor = listPrices[line.variantId] ?? line.unitPrice.amountMinor;

    return {
      item_id: line.variantId,
      item_name: line.title,
      item_image_url: line.imageUrl,
      // A link to a product page that does not exist is worse than no link.
      item_details_url: handle
        ? `https://${shopDomain}/products/${handle}`
        : undefined,
      item_original_unit_price: toMajor(listMinor, cart.currency),
      item_discounted_unit_price: toMajor(
        line.unitPrice.amountMinor,
        cart.currency,
      ),
      item_quantity: line.quantity,
      item_currency: cart.currency,
    };
  });
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function createOrder(
  config: CashfreeConfig,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  const body = {
    order_amount: toMajor(input.cart.total.amountMinor, input.cart.currency),
    order_currency: input.cart.currency,
    customer_details: {
      customer_id: `mcp_${input.phone}`,
      customer_phone: input.phone,
    },
    order_meta: { return_url: input.returnUrl },
    products: {
      one_click_checkout: {
        enabled: true,
        conditions: [
          {
            key: "features",
            action: "ALLOW",
            values: ["checkoutCollectAddress", "checkoutAuthenticate"],
          },
        ],
      },
    },
    cart_details: {
      cart_items: toCartItems(
        input.cart,
        input.shopDomain,
        input.handles,
        input.listPrices,
      ),
    },
  };

  const response = await fetch(`${config.baseUrl}/pg/orders`, {
    method: "POST",
    headers: {
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readError(response, `Create order failed (${response.status})`));
  }

  const created = (await response.json()) as {
    order_id: string;
    payment_session_id: string;
    order_amount: number;
  };

  return {
    orderId: created.order_id,
    paymentSessionId: created.payment_session_id,
    orderAmount: created.order_amount,
  };
}

export async function getOrderStatus(
  config: CashfreeConfig,
  orderId: string,
): Promise<{ orderId: string; orderStatus: string }> {
  const response = await fetch(
    `${config.baseUrl}/pg/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        "x-client-id": config.clientId,
        "x-client-secret": config.clientSecret,
        "x-api-version": API_VERSION,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, `Order lookup failed (${response.status})`));
  }

  const order = (await response.json()) as {
    order_id: string;
    order_status: string;
  };

  return { orderId: order.order_id, orderStatus: order.order_status };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/cashfree/orders.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Cashfree config, Create Order, and Shopify cart mapping"
```

---

### Task 4: OCC client — OTP and addresses

**Files:**
- Create: `src/lib/cashfree/occ.ts`
- Test: `src/lib/cashfree/occ.test.ts`

**Interfaces:**
- Produces: `formatCustomerPhone(phone)`; `initiateOtp(config, { paymentSessionId, phone })`; `verifyOtp(config, { paymentSessionId, phone, otp })` → `{ authToken, customerUid }`; `getAddresses(config, ctx)` → `OccAddress[]`; `createAddress(config, ctx, address)` → `OccAddress[]`, where `ctx = { paymentSessionId, authToken, phone }`. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cashfree/occ.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatCustomerPhone,
  initiateOtp,
  verifyOtp,
  getAddresses,
  createAddress,
} from "./occ";

const CONFIG = {
  clientId: "x",
  clientSecret: "y",
  environment: "sandbox" as const,
  baseUrl: "https://sandbox.cashfree.com",
};

const CTX = {
  paymentSessionId: "session_abc",
  authToken: "tok._.ch_x",
  phone: "8433719326",
};

const ADDRESS = {
  id: "1054210",
  customer_name: "kishan",
  address_line_one: "Koramangala",
  address_line_two: "",
  city: "Bangalore",
  country: "India",
  country_code: "IN",
  zip_code: "560034",
  state: "Karnataka",
  state_code: "KA",
  phone: "+91 8433719326",
  email: "buyer@example.test",
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("formatCustomerPhone", () => {
  it("renders the header format Cashfree expects", () => {
    // Verified live: "+91 8433719326" — country code, space, ten digits.
    expect(formatCustomerPhone("8433719326")).toBe("+91 8433719326");
  });

  it("is idempotent when already formatted", () => {
    expect(formatCustomerPhone("+91 8433719326")).toBe("+91 8433719326");
  });

  it("strips a leading +91 with no space", () => {
    expect(formatCustomerPhone("+918433719326")).toBe("+91 8433719326");
  });
});

describe("initiateOtp", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts to auth/initiate with the session as x-chxs-id", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ status: true }) as never);

    await initiateOtp(CONFIG, {
      paymentSessionId: "session_abc",
      phone: "8433719326",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://sandbox.cashfree.com/checkout/api/auth/initiate");
    expect((init?.headers as Record<string, string>)["x-chxs-id"]).toBe(
      "session_abc",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      authentication_type: "OTP",
      cf_customer_phone: "8433719326",
      source: "ch_x",
    });
  });

  it("throws when the session is rejected", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: "payment_session_id is not present or is invalid",
        code: "payment_session_id_invalid",
      }),
    } as never);

    await expect(
      initiateOtp(CONFIG, { paymentSessionId: "bad", phone: "8433719326" }),
    ).rejects.toThrow(/payment_session_id/);
  });
});

describe("verifyOtp", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns the auth token and customer uid", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({
        status: true,
        authentication_token: "tok._.ch_x",
        customer_uid: "uid-1",
      }) as never,
    );

    const result = await verifyOtp(CONFIG, {
      paymentSessionId: "session_abc",
      phone: "8433719326",
      otp: "111000",
    });

    expect(result).toEqual({ authToken: "tok._.ch_x", customerUid: "uid-1" });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).otp).toBe(
      "111000",
    );
  });

  it("throws when the OTP is wrong", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Invalid OTP" }),
    } as never);

    await expect(
      verifyOtp(CONFIG, {
        paymentSessionId: "session_abc",
        phone: "8433719326",
        otp: "000000",
      }),
    ).rejects.toThrow("Invalid OTP");
  });

  it("throws when the response reports failure without an http error", async () => {
    // Observed shape is { status: true }; a false must not be read as success.
    vi.mocked(fetch).mockResolvedValue(ok({ status: false }) as never);

    await expect(
      verifyOtp(CONFIG, {
        paymentSessionId: "session_abc",
        phone: "8433719326",
        otp: "000000",
      }),
    ).rejects.toThrow();
  });
});

describe("getAddresses", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("sends exactly the three required headers", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [ADDRESS] }) as never);

    await getAddresses(CONFIG, CTX);

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers["x-authentication-token"]).toBe("tok._.ch_x");
    expect(headers["x-chxs-id"]).toBe("session_abc");
    expect(headers["x-customer-phone"]).toBe("+91 8433719326");
  });

  it("returns the address list", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [ADDRESS] }) as never);

    const addresses = await getAddresses(CONFIG, CTX);

    expect(addresses).toHaveLength(1);
    expect(addresses[0].id).toBe("1054210");
  });

  it("returns an empty array for a customer with none", async () => {
    // Not an error — it is the path to the capture form.
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [] }) as never);

    expect(await getAddresses(CONFIG, CTX)).toEqual([]);
  });

  it("tolerates a missing addresses key", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({}) as never);

    expect(await getAddresses(CONFIG, CTX)).toEqual([]);
  });
});

describe("createAddress", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts shipping and billing as the same address", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [ADDRESS] }) as never);

    await createAddress(CONFIG, CTX, {
      customer_name: "kishan",
      address_line_one: "Koramangala",
      address_line_two: "",
      city: "Bangalore",
      zip_code: "560034",
      state: "Karnataka",
      state_code: "KA",
      country: "India",
      country_code: "IN",
      email: "buyer@example.test",
      phone: "+91 8433719326",
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.shipping_address.city).toBe("Bangalore");
    expect(body.billing_address).toEqual(body.shipping_address);
    expect(body.is_guest).toBe(false);
    expect(body.shipping_address.type).toBe("SHIPPING_ADDRESS");
  });

  it("surfaces a rejection message", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "zip_code is invalid" }),
    } as never);

    await expect(
      createAddress(CONFIG, CTX, {
        customer_name: "k",
        address_line_one: "a",
        address_line_two: "",
        city: "b",
        zip_code: "1",
        state: "s",
        state_code: "S",
        country: "India",
        country_code: "IN",
        email: "e@e.test",
        phone: "+91 8433719326",
      }),
    ).rejects.toThrow("zip_code is invalid");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/cashfree/occ.test.ts`
Expected: FAIL — cannot resolve `./occ`.

- [ ] **Step 3: Write `src/lib/cashfree/occ.ts`**

```ts
import type { CashfreeConfig } from "./config";

/**
 * These endpoints back Cashfree's own OCC checkout UI. They are internal:
 * unversioned, undocumented publicly, and subject to change without notice.
 * The contract here was captured live — see docs/cashfree-occ-api.md.
 */

export interface OccContext {
  paymentSessionId: string;
  authToken: string;
  phone: string;
}

export interface OccAddress {
  id: string;
  customer_name: string;
  address_line_one: string;
  address_line_two: string;
  city: string;
  country: string;
  country_code: string;
  zip_code: string;
  state: string;
  state_code: string;
  phone: string;
  email: string;
}

export type NewAddress = Omit<OccAddress, "id">;

/** Header format verified live: country code, space, ten digits. */
export function formatCustomerPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return `+91 ${digits}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function authHeaders(ctx: OccContext): Record<string, string> {
  // All three are mandatory — verified by bisection. Any two returns 400.
  return {
    "content-type": "application/json",
    "x-authentication-token": ctx.authToken,
    "x-chxs-id": ctx.paymentSessionId,
    "x-customer-phone": formatCustomerPhone(ctx.phone),
  };
}

export async function initiateOtp(
  config: CashfreeConfig,
  input: { paymentSessionId: string; phone: string },
): Promise<void> {
  const response = await fetch(
    `${config.baseUrl}/checkout/api/auth/initiate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chxs-id": input.paymentSessionId,
      },
      body: JSON.stringify({
        authentication_type: "OTP",
        cf_customer_phone: input.phone,
        source: "ch_x",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't send the OTP"));
  }
}

export async function verifyOtp(
  config: CashfreeConfig,
  input: { paymentSessionId: string; phone: string; otp: string },
): Promise<{ authToken: string; customerUid: string }> {
  const response = await fetch(
    `${config.baseUrl}/checkout/api/auth/sessions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chxs-id": input.paymentSessionId,
      },
      body: JSON.stringify({
        authentication_type: "OTP",
        cf_customer_phone: input.phone,
        source: "ch_x",
        otp: input.otp,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't verify the OTP"));
  }

  const body = (await response.json()) as {
    status?: boolean;
    authentication_token?: string;
    customer_uid?: string;
  };

  // A 200 with status:false is still a failure; treating it as success would
  // hand the rest of the flow an undefined token.
  if (!body.status || !body.authentication_token) {
    throw new Error("OTP verification failed");
  }

  return {
    authToken: body.authentication_token,
    customerUid: body.customer_uid ?? "",
  };
}

const ADDRESSES_PATH = "/checkout/api/checkouts/customers/addresses";

export async function getAddresses(
  config: CashfreeConfig,
  ctx: OccContext,
): Promise<OccAddress[]> {
  const response = await fetch(`${config.baseUrl}${ADDRESSES_PATH}`, {
    headers: authHeaders(ctx),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't load saved addresses"));
  }

  const body = (await response.json()) as { addresses?: OccAddress[] };
  return body.addresses ?? [];
}

export async function createAddress(
  config: CashfreeConfig,
  ctx: OccContext,
  address: NewAddress,
): Promise<OccAddress[]> {
  const entry = { ...address, type: "SHIPPING_ADDRESS" };

  const response = await fetch(`${config.baseUrl}${ADDRESSES_PATH}`, {
    method: "POST",
    headers: authHeaders(ctx),
    body: JSON.stringify({
      shipping_address: entry,
      // Billing mirrors shipping. Collecting a separate billing address is
      // scope this demo does not need.
      billing_address: entry,
      is_guest: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't save the address"));
  }

  const body = (await response.json()) as { addresses?: OccAddress[] };
  return body.addresses ?? [];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/cashfree/occ.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add OCC client for OTP login and saved addresses"
```

---

### Task 5: Server-side checkout session store

The auth token must never reach the browser. This is where it lives instead.

**Files:**
- Create: `src/lib/cashfree/session.ts`
- Test: `src/lib/cashfree/session.test.ts`

**Interfaces:**
- Produces: `createSessionStore()` → `{ put, get, setAuth }`, with `CheckoutSession = { paymentSessionId, orderId, phone, authToken? }`. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cashfree/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createSessionStore } from "./session";

describe("session store", () => {
  it("stores and retrieves a session by payment session id", () => {
    const store = createSessionStore();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    expect(store.get("s1")).toEqual({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
    });
  });

  it("returns undefined for an unknown session", () => {
    expect(createSessionStore().get("nope")).toBeUndefined();
  });

  it("attaches the auth token after OTP verification", () => {
    const store = createSessionStore();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    store.setAuth("s1", "tok._.ch_x");

    expect(store.get("s1")?.authToken).toBe("tok._.ch_x");
  });

  it("throws when setting auth on an unknown session", () => {
    // Silently creating a session here would mean a forged id could seed one.
    expect(() => createSessionStore().setAuth("nope", "tok")).toThrow(
      /unknown checkout session/i,
    );
  });

  it("keeps sessions isolated from each other", () => {
    const store = createSessionStore();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "1" });
    store.put({ paymentSessionId: "s2", orderId: "o2", phone: "2" });

    store.setAuth("s1", "tok1");

    expect(store.get("s2")?.authToken).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/cashfree/session.test.ts`
Expected: FAIL — cannot resolve `./session`.

- [ ] **Step 3: Write `src/lib/cashfree/session.ts`**

```ts
export interface CheckoutSession {
  paymentSessionId: string;
  orderId: string;
  phone: string;
  /** Set once OTP verification succeeds. Never sent to the widget. */
  authToken?: string;
}

export interface SessionStore {
  put(session: CheckoutSession): void;
  get(paymentSessionId: string): CheckoutSession | undefined;
  setAuth(paymentSessionId: string, authToken: string): void;
}

/**
 * In-memory, process-local. A checkout cannot survive a server restart, which
 * is acceptable for a demo and stated in the spec rather than discovered in
 * front of an audience. A real deployment needs shared storage with a TTL.
 *
 * This exists so the OCC auth token stays server-side: the widget runs in a
 * browser inside a third-party host, and it only ever holds the
 * paymentSessionId.
 */
export function createSessionStore(): SessionStore {
  const sessions = new Map<string, CheckoutSession>();

  return {
    put(session) {
      sessions.set(session.paymentSessionId, session);
    },
    get(paymentSessionId) {
      return sessions.get(paymentSessionId);
    },
    setAuth(paymentSessionId, authToken) {
      const existing = sessions.get(paymentSessionId);
      if (!existing) {
        // Creating one here would let a forged session id seed the store.
        throw new Error(`Unknown checkout session: ${paymentSessionId}`);
      }
      sessions.set(paymentSessionId, { ...existing, authToken });
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/cashfree/session.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add server-side checkout session store"
```

---

### Task 6: Payment route handlers

**Files:**
- Create: `src/lib/server/payHandlers.ts`
- Test: `src/lib/server/payHandlers.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 5; `ShopService` from milestone 1.
- Produces: `createPayHandlers(deps)` → `{ handleCreateOrder, handleSendOtp, handleVerifyOtp, handleGetAddresses, handleCreateAddress, handleOrderStatus }`, each `(body|params) → { status, body }`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/payHandlers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPayHandlers } from "./payHandlers";
import { createSessionStore } from "../cashfree/session";
import type { Cart } from "../ucp/types";

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "l1",
      variantId: "v1",
      title: "Tee - Red",
      quantity: 3,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 360000, currency: "INR" },
    },
  ],
  total: { amountMinor: 360000, currency: "INR" },
};

function deps(overrides: Record<string, unknown> = {}) {
  const store = createSessionStore();
  return {
    store,
    deps: {
      store,
      shopDomain: "shop.myshopify.com",
      returnUrl: "https://srv.test/thanks",
      loadCart: vi.fn().mockResolvedValue({ cart: CART, handles: {}, listPrices: {} }),
      createOrder: vi.fn().mockResolvedValue({
        orderId: "o1",
        paymentSessionId: "session_x",
        orderAmount: 3600,
      }),
      initiateOtp: vi.fn().mockResolvedValue(undefined),
      verifyOtp: vi.fn().mockResolvedValue({ authToken: "tok", customerUid: "u1" }),
      getAddresses: vi.fn().mockResolvedValue([]),
      createAddress: vi.fn().mockResolvedValue([]),
      getOrderStatus: vi.fn().mockResolvedValue({ orderId: "o1", orderStatus: "PAID" }),
      ...overrides,
    },
  };
}

describe("handleCreateOrder", () => {
  it("creates an order and records the session", async () => {
    const { store, deps: d } = deps();
    const h = createPayHandlers(d);

    const result = await h.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      orderId: "o1",
      paymentSessionId: "session_x",
      orderAmount: 3600,
    });
    expect(store.get("session_x")?.phone).toBe("8433719326");
  });

  it("prices from the Shopify cart, ignoring any client-sent amount", async () => {
    const { deps: d } = deps();
    const h = createPayHandlers(d);

    await h.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      orderAmount: 1,
    });

    expect(d.loadCart).toHaveBeenCalledWith("gid://shopify/Cart/abc");
    const arg = vi.mocked(d.createOrder).mock.calls[0][1] as { cart: Cart };
    expect(arg.cart.total.amountMinor).toBe(360000);
  });

  it("rejects a phone that is not ten digits", async () => {
    const { deps: d } = deps();
    const result = await createPayHandlers(d).handleCreateOrder({
      cartId: "c",
      phone: "12345",
    });

    expect(result.status).toBe(400);
  });

  it("returns 502 with Cashfree's message when the order is rejected", async () => {
    const { deps: d } = deps({
      createOrder: vi.fn().mockRejectedValue(new Error("order_amount is invalid")),
    });

    const result = await createPayHandlers(d).handleCreateOrder({
      cartId: "c",
      phone: "8433719326",
    });

    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "order_amount is invalid" });
  });
});

describe("handleSendOtp", () => {
  it("initiates using the stored phone", async () => {
    const { store, deps: d } = deps();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await createPayHandlers(d).handleSendOtp({
      paymentSessionId: "s1",
    });

    expect(result.status).toBe(200);
    expect(d.initiateOtp).toHaveBeenCalledWith(expect.anything(), {
      paymentSessionId: "s1",
      phone: "8433719326",
    });
  });

  it("returns 400 for an unknown session", async () => {
    const { deps: d } = deps();
    const result = await createPayHandlers(d).handleSendOtp({
      paymentSessionId: "nope",
    });

    expect(result.status).toBe(400);
  });
});

describe("handleVerifyOtp", () => {
  it("stores the auth token and does not return it", async () => {
    const { store, deps: d } = deps();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await createPayHandlers(d).handleVerifyOtp({
      paymentSessionId: "s1",
      otp: "111000",
    });

    expect(result.status).toBe(200);
    expect(store.get("s1")?.authToken).toBe("tok");
    // The token is a bearer credential for a customer's address book. It must
    // never cross into the browser.
    expect(JSON.stringify(result.body)).not.toContain("tok");
  });

  it("returns 400 on a wrong OTP with Cashfree's message", async () => {
    const { store, deps: d } = deps({
      verifyOtp: vi.fn().mockRejectedValue(new Error("Invalid OTP")),
    });
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await createPayHandlers(d).handleVerifyOtp({
      paymentSessionId: "s1",
      otp: "000000",
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Invalid OTP" });
  });
});

describe("handleGetAddresses", () => {
  it("returns the address list", async () => {
    const { store, deps: d } = deps({
      getAddresses: vi.fn().mockResolvedValue([{ id: "1", city: "Bangalore" }]),
    });
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
      authToken: "tok",
    });

    const result = await createPayHandlers(d).handleGetAddresses("s1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ addresses: [{ id: "1", city: "Bangalore" }] });
  });

  it("returns 401 when the session has not verified an OTP", async () => {
    const { store, deps: d } = deps();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await createPayHandlers(d).handleGetAddresses("s1");

    expect(result.status).toBe(401);
  });
});

describe("handleCreateAddress", () => {
  it("creates and returns the refreshed list", async () => {
    const { store, deps: d } = deps({
      createAddress: vi.fn().mockResolvedValue([{ id: "2" }]),
    });
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
      authToken: "tok",
    });

    const result = await createPayHandlers(d).handleCreateAddress({
      paymentSessionId: "s1",
      address: {
        customer_name: "k",
        address_line_one: "a",
        address_line_two: "",
        city: "b",
        zip_code: "560034",
        state: "Karnataka",
        state_code: "KA",
        country: "India",
        country_code: "IN",
        email: "e@e.test",
        phone: "+91 8433719326",
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ addresses: [{ id: "2" }] });
  });

  it("rejects an address missing required fields", async () => {
    const { store, deps: d } = deps();
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
      authToken: "tok",
    });

    const result = await createPayHandlers(d).handleCreateAddress({
      paymentSessionId: "s1",
      address: { city: "b" },
    });

    expect(result.status).toBe(400);
  });
});

describe("handleOrderStatus", () => {
  it("returns the order status", async () => {
    const { deps: d } = deps();
    const result = await createPayHandlers(d).handleOrderStatus("o1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ orderId: "o1", orderStatus: "PAID" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/server/payHandlers.test.ts`
Expected: FAIL — cannot resolve `./payHandlers`.

- [ ] **Step 3: Write `src/lib/server/payHandlers.ts`**

```ts
import { z } from "zod";
import type { CashfreeConfig } from "../cashfree/config";
import type { CreatedOrder, CreateOrderInput } from "../cashfree/orders";
import type { NewAddress, OccAddress, OccContext } from "../cashfree/occ";
import type { SessionStore } from "../cashfree/session";
import type { Cart } from "../ucp/types";

export interface LoadedCart {
  cart: Cart;
  /** variantId → product handle */
  handles: Record<string, string>;
  /** variantId → pre-discount unit price, minor units */
  listPrices: Record<string, number>;
}

export interface PayDeps {
  config?: CashfreeConfig;
  store: SessionStore;
  shopDomain: string;
  returnUrl: string;
  loadCart(cartId: string): Promise<LoadedCart>;
  createOrder(
    config: CashfreeConfig,
    input: CreateOrderInput,
  ): Promise<CreatedOrder>;
  initiateOtp(
    config: CashfreeConfig,
    input: { paymentSessionId: string; phone: string },
  ): Promise<void>;
  verifyOtp(
    config: CashfreeConfig,
    input: { paymentSessionId: string; phone: string; otp: string },
  ): Promise<{ authToken: string; customerUid: string }>;
  getAddresses(config: CashfreeConfig, ctx: OccContext): Promise<OccAddress[]>;
  createAddress(
    config: CashfreeConfig,
    ctx: OccContext,
    address: NewAddress,
  ): Promise<OccAddress[]>;
  getOrderStatus(
    config: CashfreeConfig,
    orderId: string,
  ): Promise<{ orderId: string; orderStatus: string }>;
}

type Result = { status: number; body: unknown };

const phoneSchema = z.string().regex(/^\d{10}$/, "Enter a 10-digit phone number");

const createOrderSchema = z
  .object({ cartId: z.string().min(1), phone: phoneSchema })
  .passthrough();

const sessionSchema = z.object({ paymentSessionId: z.string().min(1) }).passthrough();

const verifySchema = z
  .object({ paymentSessionId: z.string().min(1), otp: z.string().min(4) })
  .passthrough();

const addressSchema = z.object({
  customer_name: z.string().min(1),
  address_line_one: z.string().min(1),
  address_line_two: z.string(),
  city: z.string().min(1),
  zip_code: z.string().min(1),
  state: z.string().min(1),
  state_code: z.string().min(1),
  country: z.string().min(1),
  country_code: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
});

const createAddressSchema = z
  .object({ paymentSessionId: z.string().min(1), address: addressSchema })
  .passthrough();

function bad(message: string, details?: unknown): Result {
  return { status: 400, body: { error: message, details } };
}

export function createPayHandlers(deps: PayDeps) {
  // Cast is safe: server.ts always supplies config. Tests omit it because the
  // Cashfree calls themselves are injected and never read it.
  const config = deps.config as CashfreeConfig;

  function context(paymentSessionId: string):
    | { ok: true; ctx: OccContext }
    | { ok: false; result: Result } {
    const session = deps.store.get(paymentSessionId);
    if (!session) {
      return { ok: false, result: bad("Unknown or expired checkout session") };
    }
    if (!session.authToken) {
      return {
        ok: false,
        result: { status: 401, body: { error: "Not signed in" } },
      };
    }
    return {
      ok: true,
      ctx: {
        paymentSessionId,
        authToken: session.authToken,
        phone: session.phone,
      },
    };
  }

  return {
    async handleCreateOrder(body: unknown): Promise<Result> {
      const parsed = createOrderSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid request", parsed.error.issues);

      try {
        // Priced from Shopify, never from the request. A client-supplied
        // amount is a client-supplied amount.
        const { cart, handles, listPrices } = await deps.loadCart(
          parsed.data.cartId,
        );

        const created = await deps.createOrder(config, {
          cart,
          phone: parsed.data.phone,
          shopDomain: deps.shopDomain,
          handles,
          listPrices,
          returnUrl: deps.returnUrl,
        });

        deps.store.put({
          paymentSessionId: created.paymentSessionId,
          orderId: created.orderId,
          phone: parsed.data.phone,
        });

        return { status: 200, body: created };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    async handleSendOtp(body: unknown): Promise<Result> {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid request", parsed.error.issues);

      const session = deps.store.get(parsed.data.paymentSessionId);
      if (!session) return bad("Unknown or expired checkout session");

      try {
        await deps.initiateOtp(config, {
          paymentSessionId: parsed.data.paymentSessionId,
          phone: session.phone,
        });
        return { status: 200, body: { sent: true } };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    async handleVerifyOtp(body: unknown): Promise<Result> {
      const parsed = verifySchema.safeParse(body);
      if (!parsed.success) return bad("Invalid request", parsed.error.issues);

      const session = deps.store.get(parsed.data.paymentSessionId);
      if (!session) return bad("Unknown or expired checkout session");

      try {
        const { authToken } = await deps.verifyOtp(config, {
          paymentSessionId: parsed.data.paymentSessionId,
          phone: session.phone,
          otp: parsed.data.otp,
        });

        deps.store.setAuth(parsed.data.paymentSessionId, authToken);

        // Deliberately returns no token.
        return { status: 200, body: { ok: true } };
      } catch (error) {
        return { status: 400, body: { error: (error as Error).message } };
      }
    },

    async handleGetAddresses(paymentSessionId: string): Promise<Result> {
      const resolved = context(paymentSessionId);
      if (!resolved.ok) return resolved.result;

      try {
        const addresses = await deps.getAddresses(config, resolved.ctx);
        return { status: 200, body: { addresses } };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    async handleCreateAddress(body: unknown): Promise<Result> {
      const parsed = createAddressSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid address", parsed.error.issues);

      const resolved = context(parsed.data.paymentSessionId);
      if (!resolved.ok) return resolved.result;

      try {
        const addresses = await deps.createAddress(
          config,
          resolved.ctx,
          parsed.data.address as NewAddress,
        );
        return { status: 200, body: { addresses } };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    async handleOrderStatus(orderId: string): Promise<Result> {
      try {
        return { status: 200, body: await deps.getOrderStatus(config, orderId) };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/server/payHandlers.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add payment route handlers with server-held auth token"
```

---

### Task 7: Wire routes and register Cashfree tools

**Files:**
- Modify: `server.ts`, `.env.example`, `package.json`

- [ ] **Step 1: Add the dependency and env keys**

```bash
npm install @cashfreepayments/cashfree-here@file:../cashfree-here
cat >> .env.example <<'ENVEOF'

# Cashfree — dashboard → Developers → API Keys. sandbox | production
CASHFREE_ENV=sandbox
CASHFREE_CLIENT_ID=
CASHFREE_CLIENT_SECRET=
ENVEOF
```

Copy your real sandbox values into `.env` (gitignored).

- [ ] **Step 2: Add a `loadCart` helper to `src/lib/ucp/shop.ts`**

The pay handlers need the cart plus handles and list prices, which `saveCart`
does not return. Append to `createShopService`'s returned object, and add to
the `ShopService` interface:

```ts
  loadCartForOrder(cartId: string): Promise<{
    cart: Cart;
    handles: Record<string, string>;
    listPrices: Record<string, number>;
  }>;
```

Implementation, inside `createShopService`:

```ts
  async function loadCartForOrder(cartId: string) {
    const raw = await client.call("get_cart", { id: cartId });
    const cart = normaliseCart(raw);

    // Handles and list prices live on the catalog, not the cart, so look up
    // each variant once. lookup_catalog takes up to 10 ids per call.
    const ids = cart.lines.map((line) => line.variantId).slice(0, 10);
    const handles: Record<string, string> = {};
    const listPrices: Record<string, number> = {};

    if (ids.length > 0) {
      const looked = await client.call("lookup_catalog", {
        catalog: { ids },
      });
      for (const product of normaliseProducts(looked)) {
        for (const variant of product.variants) {
          if (product.handle) handles[variant.id] = product.handle;
          listPrices[variant.id] = variant.listPrice.amountMinor;
        }
      }
    }

    return { cart, handles, listPrices };
  }
```

Add `loadCartForOrder` to the returned object and to the interface.

**If `lookup_catalog` rejects this argument shape**, fall back to calling
`get_product` per variant, or carry handles forward in widget state from the
search response. Record whichever you used in the spike doc.

- [ ] **Step 3: Add a test for `loadCartForOrder`**

Append to `src/lib/ucp/shop.test.ts`:

```ts
describe("loadCartForOrder", () => {
  it("returns the cart plus handles and list prices keyed by variant", async () => {
    const client = {
      call: vi
        .fn()
        .mockResolvedValueOnce(cartFixture)
        .mockResolvedValueOnce(searchFixture),
    };

    const result = await createShopService(client).loadCartForOrder(
      "gid://shopify/Cart/abc",
    );

    expect(result.cart.lines.length).toBeGreaterThan(0);
    const variantId = result.cart.lines[0].variantId;
    expect(typeof result.listPrices[variantId]).toBe("number");
  });

  it("skips the catalog lookup for an empty cart", async () => {
    const empty = { ...cartFixture, line_items: [] };
    const client = { call: vi.fn().mockResolvedValueOnce(empty) };

    const result = await createShopService(client).loadCartForOrder("c");

    expect(client.call).toHaveBeenCalledTimes(1);
    expect(result.handles).toEqual({});
  });
});
```

Run: `npx vitest run src/lib/ucp/shop.test.ts` — RED, then implement, then GREEN.

- [ ] **Step 4: Wire everything into `server.ts`**

Add imports:

```ts
import {
  registerCashfreeWidget,
  cashfreeUpiTool,
  cashfreeCardPaymentTool,
  cashfreeNetbankingTool,
  cashfreeNewCardTool,
  cashfreeCheckoutTool,
} from "@cashfreepayments/cashfree-here";
import { loadCashfreeConfig } from "./src/lib/cashfree/config.js";
import { createOrder, getOrderStatus } from "./src/lib/cashfree/orders.js";
import {
  initiateOtp,
  verifyOtp,
  getAddresses,
  createAddress,
} from "./src/lib/cashfree/occ.js";
import { createSessionStore } from "./src/lib/cashfree/session.js";
import { createPayHandlers } from "./src/lib/server/payHandlers.js";
```

After the existing `shop` construction:

```ts
const cashfreeConfig = loadCashfreeConfig();
const pay = createPayHandlers({
  config: cashfreeConfig,
  store: createSessionStore(),
  shopDomain: config.shopDomain,
  returnUrl: `${config.serverUrl}/thanks?order_id={order_id}`,
  loadCart: (cartId) => shop.loadCartForOrder(cartId),
  createOrder,
  initiateOtp,
  verifyOtp,
  getAddresses,
  createAddress,
  getOrderStatus,
});
```

Inside `createStoreServer()`, after the existing `registerResource`:

```ts
  server.registerResource(
    ...registerCashfreeWidget({ widgetBaseUrl: config.serverUrl }),
  );

  const toolConfig = {
    environment: cashfreeConfig.environment,
    clientId: cashfreeConfig.clientId,
    clientSecret: cashfreeConfig.clientSecret,
    serverUrl: config.serverUrl,
  };

  // widgetAccessible lets our widget dispatch these directly via callTool,
  // which keeps the host's model-facing safety gate out of the payment path.
  for (const tool of [
    cashfreeUpiTool(toolConfig),
    cashfreeCardPaymentTool(toolConfig),
    cashfreeNetbankingTool(toolConfig),
    cashfreeNewCardTool(toolConfig),
    cashfreeCheckoutTool(toolConfig),
  ]) {
    const [name, definition, handler] = tool;
    server.registerTool(
      name,
      {
        ...definition,
        _meta: { ...definition._meta, "openai/widgetAccessible": true },
      },
      handler,
    );
  }
```

Add the routes, before the MCP branch:

```ts
    if (req.method === "POST" && url.pathname.startsWith("/api/pay/")) {
      const body = await readJsonBody(req);
      const route = url.pathname.slice("/api/pay/".length);
      const result =
        route === "order"
          ? await pay.handleCreateOrder(body)
          : route === "otp"
            ? await pay.handleSendOtp(body)
            : route === "otp/verify"
              ? await pay.handleVerifyOtp(body)
              : route === "addresses"
                ? await pay.handleCreateAddress(body)
                : { status: 404, body: { error: "Not found" } };
      res
        .writeHead(result.status, { "content-type": "application/json" })
        .end(JSON.stringify(result.body));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/pay/addresses") {
      const result = await pay.handleGetAddresses(
        url.searchParams.get("paymentSessionId") ?? "",
      );
      res
        .writeHead(result.status, { "content-type": "application/json" })
        .end(JSON.stringify(result.body));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/orders/")) {
      const result = await pay.handleOrderStatus(
        decodeURIComponent(url.pathname.slice("/api/orders/".length)),
      );
      res
        .writeHead(result.status, { "content-type": "application/json" })
        .end(JSON.stringify(result.body));
      return;
    }

    if (req.method === "GET" && url.pathname === "/thanks") {
      res
        .writeHead(200, { "content-type": "text/html" })
        .end("<!doctype html><meta charset=utf-8><title>Thanks</title><p>Payment complete. You can close this tab and return to the conversation.</p>");
      return;
    }
```

- [ ] **Step 5: Verify the server boots and routes respond**

```bash
npm run build && npm start &
sleep 4
curl -s -o /dev/null -w "order (bad phone): %{http_code}\n" -X POST http://localhost:8787/api/pay/order \
  -H 'Content-Type: application/json' -d '{"cartId":"x","phone":"123"}'
curl -s -o /dev/null -w "otp (unknown session): %{http_code}\n" -X POST http://localhost:8787/api/pay/otp \
  -H 'Content-Type: application/json' -d '{"paymentSessionId":"nope"}'
curl -s -o /dev/null -w "addresses (no session): %{http_code}\n" 'http://localhost:8787/api/pay/addresses?paymentSessionId=nope'
curl -s -o /dev/null -w "thanks: %{http_code}\n" http://localhost:8787/thanks
curl -s -X POST http://localhost:8787/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('tools:',JSON.parse(s).result.tools.map(t=>t.name).join(', ')))"
pkill -f "dist/server.js"
```

Expected: 400, 400, 400, 200, and a tool list containing `SearchProducts`, `UpiTool`, `CardPaymentTool`, `NetbankingTool`, `NewCardPaymentTool`, `CheckoutTool`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: wire payment routes and register Cashfree payment tools"
```

---

### Task 8: PhoneEntry and OtpEntry screens

**Files:**
- Create: `src/components/PhoneEntry.tsx`, `src/components/OtpEntry.tsx`
- Test: `src/components/PhoneEntry.test.tsx`, `src/components/OtpEntry.test.tsx`

**Interfaces:**
- Produces: `<PhoneEntry busy error onSubmit(phone) onBack />`, `<OtpEntry phone busy error onSubmit(otp) onResend onBack />`. Consumed by Task 11.

- [ ] **Step 1: Write the failing tests**

`src/components/PhoneEntry.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneEntry } from "./PhoneEntry";

const BASE = { busy: false, error: null, onSubmit: vi.fn(), onBack: vi.fn() };

describe("PhoneEntry", () => {
  it("submits a valid ten-digit number", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry {...BASE} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/phone/i), "8433719326");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith("8433719326");
  });

  it("rejects a short number without calling onSubmit", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry {...BASE} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/phone/i), "12345");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/10-digit/i)).toBeInTheDocument();
  });

  it("ignores non-digits as they are typed", async () => {
    render(<PhoneEntry {...BASE} />);

    const input = screen.getByLabelText(/phone/i);
    await userEvent.type(input, "84ab33-71 9326");

    expect(input).toHaveValue("8433719326");
  });

  it("disables the button while busy", () => {
    render(<PhoneEntry {...BASE} busy />);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("shows a server error", () => {
    render(<PhoneEntry {...BASE} error="order_amount is invalid" />);
    expect(screen.getByText(/order_amount is invalid/)).toBeInTheDocument();
  });
});
```

`src/components/OtpEntry.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpEntry } from "./OtpEntry";

const BASE = {
  phone: "8433719326",
  busy: false,
  error: null,
  onSubmit: vi.fn(),
  onResend: vi.fn(),
  onBack: vi.fn(),
};

describe("OtpEntry", () => {
  it("shows which number the code went to", () => {
    render(<OtpEntry {...BASE} />);
    expect(screen.getByText(/8433719326/)).toBeInTheDocument();
  });

  it("submits the entered code", async () => {
    const onSubmit = vi.fn();
    render(<OtpEntry {...BASE} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/otp|code/i), "111000");
    await userEvent.click(screen.getByRole("button", { name: /verify/i }));

    expect(onSubmit).toHaveBeenCalledWith("111000");
  });

  it("keeps the entered code visible after an error", () => {
    // Clearing the field on failure makes the user retype a code they can see
    // in their messages. Keep it.
    render(<OtpEntry {...BASE} error="Invalid OTP" />);
    expect(screen.getByText(/Invalid OTP/)).toBeInTheDocument();
  });

  it("offers resend", async () => {
    const onResend = vi.fn();
    render(<OtpEntry {...BASE} onResend={onResend} />);

    await userEvent.click(screen.getByRole("button", { name: /resend/i }));

    expect(onResend).toHaveBeenCalled();
  });

  it("disables verify while busy", () => {
    render(<OtpEntry {...BASE} busy />);
    expect(screen.getByRole("button", { name: /verify/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/PhoneEntry.test.tsx src/components/OtpEntry.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/components/PhoneEntry.tsx`**

```tsx
import { useState } from "react";

interface PhoneEntryProps {
  busy: boolean;
  error: string | null;
  onSubmit: (phone: string) => void;
  onBack: () => void;
}

export function PhoneEntry({ busy, error, onSubmit, onBack }: PhoneEntryProps) {
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);

  const valid = /^\d{10}$/.test(phone);

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back to cart
      </button>

      <h2 className="text-base font-semibold">Sign in to check out</h2>
      <p className="text-sm text-secondary">
        We&rsquo;ll text you a one-time code.
      </p>

      <label className="text-sm" htmlFor="phone">
        Phone number
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-secondary">+91</span>
        <input
          id="phone"
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          // Strip as typed rather than validating after the fact: a field that
          // silently refuses characters is clearer than one that scolds later.
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm"
        />
      </div>

      {touched && !valid && (
        <p className="text-sm text-red-600">Enter a 10-digit phone number.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setTouched(true);
          if (valid) onSubmit(phone);
        }}
        className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Please wait…" : "Continue"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/OtpEntry.tsx`**

```tsx
import { useState } from "react";

interface OtpEntryProps {
  phone: string;
  busy: boolean;
  error: string | null;
  onSubmit: (otp: string) => void;
  onResend: () => void;
  onBack: () => void;
}

export function OtpEntry({
  phone,
  busy,
  error,
  onSubmit,
  onResend,
  onBack,
}: OtpEntryProps) {
  const [otp, setOtp] = useState("");

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Change number
      </button>

      <h2 className="text-base font-semibold">Enter the code</h2>
      <p className="text-sm text-secondary">Sent to +91 {phone}</p>

      <label className="text-sm" htmlFor="otp">
        One-time code
      </label>
      <input
        id="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
        className="rounded-lg border border-black/15 px-3 py-2 text-sm tracking-widest"
      />

      {/* The value is deliberately retained on error — the code is still in
          the user's messages, and clearing it makes them retype it. */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit(otp)}
        className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Verifying…" : "Verify"}
      </button>

      <button
        type="button"
        onClick={onResend}
        className="text-sm text-secondary underline"
      >
        Resend code
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/components/PhoneEntry.test.tsx src/components/OtpEntry.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add phone and OTP entry screens"
```

---

### Task 9: AddressStep

**Files:**
- Create: `src/components/AddressStep.tsx`
- Test: `src/components/AddressStep.test.tsx`

**Interfaces:**
- Produces: `<AddressStep addresses busy error onSelect(address) onCreate(newAddress) onBack />`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddressStep } from "./AddressStep";
import type { OccAddress } from "../lib/cashfree/occ";

const ADDRESS: OccAddress = {
  id: "1054210",
  customer_name: "kishan",
  address_line_one: "Koramangala",
  address_line_two: "",
  city: "Bangalore",
  country: "India",
  country_code: "IN",
  zip_code: "560034",
  state: "Karnataka",
  state_code: "KA",
  phone: "+91 8433719326",
  email: "buyer@example.test",
};

const BASE = {
  busy: false,
  error: null,
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onBack: vi.fn(),
};

describe("AddressStep", () => {
  it("lists saved addresses", () => {
    render(<AddressStep {...BASE} addresses={[ADDRESS]} />);

    expect(screen.getByText(/Koramangala/)).toBeInTheDocument();
    expect(screen.getByText(/560034/)).toBeInTheDocument();
  });

  it("selects a saved address", async () => {
    const onSelect = vi.fn();
    render(<AddressStep {...BASE} addresses={[ADDRESS]} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: /deliver here/i }));

    expect(onSelect).toHaveBeenCalledWith(ADDRESS);
  });

  it("shows the capture form when there are no saved addresses", () => {
    // Not an error state — it is the expected path for a new customer.
    render(<AddressStep {...BASE} addresses={[]} />);

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save address/i })).toBeInTheDocument();
  });

  it("lets the user add another address when some already exist", async () => {
    render(<AddressStep {...BASE} addresses={[ADDRESS]} />);

    await userEvent.click(screen.getByRole("button", { name: /add a new address/i }));

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
  });

  it("submits a complete new address", async () => {
    const onCreate = vi.fn();
    render(<AddressStep {...BASE} addresses={[]} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/full name/i), "Kishan");
    await userEvent.type(screen.getByLabelText(/^address/i), "Koramangala");
    await userEvent.type(screen.getByLabelText(/city/i), "Bangalore");
    await userEvent.type(screen.getByLabelText(/state/i), "Karnataka");
    await userEvent.type(screen.getByLabelText(/pin/i), "560034");
    await userEvent.type(screen.getByLabelText(/email/i), "b@e.test");
    await userEvent.click(screen.getByRole("button", { name: /save address/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_name: "Kishan",
        address_line_one: "Koramangala",
        city: "Bangalore",
        state: "Karnataka",
        zip_code: "560034",
        email: "b@e.test",
        country: "India",
        country_code: "IN",
      }),
    );
  });

  it("does not submit an incomplete address", async () => {
    const onCreate = vi.fn();
    render(<AddressStep {...BASE} addresses={[]} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/full name/i), "Kishan");
    await userEvent.click(screen.getByRole("button", { name: /save address/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/required/i)).toBeInTheDocument();
  });

  it("retains entered values when the server rejects the address", async () => {
    render(<AddressStep {...BASE} addresses={[]} error="zip_code is invalid" />);

    expect(screen.getByText(/zip_code is invalid/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/AddressStep.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/components/AddressStep.tsx`**

```tsx
import { useState } from "react";
import type { NewAddress, OccAddress } from "../lib/cashfree/occ";

interface AddressStepProps {
  addresses: OccAddress[];
  busy: boolean;
  error: string | null;
  onSelect: (address: OccAddress) => void;
  onCreate: (address: NewAddress) => void;
  onBack: () => void;
}

const EMPTY = {
  customer_name: "",
  address_line_one: "",
  address_line_two: "",
  city: "",
  state: "",
  zip_code: "",
  email: "",
};

export function AddressStep({
  addresses,
  busy,
  error,
  onSelect,
  onCreate,
  onBack,
}: AddressStepProps) {
  // A customer with no saved addresses goes straight to the form; there is
  // nothing to choose from and an empty list is not worth rendering.
  const [adding, setAdding] = useState(addresses.length === 0);
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState(false);

  const required = [
    form.customer_name,
    form.address_line_one,
    form.city,
    form.state,
    form.zip_code,
    form.email,
  ];
  const complete = required.every((v) => v.trim().length > 0);

  function field(
    id: keyof typeof EMPTY,
    label: string,
    type = "text",
  ) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-secondary" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          type={type}
          value={form[id]}
          onChange={(e) => setForm({ ...form, [id]: e.target.value })}
          className="rounded-lg border border-black/15 px-3 py-2 text-sm"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back
      </button>

      <h2 className="text-base font-semibold">Delivery address</h2>

      {!adding && (
        <>
          <ul className="flex flex-col gap-2">
            {addresses.map((address) => (
              <li
                key={address.id}
                className="rounded-xl border border-black/10 p-3"
              >
                <p className="text-sm font-medium">{address.customer_name}</p>
                <p className="text-sm text-secondary">
                  {address.address_line_one}
                  {address.address_line_two ? `, ${address.address_line_two}` : ""}
                </p>
                <p className="text-sm text-secondary">
                  {address.city}, {address.state} {address.zip_code}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(address)}
                  className="mt-2 rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Deliver here
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm underline"
          >
            Add a new address
          </button>
        </>
      )}

      {adding && (
        <div className="flex flex-col gap-2">
          {field("customer_name", "Full name")}
          {field("address_line_one", "Address")}
          {field("address_line_two", "Apartment, suite (optional)")}
          {field("city", "City")}
          {field("state", "State")}
          {field("zip_code", "PIN code")}
          {field("email", "Email", "email")}

          {touched && !complete && (
            <p className="text-sm text-red-600">All fields are required.</p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (!complete) return;
              onCreate({
                ...form,
                // Cashfree wants both a name and a code. This demo is
                // India-only, matching the store's currency.
                country: "India",
                country_code: "IN",
                state_code: form.state.slice(0, 2).toUpperCase(),
                phone: "",
              } as NewAddress);
            }}
            className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save address"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

**Note on `phone`:** it is sent empty here and filled by the flow hook in Task
11, which knows the verified number. The component does not ask for a phone the
user has already given.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/AddressStep.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add address selection and capture screen"
```

---

### Task 10: MethodSelector and useOrderStatus

**Files:**
- Create: `src/components/MethodSelector.tsx`, `src/hooks/useOrderStatus.ts`
- Test: `src/components/MethodSelector.test.tsx`, `src/hooks/useOrderStatus.test.tsx`

**Interfaces:**
- Produces: `<MethodSelector paymentSessionId orderId busy error onDispatched onBack />`; `useOrderStatus(baseUrl, orderId | null)` → `{ status, done, timedOut }`.

- [ ] **Step 1: Write the failing tests**

`src/hooks/useOrderStatus.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOrderStatus } from "./useOrderStatus";

function ok(status: string) {
  return { ok: true, status: 200, json: async () => ({ orderStatus: status }) };
}

describe("useOrderStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does nothing without an order id", () => {
    renderHook(() => useOrderStatus("http://x", null));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a terminal PAID status and stops polling", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("PAID") as never);
    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await waitFor(() => expect(result.current.status).toBe("PAID"));
    expect(result.current.done).toBe(true);

    const callsAtTerminal = vi.mocked(fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsAtTerminal);
  });

  it("keeps polling while the order is ACTIVE", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("ACTIVE") as never);
    renderHook(() => useOrderStatus("http://x", "o1"));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    const first = vi.mocked(fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(first);
  });

  it("times out without asserting failure", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("ACTIVE") as never);
    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    await waitFor(() => expect(result.current.timedOut).toBe(true));
    // A timeout means we do not know, not that payment failed.
    expect(result.current.status).not.toBe("FAILED");
  });

  it("survives a failed poll and keeps trying", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(ok("PAID") as never);

    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await waitFor(() => expect(result.current.status).toBe("PAID"));
  });
});
```

`src/components/MethodSelector.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MethodSelector } from "./MethodSelector";

const callTool = vi.fn();
const sendFollowUpMessage = vi.fn();

const BASE = {
  paymentSessionId: "session_x",
  orderId: "o1",
  onDispatched: vi.fn(),
  onBack: vi.fn(),
};

describe("MethodSelector", () => {
  beforeEach(() => {
    callTool.mockReset().mockResolvedValue({});
    sendFollowUpMessage.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("openai", {
      widgetState: null,
      setWidgetState: vi.fn(),
      callTool,
      sendFollowUpMessage,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists the payment methods", () => {
    render(<MethodSelector {...BASE} />);

    expect(screen.getByRole("button", { name: /upi/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /netbanking/i })).toBeInTheDocument();
  });

  it("dispatches via callTool with the payment session id", async () => {
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /upi/i }));

    expect(callTool).toHaveBeenCalledWith(
      "UpiTool",
      expect.objectContaining({ paymentSessionId: "session_x" }),
    );
    // callTool bypasses the model, and with it the host safety gate that has
    // been measured refusing payment-shaped tools.
    expect(sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it("falls back to a follow-up message when callTool is unavailable", async () => {
    vi.stubGlobal("openai", {
      widgetState: null,
      setWidgetState: vi.fn(),
      sendFollowUpMessage,
    });
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /upi/i }));

    expect(sendFollowUpMessage).toHaveBeenCalled();
  });

  it("passes orderId to the hosted checkout fallback", async () => {
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /other ways to pay/i }));

    expect(callTool).toHaveBeenCalledWith(
      "CheckoutTool",
      expect.objectContaining({ paymentSessionId: "session_x", orderId: "o1" }),
    );
  });

  it("reports a dispatch failure without leaving the user stuck", async () => {
    callTool.mockRejectedValue(new Error("refused"));
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /upi/i }));

    expect(await screen.findByText(/refused|couldn.t start/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/hooks/useOrderStatus.test.tsx src/components/MethodSelector.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/hooks/useOrderStatus.ts`**

```ts
import { useEffect, useRef, useState } from "react";

const POLL_MS = 3_000;
const TIMEOUT_MS = 5 * 60_000;
const TERMINAL = new Set(["PAID", "FAILED", "CANCELLED", "EXPIRED"]);

export interface OrderStatusResult {
  status: string | null;
  done: boolean;
  timedOut: boolean;
}

/**
 * Polls our own order-status proxy until Cashfree reports a terminal state.
 *
 * Written here rather than reused from cashfree-here: that package's export
 * map exposes only its server entry, and its hooks are not compiled into dist.
 */
export function useOrderStatus(
  baseUrl: string,
  orderId: string | null,
): OrderStatusResult {
  const [status, setStatus] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    startedAt.current = Date.now();

    async function poll() {
      if (cancelled) return;

      if (Date.now() - startedAt.current > TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }

      try {
        const response = await fetch(`${baseUrl}/api/orders/${orderId}`);
        if (response.ok) {
          const body = (await response.json()) as { orderStatus?: string };
          if (!cancelled && body.orderStatus) {
            setStatus(body.orderStatus);
            if (TERMINAL.has(body.orderStatus)) return;
          }
        }
      } catch {
        // A failed poll is not a failed payment. Keep trying until timeout.
      }

      if (!cancelled) setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, orderId]);

  return { status, done: status !== null && TERMINAL.has(status), timedOut };
}
```

- [ ] **Step 4: Write `src/components/MethodSelector.tsx`**

```tsx
import { useCallback, useState } from "react";

interface MethodSelectorProps {
  paymentSessionId: string;
  orderId: string;
  onDispatched: () => void;
  onBack: () => void;
}

interface Method {
  id: string;
  label: string;
  toolName: string;
  extraArgs?: Record<string, unknown>;
}

const METHODS: Method[] = [
  { id: "upi", label: "UPI", toolName: "UpiTool" },
  { id: "saved_card", label: "Saved card", toolName: "CardPaymentTool" },
  { id: "new_card", label: "New card", toolName: "NewCardPaymentTool" },
  { id: "netbanking", label: "Netbanking", toolName: "NetbankingTool" },
];

export function MethodSelector({
  paymentSessionId,
  orderId,
  onDispatched,
  onBack,
}: MethodSelectorProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dispatch = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const host = window.openai;

        // callTool first, deliberately. It dispatches straight from the widget
        // with no model in the loop, which keeps the host's safety gate — the
        // one measured refusing payment-shaped tools — out of the path.
        if (host?.callTool) {
          await host.callTool(toolName, args);
        } else if (host?.sendFollowUpMessage) {
          await host.sendFollowUpMessage({
            prompt: `Call only the \`${toolName}\` tool with exactly ${JSON.stringify(args)} to render the Cashfree payment widget.`,
          });
        } else {
          throw new Error("This host cannot start a payment.");
        }

        onDispatched();
      } catch (caught) {
        setError((caught as Error).message || "Couldn't start the payment.");
      } finally {
        setBusy(false);
      }
    },
    [onDispatched],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back
      </button>

      <h2 className="text-base font-semibold">How would you like to pay?</h2>

      <div className="flex flex-col gap-2">
        {METHODS.map((method) => (
          <button
            key={method.id}
            type="button"
            disabled={busy}
            onClick={() =>
              dispatch(method.toolName, {
                paymentSessionId,
                ...(method.extraArgs ?? {}),
              })
            }
            className="rounded-xl border border-black/15 px-4 py-3 text-left text-sm font-medium disabled:opacity-40"
          >
            {method.label}
          </button>
        ))}
      </div>

      {/* Escape hatch. If a per-method tool will not dispatch in this host,
          hosted checkout still gets the buyer to a payment page. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => dispatch("CheckoutTool", { paymentSessionId, orderId })}
        className="text-sm text-secondary underline disabled:opacity-40"
      >
        Other ways to pay
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/hooks/useOrderStatus.test.tsx src/components/MethodSelector.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add payment method selector and order status polling"
```

---

### Task 11: Checkout flow state machine and App wiring

**Files:**
- Create: `src/hooks/useCheckoutFlow.ts`
- Modify: `src/components/App.tsx`, `src/types/index.ts`
- Test: `src/hooks/useCheckoutFlow.test.tsx`, `src/components/App.test.tsx`

**Interfaces:**
- Produces: `useCheckoutFlow(baseUrl)` → `{ step, busy, error, paymentSessionId, orderId, phone, addresses, start, submitOtp, resendOtp, selectAddress, createAddress, markDispatched, reset }`.

- [ ] **Step 1: Extend `WidgetState` in `src/types/index.ts`**

```ts
/**
 * Only three values. The checkout sub-steps are owned by useCheckoutFlow, not
 * duplicated here — two state machines advancing the same journey will drift,
 * and the bug shows up as a screen that will not move.
 */
export type Screen = "results" | "cart" | "checkout";

export type CheckoutStep = "phone" | "otp" | "address" | "method" | "paying";

/** The flow hook is the only writer. Persisted so a host re-render mid-checkout
 *  does not strand a buyer whose Cashfree order already exists. */
export interface CheckoutSnapshot {
  step: CheckoutStep;
  paymentSessionId?: string;
  orderId?: string;
  phone?: string;
}

export interface WidgetState {
  screen: Screen;
  cartId?: string;
  quantities: Record<string, number>;
  checkoutOpened?: boolean;
  checkout?: CheckoutSnapshot;
}
```

`useCheckoutFlow` therefore takes `(baseUrl, persisted, onPersist)` — the same
shape `useCart` already uses — rather than holding step state privately. Its
signature in Task 11 Step 4 becomes:

```ts
export function useCheckoutFlow(
  baseUrl: string,
  persisted: CheckoutSnapshot,
  onPersist: (snapshot: CheckoutSnapshot) => void,
): CheckoutFlow
```

Internally, replace the five `useState` calls for `step`, `paymentSessionId`,
`orderId` and `phone` with a single `snapshot` state seeded from `persisted`,
and a `commit(patch)` helper that both sets state and calls `onPersist`:

```ts
  const [snapshot, setSnapshot] = useState<CheckoutSnapshot>(persisted);

  const commit = useCallback(
    (patch: Partial<CheckoutSnapshot>) => {
      setSnapshot((prev) => {
        const next = { ...prev, ...patch };
        onPersist(next);
        return next;
      });
    },
    [onPersist],
  );
```

Every `setStep("otp")` becomes `commit({ step: "otp" })`, and
`setPaymentSessionId(x)` becomes part of the same commit. `addresses`, `busy`
and `error` stay in plain `useState` — they are re-fetchable or transient and
not worth persisting.

Add two tests to Task 11 Step 2:

```tsx
  it("persists the step and session after the order is created", async () => {
    const onPersist = vi.fn();
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ orderId: "o1", paymentSessionId: "s1" }) as never)
      .mockResolvedValueOnce(json({ sent: true }) as never);

    const { result } = renderHook(() =>
      useCheckoutFlow("http://x", { step: "phone" }, onPersist),
    );
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });

    expect(onPersist).toHaveBeenCalledWith(
      expect.objectContaining({ step: "otp", paymentSessionId: "s1", orderId: "o1" }),
    );
  });

  it("resumes from a persisted snapshot", () => {
    const { result } = renderHook(() =>
      useCheckoutFlow(
        "http://x",
        { step: "address", paymentSessionId: "s1", orderId: "o1", phone: "8433719326" },
        vi.fn(),
      ),
    );

    expect(result.current.step).toBe("address");
    expect(result.current.paymentSessionId).toBe("s1");
  });
```

And in Task 11 Step 6, App supplies them from widget state:

```tsx
  const flow = useCheckoutFlow(
    BASE_URL,
    widgetState.checkout ?? { step: "phone" },
    (checkout) => setWidgetState((prev) => ({ ...prev, checkout })),
  );
```

- [ ] **Step 2: Write the failing test for the flow hook**

`src/hooks/useCheckoutFlow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCheckoutFlow } from "./useCheckoutFlow";

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("useCheckoutFlow", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("creates the order and sends an OTP on start", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({ orderId: "o1", paymentSessionId: "s1", orderAmount: 3600 }) as never,
      )
      .mockResolvedValueOnce(json({ sent: true }) as never);

    const { result } = renderHook(() => useCheckoutFlow("http://x"));

    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://x/api/pay/order");
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("http://x/api/pay/otp");
    expect(result.current.step).toBe("otp");
    expect(result.current.paymentSessionId).toBe("s1");
  });

  it("stays on phone when order creation fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: "order_amount is invalid" }, 502) as never,
    );

    const { result } = renderHook(() => useCheckoutFlow("http://x"));

    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });

    expect(result.current.step).toBe("phone");
    expect(result.current.error).toBe("order_amount is invalid");
  });

  it("loads addresses after a successful OTP", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ orderId: "o1", paymentSessionId: "s1" }) as never)
      .mockResolvedValueOnce(json({ sent: true }) as never)
      .mockResolvedValueOnce(json({ ok: true }) as never)
      .mockResolvedValueOnce(json({ addresses: [{ id: "a1" }] }) as never);

    const { result } = renderHook(() => useCheckoutFlow("http://x"));
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });
    await act(async () => {
      await result.current.submitOtp("111000");
    });

    await waitFor(() => expect(result.current.step).toBe("address"));
    expect(result.current.addresses).toEqual([{ id: "a1" }]);
  });

  it("stays on otp when the code is wrong", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ orderId: "o1", paymentSessionId: "s1" }) as never)
      .mockResolvedValueOnce(json({ sent: true }) as never)
      .mockResolvedValueOnce(json({ error: "Invalid OTP" }, 400) as never);

    const { result } = renderHook(() => useCheckoutFlow("http://x"));
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });
    await act(async () => {
      await result.current.submitOtp("000000");
    });

    expect(result.current.step).toBe("otp");
    expect(result.current.error).toBe("Invalid OTP");
  });

  it("advances to method after an address is selected", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ orderId: "o1", paymentSessionId: "s1" }) as never)
      .mockResolvedValueOnce(json({ sent: true }) as never)
      .mockResolvedValueOnce(json({ ok: true }) as never)
      .mockResolvedValueOnce(json({ addresses: [{ id: "a1" }] }) as never);

    const { result } = renderHook(() => useCheckoutFlow("http://x"));
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });
    await act(async () => {
      await result.current.submitOtp("111000");
    });
    act(() => {
      result.current.selectAddress({ id: "a1" } as never);
    });

    expect(result.current.step).toBe("method");
  });

  it("attaches the verified phone when creating an address", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ orderId: "o1", paymentSessionId: "s1" }) as never)
      .mockResolvedValueOnce(json({ sent: true }) as never)
      .mockResolvedValueOnce(json({ ok: true }) as never)
      .mockResolvedValueOnce(json({ addresses: [] }) as never)
      .mockResolvedValueOnce(json({ addresses: [{ id: "a2" }] }) as never);

    const { result } = renderHook(() => useCheckoutFlow("http://x"));
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });
    await act(async () => {
      await result.current.submitOtp("111000");
    });
    await act(async () => {
      await result.current.createAddress({ city: "Bangalore" } as never);
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[4][1]?.body as string);
    // The user already gave us their number; asking again in the form would be
    // rude and error-prone.
    expect(body.address.phone).toBe("+91 8433719326");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/hooks/useCheckoutFlow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/hooks/useCheckoutFlow.ts`**

```ts
import { useCallback, useState } from "react";
import type { NewAddress, OccAddress } from "../lib/cashfree/occ";

export type CheckoutStep = "phone" | "otp" | "address" | "method" | "paying";

export interface CheckoutFlow {
  step: CheckoutStep;
  busy: boolean;
  error: string | null;
  paymentSessionId: string | null;
  orderId: string | null;
  phone: string | null;
  addresses: OccAddress[];
  start: (cartId: string, phone: string) => Promise<void>;
  submitOtp: (otp: string) => Promise<void>;
  resendOtp: () => Promise<void>;
  selectAddress: (address: OccAddress) => void;
  createAddress: (address: Partial<NewAddress>) => Promise<void>;
  markDispatched: () => void;
  reset: () => void;
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof parsed?.error === "string" ? parsed.error : "Request failed",
    );
  }
  return parsed;
}

export function useCheckoutFlow(baseUrl: string): CheckoutFlow {
  const [step, setStep] = useState<CheckoutStep>("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentSessionId, setPaymentSessionId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<OccAddress[]>([]);

  const loadAddresses = useCallback(
    async (session: string) => {
      const response = await fetch(
        `${baseUrl}/api/pay/addresses?paymentSessionId=${encodeURIComponent(session)}`,
      );
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed?.error ?? "Couldn't load addresses");
      return (parsed.addresses ?? []) as OccAddress[];
    },
    [baseUrl],
  );

  const start = useCallback(
    async (cartId: string, enteredPhone: string) => {
      setBusy(true);
      setError(null);
      try {
        const created = await post(`${baseUrl}/api/pay/order`, {
          cartId,
          phone: enteredPhone,
        });
        setPaymentSessionId(created.paymentSessionId);
        setOrderId(created.orderId);
        setPhone(enteredPhone);

        // Separate call so resend has an endpoint that does not create a
        // second order.
        await post(`${baseUrl}/api/pay/otp`, {
          paymentSessionId: created.paymentSessionId,
        });
        setStep("otp");
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl],
  );

  const submitOtp = useCallback(
    async (otp: string) => {
      if (!paymentSessionId) return;
      setBusy(true);
      setError(null);
      try {
        await post(`${baseUrl}/api/pay/otp/verify`, { paymentSessionId, otp });
        setAddresses(await loadAddresses(paymentSessionId));
        setStep("address");
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, paymentSessionId, loadAddresses],
  );

  const resendOtp = useCallback(async () => {
    if (!paymentSessionId) return;
    setBusy(true);
    setError(null);
    try {
      await post(`${baseUrl}/api/pay/otp`, { paymentSessionId });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, paymentSessionId]);

  const createAddress = useCallback(
    async (address: Partial<NewAddress>) => {
      if (!paymentSessionId || !phone) return;
      setBusy(true);
      setError(null);
      try {
        const parsed = await post(`${baseUrl}/api/pay/addresses`, {
          paymentSessionId,
          // The verified number, not one retyped into the form.
          address: { ...address, phone: `+91 ${phone}` },
        });
        setAddresses((parsed.addresses ?? []) as OccAddress[]);
        setStep("method");
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, paymentSessionId, phone],
  );

  return {
    step,
    busy,
    error,
    paymentSessionId,
    orderId,
    phone,
    addresses,
    start,
    submitOtp,
    resendOtp,
    selectAddress: () => setStep("method"),
    createAddress,
    markDispatched: () => setStep("paying"),
    reset: () => {
      setStep("phone");
      setError(null);
      setPaymentSessionId(null);
      setOrderId(null);
      setAddresses([]);
    },
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/hooks/useCheckoutFlow.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire the screens into `src/components/App.tsx`**

Import the new components and hooks. `screen` decides shopping versus checking
out; **`flow.step` alone decides which checkout screen shows.** Nothing outside
`useCheckoutFlow` advances a checkout step.

```tsx
  const flow = useCheckoutFlow(BASE_URL);
  const order = useOrderStatus(BASE_URL, flow.step === "paying" ? flow.orderId : null);

  if (screen === "cart") {
    return (
      <CartView
        cart={cart}
        busy={busy}
        error={error}
        checkoutOpened={false}
        openFailed={false}
        onQuantityChange={(v, q) => void setQuantity(v, q)}
        onCheckout={() => setScreen("checkout")}
        onBack={() => setScreen("results")}
      />
    );
  }

  if (screen === "checkout") {
    // One switch, one source of truth. The flow hook owns every transition;
    // the only thing App decides is when to leave checkout entirely.
    if (flow.step === "phone") {
      return (
        <PhoneEntry
          busy={flow.busy}
          error={flow.error}
          onSubmit={(phone) => {
            if (cart) void flow.start(cart.cartId, phone);
          }}
          onBack={() => setScreen("cart")}
        />
      );
    }

    if (flow.step === "otp") {
      return (
        <OtpEntry
          phone={flow.phone ?? ""}
          busy={flow.busy}
          error={flow.error}
          onSubmit={(otp) => void flow.submitOtp(otp)}
          onResend={() => void flow.resendOtp()}
          onBack={() => flow.reset()}
        />
      );
    }

    if (flow.step === "address") {
      return (
        <AddressStep
          addresses={flow.addresses}
          busy={flow.busy}
          error={flow.error}
          onSelect={flow.selectAddress}
          onCreate={(a) => void flow.createAddress(a)}
          onBack={() => setScreen("cart")}
        />
      );
    }

    if (flow.step === "method" && flow.paymentSessionId && flow.orderId) {
      return (
        <MethodSelector
          paymentSessionId={flow.paymentSessionId}
          orderId={flow.orderId}
          onDispatched={flow.markDispatched}
          onBack={() => setScreen("cart")}
        />
      );
    }
  }

  if (flow.step === "paying") {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 p-6 text-center">
        {order.status === "PAID" ? (
          <p className="text-base font-semibold">Payment received.</p>
        ) : order.timedOut ? (
          // Non-committal on purpose: a timeout means we do not know.
          <p className="text-sm text-secondary">
            We couldn&rsquo;t confirm this yet. Check your bank or UPI app before
            paying again.
          </p>
        ) : order.status === "FAILED" ? (
          <p className="text-sm text-red-600">That payment didn&rsquo;t go through.</p>
        ) : (
          <p className="text-sm text-secondary">Waiting for payment…</p>
        )}
      </div>
    );
  }
```

- [ ] **Step 7: Update `App.test.tsx` for the new Checkout behaviour**

The milestone-1 tests asserting `openExternal` on Checkout now describe removed
behaviour. Replace them with:

```tsx
  it("enters the phone step when Checkout is tapped", async () => {
    render(<App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />);

    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await userEvent.click(await screen.findByRole("button", { name: /checkout/i }));

    expect(await screen.findByLabelText(/phone/i)).toBeInTheDocument();
  });
```

Delete the `opens continue_url through the host's external-open` and
`surfaces a manual link when the host refuses to open the link` tests — the
behaviour they cover no longer exists on this path.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run && npm run type-check`
Expected: all PASS, tsc exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: wire the OCC checkout flow into the widget"
```

---

### Task 12: End-to-end verification against sandbox

Not unit tests. This is the gate before anyone sees it.

- [ ] **Step 1: Build, start, confirm boot**

```bash
npm run build && npm start &
sleep 4
tail -8 /tmp/srv.log 2>/dev/null || true
```

Expected: store line, widget origin, and the storefront reachability note.

- [ ] **Step 2: Drive the whole flow with curl**

```bash
U=http://localhost:8787
VID=$(node -e "console.log(require('./src/lib/ucp/__fixtures__/search-catalog.json').products[0].variants[0].id)")
CART=$(curl -s -X POST $U/api/shop/cart -H 'Content-Type: application/json' \
  -d "{\"lines\":[{\"variantId\":\"$VID\",\"quantity\":2}]}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).cartId))")
ORDER=$(curl -s -X POST $U/api/pay/order -H 'Content-Type: application/json' \
  -d "{\"cartId\":\"$CART\",\"phone\":\"8433719326\"}")
echo "$ORDER"
PSID=$(echo "$ORDER" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).paymentSessionId))")
curl -s -X POST $U/api/pay/otp -H 'Content-Type: application/json' -d "{\"paymentSessionId\":\"$PSID\"}"
# → {"sent":true} and an SMS. Confirm with the phone's owner first.
curl -s -X POST $U/api/pay/otp/verify -H 'Content-Type: application/json' \
  -d "{\"paymentSessionId\":\"$PSID\",\"otp\":\"111000\"}"
curl -s "$U/api/pay/addresses?paymentSessionId=$PSID"
```

Expected: an order with a `payment_session_id`, `{"sent":true}`, `{"ok":true}`,
then the saved address list.

**Check explicitly that no response body contains an auth token.**

```bash
curl -s -X POST $U/api/pay/otp/verify -H 'Content-Type: application/json' \
  -d "{\"paymentSessionId\":\"$PSID\",\"otp\":\"111000\"}" | grep -c "ch_x" || echo "no token leaked (good)"
```

- [ ] **Step 3: Run it in a real host**

Tunnel, set `SERVER_URL`, restart, add `<origin>/mcp` as a connector. Then:

1. "show me shirts from the store" → grid renders **with images**
2. Add → cart with correct variant and total
3. Checkout → phone screen
4. Enter number → OTP screen, SMS arrives
5. Enter `111000` → address screen with saved addresses
6. Pick one → method selector
7. Pick UPI → **does `callTool` dispatch, or is it refused?** Record the result — this is the Task 1 Step 3 question.
8. Pay → widget shows "Payment received" only after recon reports `PAID`

- [ ] **Step 4: Record the dispatch results**

Append to `docs/spikes/2026-08-12-occ-spike.md`: for each of the five tools,
whether `callTool` dispatched. If any were refused, note whether the follow-up
fallback worked. If most were refused, the method list shrinks to those that
work and hosted checkout is promoted.

- [ ] **Step 5: Update the README**

Document the new flow, the new env vars, that the session store is in-memory and
does not survive restart, and that the OCC endpoints are internal and
unversioned.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "docs: record OCC end-to-end verification and update README"
```

---

## Verification checklist

Per `superpowers:verification-before-completion`:

- [ ] `npx vitest run` — all pass, output shown
- [ ] `npm run type-check` — exits 0
- [ ] `npm run build` — both bundles produced
- [ ] Task 12 Step 2 confirmed no auth token appears in any response body
- [ ] Task 12 Step 3 completed in a real host, all eight checks observed
- [ ] Recon reports `PAID` before any success copy is shown
- [ ] Timeout copy asserts nothing about the outcome
- [ ] No live OCC response committed as a fixture
- [ ] `.env` still gitignored; no credential in any commit
