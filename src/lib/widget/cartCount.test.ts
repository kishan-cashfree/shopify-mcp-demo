import { describe, it, expect } from "vitest";
import { cartItemCount } from "./cartCount";
import type { Cart } from "../ucp/types";

const money = { amountMinor: 0, currency: "INR" };

function cartWith(quantities: number[]): Cart {
  return {
    cartId: "gid://shopify/Cart/abc",
    currency: "INR",
    continueUrl: "https://store.test/cart/c/abc",
    lines: quantities.map((quantity, i) => ({
      lineId: `l${i}`,
      variantId: `v${i}`,
      title: `Item ${i}`,
      quantity,
      unitPrice: money,
      lineSubtotal: money,
      lineTotal: money,
    })),
    subtotal: money,
    total: money,
  };
}

describe("cartItemCount", () => {
  it("sums the quantities, not the lines", () => {
    // Two lines of three is six items. Counting lines would put "2 items"
    // under a cart holding six.
    expect(cartItemCount(cartWith([3, 3]))).toBe(6);
  });

  it("is zero for an empty cart", () => {
    expect(cartItemCount(cartWith([]))).toBe(0);
  });

  it("is zero before a cart exists", () => {
    // The grid renders before the first add, and useCart hands back null
    // until then.
    expect(cartItemCount(null)).toBe(0);
    expect(cartItemCount(undefined)).toBe(0);
  });
});
