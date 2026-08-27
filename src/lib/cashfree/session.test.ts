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
    // Creating one here would let a forged session id seed the store.
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

  it("preserves the auth token when the session is re-read", () => {
    const store = createSessionStore();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "1" });
    store.setAuth("s1", "tok1");

    expect(store.get("s1")?.authToken).toBe("tok1");
    expect(store.get("s1")?.orderId).toBe("o1");
  });
});

describe("dispatch recording", () => {
  it("records which payment tool actually ran", () => {
    const store = createSessionStore();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "1" });

    store.markDispatched("s1", "UpiTool");

    expect(store.get("s1")?.dispatchedTool).toBe("UpiTool");
  });

  it("keeps the rest of the session intact", () => {
    const store = createSessionStore();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "1" });
    store.setAuth("s1", "tok");

    store.markDispatched("s1", "UpiTool");

    expect(store.get("s1")?.authToken).toBe("tok");
    expect(store.get("s1")?.orderId).toBe("o1");
  });

  it("records a dispatch for a session this process never created", () => {
    // Survives a restart mid-checkout. Nothing security-relevant rests on
    // this value, so recording beats throwing.
    const store = createSessionStore();

    store.markDispatched("s-unknown", "UpiTool");

    expect(store.get("s-unknown")?.dispatchedTool).toBe("UpiTool");
  });

  it("reports no dispatch before one happens", () => {
    const store = createSessionStore();
    store.put({ paymentSessionId: "s1", orderId: "o1", phone: "1" });

    expect(store.get("s1")?.dispatchedTool).toBeUndefined();
  });
});

/**
 * What a resumed checkout needs the session to have kept: the widget that knew
 * any of it has moved on by the time the retry arrives.
 */
describe("checkout session state", () => {
  // The cart id is what lets the server re-price a resumed order from Shopify.
  it("keeps the cart id the order was created from", () => {
    const store = createSessionStore();
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "1",
      cartId: "gid://shopify/Cart/abc",
    });

    expect(store.get("s1")?.cartId).toBe("gid://shopify/Cart/abc");
  });
});

/**
 * What a retry after a failed OTP send needs in order to reuse the order
 * rather than create another.
 *
 * Measured 2026-08-27: three consecutive `POST /api/pay/otp` 502s
 * ("Couldn't send the OTP") left three paid-for-nothing orders behind, because
 * the order is created before the OTP is sent and the buyer retried from the
 * phone screen each time. The order was never the thing that failed.
 */
describe("order reuse state", () => {
  it("keeps the amount the order was created for", () => {
    const store = createSessionStore();
    store.put({
      paymentSessionId: "s1",
      orderId: "o1",
      phone: "8433719326",
      cartId: "gid://shopify/Cart/abc",
      // Minor units, compared as integers. Reusing an order whose amount no
      // longer matches the cart would charge the buyer the old total.
      orderAmountMinor: 360000,
    });

    expect(store.get("s1")?.orderAmountMinor).toBe(360000);
  });
});
