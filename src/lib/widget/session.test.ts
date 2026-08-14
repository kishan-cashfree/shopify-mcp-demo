import { describe, it, expect } from "vitest";
import { applySearchResult } from "./session";
import type { WidgetState } from "../../types";

const BROWSING: WidgetState = {
  screen: "results",
  quantities: {},
  lastSearchId: "s1",
};

const PAID: WidgetState = {
  screen: "checkout",
  cartId: "gid://shopify/Cart/abc",
  quantities: { v1: 1 },
  lastSearchId: "s1",
  checkout: {
    step: "paying",
    orderId: "order_4303293",
    paymentSessionId: "sess_1",
    phone: "8433719326",
  },
};

describe("applySearchResult", () => {
  it("returns the buyer to the results grid on a search they have not seen", () => {
    // The whole bug: the host re-hydrated screen "checkout" into the widget
    // rendering a brand new SearchProducts result, so a request to browse
    // answered with the payment receipt.
    expect(applySearchResult(PAID, "s2").screen).toBe("results");
  });

  it("leaves state untouched when the same result re-renders", () => {
    // Widgets repaint far more often than they receive tool results. Resetting
    // on every repaint would yank a buyer out of checkout mid-flow.
    const midCheckout: WidgetState = { ...PAID, checkout: { step: "otp" } };

    expect(applySearchResult(midCheckout, "s1")).toBe(midCheckout);
  });

  it("leaves state untouched when the result carries no search id", () => {
    // An older server, or a host that drops _meta. Without an id there is no
    // way to distinguish a new search from a repaint, so do nothing.
    expect(applySearchResult(PAID, undefined)).toBe(PAID);
  });

  it("starts an empty cart once payment has been dispatched", () => {
    // That cart has been paid for. Adding to it would send update_cart at a
    // cart Shopify has already completed.
    const next = applySearchResult(PAID, "s2");

    expect(next.cartId).toBeUndefined();
    expect(next.quantities).toEqual({});
    expect(next.checkout).toBeUndefined();
  });

  it("keeps a cart the buyer has not paid for yet", () => {
    // Browsing for more items mid-shop is normal and must not empty the cart.
    const shopping: WidgetState = {
      screen: "cart",
      cartId: "gid://shopify/Cart/abc",
      quantities: { v1: 2 },
      lastSearchId: "s1",
    };

    const next = applySearchResult(shopping, "s2");

    expect(next.cartId).toBe("gid://shopify/Cart/abc");
    expect(next.quantities).toEqual({ v1: 2 });
  });

  it("keeps an unfinished checkout, so the buyer can resume it", () => {
    // Reaching the address step costs an OTP round trip. Browsing should not
    // throw that away — only the screen changes.
    const midCheckout: WidgetState = {
      ...PAID,
      checkout: { step: "address", paymentSessionId: "sess_1" },
    };

    const next = applySearchResult(midCheckout, "s2");

    expect(next.checkout).toEqual({ step: "address", paymentSessionId: "sess_1" });
    expect(next.screen).toBe("results");
  });

  it("records the search id, so the next repaint is not treated as new", () => {
    const next = applySearchResult(BROWSING, "s2");

    expect(next.lastSearchId).toBe("s2");
    expect(applySearchResult(next, "s2")).toBe(next);
  });
});
