import { describe, it, expect, vi } from "vitest";
import { syncShopifyOrder } from "./orderSync";
import { createSessionStore } from "../cashfree/session";
import type { Cart } from "../ucp/types";
import type { OccAddress } from "../cashfree/occ";

const ADMIN = {
  shopDomain: "ecom360-cf.myshopify.com",
  accessToken: "shpat_TEST",
  apiVersion: "2026-07",
};

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "l1",
      variantId: "gid://shopify/ProductVariant/1",
      title: "t-shirt",
      quantity: 1,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineSubtotal: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 120000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 120000, currency: "INR" },
  total: { amountMinor: 120000, currency: "INR" },
};

const ADDRESS = { id: "addr_1", customer_name: "Kishan Maurya" } as OccAddress;
const PLACED = { id: "gid://shopify/Order/55", name: "#1042" };

/** A store holding one paid-for session, ready to sync. */
function ready() {
  const store = createSessionStore();
  store.put({
    paymentSessionId: "s1",
    orderId: "cf_order_123",
    phone: "8433719326",
    cartId: "gid://shopify/Cart/abc",
  });
  store.setAddress("s1", ADDRESS);
  return store;
}

function deps(overrides: Partial<Parameters<typeof syncShopifyOrder>[0]> = {}) {
  return {
    admin: ADMIN,
    store: ready(),
    loadCart: vi.fn().mockResolvedValue({
      cart: CART,
      handles: {},
      listPrices: {},
    }),
    createPaidOrder: vi.fn().mockResolvedValue(PLACED),
    ...overrides,
  };
}

describe("syncShopifyOrder", () => {
  it("places the order once the Cashfree order is PAID", async () => {
    const d = deps();

    const outcome = await syncShopifyOrder(d, "cf_order_123", "PAID");

    expect(outcome).toEqual({ status: "placed", order: PLACED });
    // Priced from Shopify at sync time, not from anything the poll carried.
    expect(d.loadCart).toHaveBeenCalledWith("gid://shopify/Cart/abc");
    expect(d.createPaidOrder).toHaveBeenCalledWith(ADMIN, {
      cart: CART,
      address: ADDRESS,
      phone: "8433719326",
      cashfreeOrderId: "cf_order_123",
    });
    expect(d.store.getByOrderId("cf_order_123")?.shopifyOrder).toEqual(PLACED);
  });

  /**
   * The poll fires every couple of seconds for as long as the screen is open
   * and does not stop at the first success. A second call must return the
   * order that already exists rather than place a second one — this is the
   * defect the whole idempotency record exists to prevent.
   */
  it("never places a second order for the same Cashfree order", async () => {
    const d = deps();

    await syncShopifyOrder(d, "cf_order_123", "PAID");
    const again = await syncShopifyOrder(d, "cf_order_123", "PAID");

    expect(again).toEqual({ status: "placed", order: PLACED });
    expect(d.createPaidOrder).toHaveBeenCalledTimes(1);
  });

  // The widget saying it paid is the widget's opinion. Only Cashfree's own
  // status is allowed to move money into an order.
  it("does nothing until Cashfree reports PAID", async () => {
    const d = deps();

    const outcome = await syncShopifyOrder(d, "cf_order_123", "ACTIVE");

    expect(outcome).toEqual({ status: "skipped", reason: "not-paid" });
    expect(d.createPaidOrder).not.toHaveBeenCalled();
  });

  it("stays off entirely when no Admin token is configured", async () => {
    const d = deps({ admin: null });

    const outcome = await syncShopifyOrder(d, "cf_order_123", "PAID");

    expect(outcome).toEqual({ status: "skipped", reason: "no-admin-token" });
    expect(d.createPaidOrder).not.toHaveBeenCalled();
  });

  // Sessions are in-memory, so a restart mid-payment loses the cart and the
  // address. Skipping is the honest outcome; inventing a line item is not.
  it("skips a Cashfree order this process has no session for", async () => {
    const d = deps();

    const outcome = await syncShopifyOrder(d, "unknown_order", "PAID");

    expect(outcome).toEqual({ status: "skipped", reason: "no-session" });
    expect(d.createPaidOrder).not.toHaveBeenCalled();
  });

  it("skips when the buyer never picked an address", async () => {
    const store = createSessionStore();
    store.put({
      paymentSessionId: "s1",
      orderId: "cf_order_123",
      phone: "1",
      cartId: "gid://shopify/Cart/abc",
    });
    const d = deps({ store });

    const outcome = await syncShopifyOrder(d, "cf_order_123", "PAID");

    expect(outcome).toEqual({ status: "skipped", reason: "no-address" });
  });

  /**
   * A failure must not be recorded as a success: the poll is still running,
   * and leaving the session unmarked is what lets the next tick retry. The
   * money is already taken, so giving up on the first 502 would strand a paid
   * order with nothing on Shopify.
   */
  it("reports a failure and leaves the session open to retry", async () => {
    const d = deps({
      createPaidOrder: vi.fn().mockRejectedValue(new Error("Variant not found")),
    });

    const outcome = await syncShopifyOrder(d, "cf_order_123", "PAID");

    expect(outcome).toEqual({ status: "failed", error: "Variant not found" });
    expect(d.store.getByOrderId("cf_order_123")?.shopifyOrder).toBeUndefined();
  });
});
