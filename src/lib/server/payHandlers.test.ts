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

describe("handleCreateOrder — payment method filter", () => {
  it("passes the chosen methods through as a comma-separated string", async () => {
    // order_meta.payment_methods is the only lever that narrows the hosted
    // page, and it is settable ONLY at Create Order — there is no endpoint to
    // amend order_meta afterwards.
    const { deps, handlers } = build();

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      paymentMethods: ["cc", "upi"],
    });

    const arg = vi.mocked(deps.createOrder).mock.calls[0][1] as {
      paymentMethods?: string;
    };
    expect(arg.paymentMethods).toBe("cc,upi");
  });

  it("leaves the filter off when the buyer chose nothing", async () => {
    // The login order is created before any method is picked. Sending an empty
    // filter would narrow that order to nothing.
    const { deps, handlers } = build();

    await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
    });

    const arg = vi.mocked(deps.createOrder).mock.calls[0][1] as {
      paymentMethods?: string;
    };
    expect(arg.paymentMethods).toBeUndefined();
  });

  it("rejects a code Cashfree does not accept", async () => {
    // This string lands in a payment order. An unrecognised code silently
    // widens or empties what the hosted page offers, and nothing upstream
    // complains.
    const { handlers } = build();

    const result = await handlers.handleCreateOrder({
      cartId: "gid://shopify/Cart/abc",
      phone: "8433719326",
      paymentMethods: ["paypal"],
    });

    expect(result.status).toBe(400);
  });
});
