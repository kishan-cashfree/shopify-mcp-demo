import { describe, it, expect, vi } from "vitest";
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
      lineSubtotal: { amountMinor: 360000, currency: "INR" },
      lineTotal: { amountMinor: 360000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 360000, currency: "INR" },
  total: { amountMinor: 360000, currency: "INR" },
};

const VALID_ADDRESS = {
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
};

function build(overrides: Record<string, unknown> = {}) {
  const store = createSessionStore();
  const deps = {
    config: {
      clientId: "x",
      clientSecret: "y",
      environment: "sandbox" as const,
      baseUrl: "https://sandbox.cashfree.com",
    },
    store,
    shopDomain: "shop.myshopify.com",
    returnUrl: "https://srv.test/thanks",
    loadCart: vi
      .fn()
      .mockResolvedValue({ cart: CART, handles: {}, listPrices: {} }),
    createOrder: vi.fn().mockResolvedValue({
      orderId: "o1",
      paymentSessionId: "session_x",
      orderAmount: 3600,
    }),
    initiateOtp: vi.fn().mockResolvedValue(undefined),
    verifyOtp: vi
      .fn()
      .mockResolvedValue({ authToken: "tok", customerUid: "u1" }),
    getAddresses: vi.fn().mockResolvedValue([]),
    createAddress: vi.fn().mockResolvedValue([]),
    getOrderStatus: vi
      .fn()
      .mockResolvedValue({ orderId: "o1", orderStatus: "PAID" }),
    ...overrides,
  };
  return { store, deps, handlers: createPayHandlers(deps as never) };
}

describe("handleCreateOrder", () => {
  it("creates an order and records the session", async () => {
    const { store, handlers } = build();

    const result = await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      orderId: "o1",
      paymentSessionId: "session_x",
      orderAmount: 3600,
      checkoutUrl: "https://sandbox.cashfree.com/checkout?pt=session_x",
      // One deep link per method, all off this one session. This is what
      // replaced creating a second order to carry the buyer's choice: the
      // choice now rides on the URL rather than on order_meta.
      checkoutUrls: {
        upi: "https://sandbox.cashfree.com/checkout/payment-method/upi?pt=session_x",
        card: "https://sandbox.cashfree.com/checkout/payment-method/card?pt=session_x",
        nb: "https://sandbox.cashfree.com/checkout/payment-method/net-banking?pt=session_x",
      },
    });
    expect(store.get("session_x")?.phone).toBe("8433719326");
  });

  it("prices from the Shopify cart, ignoring any client-sent amount", async () => {
    const { deps, handlers } = build();

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      orderAmount: 1,
    });

    expect(deps.loadCart).toHaveBeenCalledWith("gid://shopify/Cart/abc");
    const arg = vi.mocked(deps.createOrder).mock.calls[0][1] as { cart: Cart };
    expect(arg.cart.total.amountMinor).toBe(360000);
  });

  it("rejects a phone that is not ten digits", async () => {
    const { handlers } = build();

    const result = await handlers.handleCreateOrder({
      cartId: "c",
      phone: "12345",
    });

    expect(result.status).toBe(400);
  });

  it("rejects a missing cart id", async () => {
    const { handlers } = build();

    expect(
      (await handlers.handleCreateOrder({ phone: "8433719326" })).status,
    ).toBe(400);
  });

  it("returns 502 with Cashfree's message when the order is rejected", async () => {
    const { handlers } = build({
      createOrder: vi
        .fn()
        .mockRejectedValue(new Error("order_amount is invalid")),
    });

    const result = await handlers.handleCreateOrder({
      cartId: "c",
      phone: "8433719326",
    });

    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "order_amount is invalid" });
  });
});

describe("handleSendOtp", () => {
  it("initiates using the stored phone", async () => {
    const { store, deps, handlers } = build();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await handlers.handleSendOtp({ paymentSessionId: "s1" });

    expect(result.status).toBe(200);
    expect(deps.initiateOtp).toHaveBeenCalledWith(expect.anything(), {
      paymentSessionId: "s1",
      phone: "8433719326",
    });
  });

  it("returns 400 for an unknown session", async () => {
    const { handlers } = build();

    expect(
      (await handlers.handleSendOtp({ paymentSessionId: "nope" })).status,
    ).toBe(400);
  });
});

describe("handleVerifyOtp", () => {
  it("stores the auth token and does not return it", async () => {
    const { store, handlers } = build();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await handlers.handleVerifyOtp({
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
    const { store, handlers } = build({
      verifyOtp: vi.fn().mockRejectedValue(new Error("Invalid OTP")),
    });
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await handlers.handleVerifyOtp({
      paymentSessionId: "s1",
      otp: "000000",
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: "Invalid OTP" });
  });

  it("returns 400 for an unknown session", async () => {
    const { handlers } = build();

    expect(
      (await handlers.handleVerifyOtp({ paymentSessionId: "x", otp: "111000" }))
        .status,
    ).toBe(400);
  });
});

describe("handleGetAddresses", () => {
  it("returns the address list", async () => {
    const { store, handlers } = build({
      getAddresses: vi.fn().mockResolvedValue([{ id: "1", city: "Bangalore" }]),
    });
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
      authToken: "tok",
    });

    const result = await handlers.handleGetAddresses("s1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ addresses: [{ id: "1", city: "Bangalore" }] });
  });

  it("returns 401 when the session has not verified an OTP", async () => {
    const { store, handlers } = build();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    expect((await handlers.handleGetAddresses("s1")).status).toBe(401);
  });

  it("returns 400 for an unknown session", async () => {
    const { handlers } = build();

    expect((await handlers.handleGetAddresses("nope")).status).toBe(400);
  });
});

describe("handleCreateAddress", () => {
  it("creates and returns the refreshed list", async () => {
    const { store, handlers } = build({
      createAddress: vi.fn().mockResolvedValue([{ id: "2" }]),
    });
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
      authToken: "tok",
    });

    const result = await handlers.handleCreateAddress({
      paymentSessionId: "s1",
      address: VALID_ADDRESS,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ addresses: [{ id: "2" }] });
  });

  it("rejects an address missing required fields", async () => {
    const { store, handlers } = build();
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
      authToken: "tok",
    });

    const result = await handlers.handleCreateAddress({
      paymentSessionId: "s1",
      address: { city: "Bangalore" },
    });

    expect(result.status).toBe(400);
  });

  it("returns 401 when not signed in", async () => {
    const { store, handlers } = build();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "8433719326" });

    const result = await handlers.handleCreateAddress({
      paymentSessionId: "s1",
      address: VALID_ADDRESS,
    });

    expect(result.status).toBe(401);
  });
});

describe("handleOrderStatus", () => {
  it("returns the order status", async () => {
    const { handlers } = build();

    const result = await handlers.handleOrderStatus("o1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ orderId: "o1", orderStatus: "PAID" });
  });

  it("returns 502 when the lookup fails", async () => {
    const { handlers } = build({
      getOrderStatus: vi.fn().mockRejectedValue(new Error("not found")),
    });

    expect((await handlers.handleOrderStatus("o1")).status).toBe(502);
  });
});

describe("order sync wiring", () => {
  it("records the cart the order was priced from", async () => {
    const { store, handlers } = build();

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
    });

    expect(store.get("session_x")?.cartId).toBe("gid://shopify/Cart/abc");
  });

  it("records the address the buyer chose", async () => {
    const { store, handlers } = build();
    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
    });
    store.setAuth("session_x", "tok");

    const result = await handlers.handleSelectAddress({
      paymentSessionId: "session_x",
      address: { id: "addr_1", ...VALID_ADDRESS },
    });

    expect(result.status).toBe(200);
    expect(store.get("session_x")?.address?.id).toBe("addr_1");
  });

  it("refuses an address for a session that is not signed in", async () => {
    const { store, handlers } = build();
    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
    });

    const result = await handlers.handleSelectAddress({
      paymentSessionId: "session_x",
      address: { id: "addr_1", ...VALID_ADDRESS },
    });

    expect(result.status).toBe(401);
    expect(store.get("session_x")?.address).toBeUndefined();
  });

  it("hands the poll's status to the sync and reports the placed order", async () => {
    const syncOrder = vi.fn().mockResolvedValue({
      status: "placed",
      order: { id: "gid://shopify/Order/55", name: "#1042" },
    });
    const { handlers } = build({ syncOrder });

    const result = await handlers.handleOrderStatus("o1");

    // Cashfree's own status, read from Cashfree — not anything the widget said.
    expect(syncOrder).toHaveBeenCalledWith("o1", "PAID");
    expect(result.body).toEqual({
      orderId: "o1",
      orderStatus: "PAID",
      shopifyOrder: { id: "gid://shopify/Order/55", name: "#1042" },
    });
  });

  /**
   * The poll is how the widget learns the payment succeeded. A Shopify failure
   * must not take that away: the money has moved either way, and a buyer who
   * paid should not be told the payment failed because an order sync did.
   */
  it("still reports a paid order when the sync fails", async () => {
    const { handlers } = build({
      syncOrder: vi
        .fn()
        .mockResolvedValue({ status: "failed", error: "Variant not found" }),
    });

    const result = await handlers.handleOrderStatus("o1");

    expect(result.status).toBe(200);
    // The error itself is not sent: it is a Shopify Admin API message and the
    // buyer can do nothing with it. The flag is, because the poll stops at the
    // first PAID and would otherwise never give the sync a second attempt.
    expect(result.body).toEqual({
      orderId: "o1",
      orderStatus: "PAID",
      shopifySyncPending: true,
    });
  });

  /**
   * A skip is not a retry. No token, no session and no address do not fix
   * themselves, and telling the widget to keep polling for them would spend a
   * minute of requests on a state that cannot change.
   */
  it("does not ask the widget to retry a skipped sync", async () => {
    const { handlers } = build({
      syncOrder: vi
        .fn()
        .mockResolvedValue({ status: "skipped", reason: "no-address" }),
    });

    const result = await handlers.handleOrderStatus("o1");

    expect(result.body).toEqual({ orderId: "o1", orderStatus: "PAID" });
  });

  it("survives a sync that throws outright", async () => {
    const { handlers } = build({
      syncOrder: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await handlers.handleOrderStatus("o1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ orderId: "o1", orderStatus: "PAID" });
  });
});


/**
 * Reusing the order a failed OTP send left behind.
 *
 * Measured 2026-08-27 on ecom360-cf: `POST /api/pay/otp` returned 502
 * "Couldn't send the OTP" three times running, and because the order is
 * created BEFORE the OTP is sent — it has to be, its payment_session_id is the
 * `x-chxs-id` that /auth/initiate needs — each retry from the phone screen
 * left another abandoned order in Cashfree. Four orders, one checkout.
 *
 * The order was never what failed. Reuse is refused on any doubt, though: an
 * order that no longer matches the cart would charge the buyer the old total.
 */
describe("handleCreateOrder — resuming an order after a failed OTP", () => {
  async function existing(overrides: Record<string, unknown> = {}) {
    const built = build({
      // ACTIVE, not the harness default of PAID: an order that already took
      // money is not one to resume.
      getOrderStatus: vi
        .fn()
        .mockResolvedValue({ orderId: "o1", orderStatus: "ACTIVE" }),
      ...overrides,
    });
    await built.handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
    });
    (built.deps.createOrder as ReturnType<typeof vi.fn>).mockClear();
    return built;
  }

  it("returns the same order instead of creating another", async () => {
    const { deps, handlers } = await existing();

    const result = await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      resumeSessionId: "session_x",
    });

    expect(deps.createOrder).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect((result.body as { paymentSessionId: string }).paymentSessionId).toBe(
      "session_x",
    );
    expect((result.body as { orderId: string }).orderId).toBe("o1");
  });

  it("still hands back the per-method checkout URLs", async () => {
    const { handlers } = await existing();

    const result = await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      resumeSessionId: "session_x",
    });

    // A resumed order pays exactly like a fresh one. Omitting these would
    // leave the pay screen with nothing to open.
    expect(
      (result.body as { checkoutUrls: Record<string, string> }).checkoutUrls
        .upi,
    ).toContain("/payment-method/upi?pt=session_x");
  });

  // Each of these is a reason the old order is the wrong order to pay.
  it("creates a new order when the buyer changed their number", async () => {
    const { deps, handlers } = await existing();

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "9000000000",
      resumeSessionId: "session_x",
    });

    expect(deps.createOrder).toHaveBeenCalled();
  });

  it("creates a new order when the cart changed", async () => {
    const { deps, handlers } = await existing();

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/other",
      phone: "8433719326",
      resumeSessionId: "session_x",
    });

    expect(deps.createOrder).toHaveBeenCalled();
  });

  /**
   * The cart id survives a quantity change — Shopify keeps one cart and
   * replaces its lines — so the id matching is not enough on its own. The
   * amount is what actually protects the buyer here.
   */
  it("creates a new order when the total changed under the same cart", async () => {
    const { deps, handlers } = await existing();
    (deps.loadCart as ReturnType<typeof vi.fn>).mockResolvedValue({
      cart: { ...CART, total: { amountMinor: 720000, currency: "INR" } },
      handles: {},
      listPrices: {},
    });

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      resumeSessionId: "session_x",
    });

    expect(deps.createOrder).toHaveBeenCalled();
  });

  it("creates a new order when the old one is no longer ACTIVE", async () => {
    const { deps, handlers } = await existing({
      getOrderStatus: vi
        .fn()
        .mockResolvedValue({ orderId: "o1", orderStatus: "EXPIRED" }),
    });

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      resumeSessionId: "session_x",
    });

    expect(deps.createOrder).toHaveBeenCalled();
  });

  // A status lookup that fails says nothing about the order. Creating a fresh
  // one costs an abandoned order; reusing on a guess could charge the wrong
  // amount or re-open a paid order.
  it("creates a new order when the old one's status cannot be read", async () => {
    const { deps, handlers } = await existing({
      getOrderStatus: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      resumeSessionId: "session_x",
    });

    expect(deps.createOrder).toHaveBeenCalled();
  });

  it("ignores a session id it never issued", async () => {
    const { deps, handlers } = await existing();

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      resumeSessionId: "forged",
    });

    expect(deps.createOrder).toHaveBeenCalled();
  });
});
