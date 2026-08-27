import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPaidOrder, loadShopifyAdminConfig } from "./admin";
import type { Cart } from "../ucp/types";
import type { OccAddress } from "../cashfree/occ";

const CONFIG = {
  shopDomain: "ecom360-cf.myshopify.com",
  accessToken: "shpat_TEST",
  apiVersion: "2026-07",
  sendReceipt: false,
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
      lineSubtotal: { amountMinor: 360000, currency: "INR" },
      lineTotal: { amountMinor: 360000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 360000, currency: "INR" },
  total: { amountMinor: 360000, currency: "INR" },
};

const ADDRESS: OccAddress = {
  id: "addr_1",
  customer_name: "Kishan Maurya",
  address_line_one: "12 MG Road",
  address_line_two: "Indiranagar",
  city: "Bengaluru",
  country: "India",
  country_code: "IN",
  zip_code: "560038",
  state: "Karnataka",
  state_code: "KA",
  // As OCC really returns it — country code, space, ten digits. See
  // formatCustomerPhone, and order #1617's address.
  phone: "+91 8433719326",
  email: "buyer@example.com",
};

const INPUT = {
  cart: CART,
  address: ADDRESS,
  phone: "8433719326",
  cashfreeOrderId: "cf_order_123",
  testPayment: false,
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** The shape a successful orderCreate comes back in. */
function placed() {
  return ok({
    data: {
      orderCreate: {
        userErrors: [],
        order: {
          id: "gid://shopify/Order/55",
          name: "#1042",
          statusPageUrl: "https://ecom360-cf.myshopify.com/thank_you/55",
        },
      },
    },
  });
}

/**
 * The orderCreate call specifically. A shipping-flag lookup goes out first
 * now, so calls[0] is no longer the mutation under test.
 */
function lastCall() {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const [url, init] =
    calls.find(([, i]) => String(i.body).includes("orderCreate")) ?? calls[0];
  return { url, init, body: JSON.parse(init.body) };
}

describe("createPaidOrder", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the store's Admin GraphQL endpoint with the access token", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, INPUT);

    const { url, init } = lastCall();
    expect(url).toBe(
      "https://ecom360-cf.myshopify.com/admin/api/2026-07/graphql.json",
    );
    // The token is the entire authentication. There is no signature and no
    // second factor, which is also why it never leaves the server.
    expect(init.headers["X-Shopify-Access-Token"]).toBe("shpat_TEST");
  });

  it("marks the order paid and attaches the Cashfree settlement as a SALE", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, INPUT);

    const { order } = lastCall().body.variables;
    expect(order.financialStatus).toBe("PAID");
    // Shopify has no record of the money; Cashfree took it. The transaction
    // exists so the order reconciles rather than showing as an unpaid order
    // someone marked paid by hand.
    expect(order.transactions).toEqual([
      {
        kind: "SALE",
        status: "SUCCESS",
        gateway: "Cashfree",
        test: false,
        amountSet: { shopMoney: { amount: "3600.00", currencyCode: "INR" } },
      },
    ]);
  });

  /**
   * A Cashfree sandbox payment is not money.
   *
   * Shopify has no sandbox — a development store is real data — and the
   * transaction input defaults `test` to false, so leaving it out records a
   * fake payment as a genuine sale and quietly corrupts the store's own
   * reporting. Shopify's guidance is explicit: "If you're using the Admin API
   * to test orders, then you need to set the test property or field to true."
   */
  it("marks the transaction as a test when the payment was one", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, { ...INPUT, testPayment: true });

    expect(lastCall().body.variables.order.transactions[0].test).toBe(true);
  });

  it("sends each cart line as a variant, quantity and unit price", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, INPUT);

    // priceSet is sent, not left to Shopify: the buyer was quoted and charged
    // the cart's price, and a variant repriced between the cart and the
    // payment would otherwise place an order for a different amount than the
    // one Cashfree captured.
    expect(lastCall().body.variables.order.lineItems).toEqual([
      {
        variantId: "gid://shopify/ProductVariant/1",
        quantity: 3,
        requiresShipping: true,
        priceSet: { shopMoney: { amount: "1200.00", currencyCode: "INR" } },
      },
    ]);
  });

  /**
   * Shopify defaults OrderCreateLineItemInput.requiresShipping to false and
   * does not take it from the variant.
   *
   * Measured on order #1617: variant.inventoryItem.requiresShipping was true,
   * the line item's came back false, and the admin showed "Shipping not
   * required" on an order that had just collected a shipping address.
   */
  describe("shipping requirement", () => {
    function flags(entries: Record<string, boolean>) {
      return ok({
        data: {
          nodes: Object.entries(entries).map(([id, requiresShipping]) => ({
            id,
            inventoryItem: { requiresShipping },
          })),
        },
      });
    }

    it("takes the flag from the variant, in one batched lookup", async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(
          flags({ "gid://shopify/ProductVariant/1": true }),
        )
        .mockResolvedValueOnce(placed());

      await createPaidOrder(CONFIG, INPUT);

      const lookup = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(lookup.variables.ids).toEqual([
        "gid://shopify/ProductVariant/1",
      ]);
      expect(
        lastCall().body.variables.order.lineItems[0].requiresShipping,
      ).toBe(true);
      // One lookup, then the mutation. Never one call per line.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("respects a variant that does not ship, such as a gift card", async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce(
          flags({ "gid://shopify/ProductVariant/1": false }),
        )
        .mockResolvedValueOnce(placed());

      await createPaidOrder(CONFIG, INPUT);

      expect(
        lastCall().body.variables.order.lineItems[0].requiresShipping,
      ).toBe(false);
    });

    /**
     * The money is already taken, so a lookup failure must not cost the order.
     * True is the safer of the two wrong answers: a gift card marked shippable
     * is something a merchant notices, while a snowboard marked otherwise
     * quietly loses its address and never gets sent.
     */
    it("assumes shipping is needed when the lookup fails", async () => {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce(placed());

      await createPaidOrder(CONFIG, INPUT);

      expect(
        lastCall().body.variables.order.lineItems[0].requiresShipping,
      ).toBe(true);
    });
  });

  it("maps the chosen OCC address onto shipping and billing", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, INPUT);

    const { order } = lastCall().body.variables;
    expect(order.shippingAddress).toEqual({
      firstName: "Kishan",
      lastName: "Maurya",
      address1: "12 MG Road",
      address2: "Indiranagar",
      city: "Bengaluru",
      provinceCode: "KA",
      countryCode: "IN",
      zip: "560038",
      phone: "+91 8433719326",
    });
    // Cashfree collects one address. Sending it as both is honest about that;
    // omitting billing leaves the order looking half-filled in the admin.
    expect(order.billingAddress).toEqual(order.shippingAddress);
    expect(order.email).toBe("buyer@example.com");
  });

  it("carries the Cashfree order id so the two systems can be reconciled", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, INPUT);

    const { order } = lastCall().body.variables;
    expect(order.tags).toContain("CASHFREE_PG");
    expect(order.note).toContain("cf_order_123");
  });

  /**
   * No customer block at all.
   *
   * Shopify builds the customer from the email and shipping address by itself
   * — order #1617 had no such block and still produced a named customer.
   * Supplying one cost two paid-for orders: a phone that was unique to another
   * record, then a blank surname. Nothing optional may be able to fail the
   * mutation that records the money.
   */
  it("leaves the customer to Shopify", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, INPUT);

    const { order } = lastCall().body.variables;
    expect(order.customer).toBeUndefined();
    // The identity Shopify needs is already on the order.
    expect(order.email).toBe("buyer@example.com");
    expect(order.phone).toBe("8433719326");
    expect(order.shippingAddress.phone).toBe("+91 8433719326");
  });

  /**
   * Off unless asked for. The buyer has already had a confirmation from
   * Cashfree, and a second one for the same purchase reads as a double charge
   * — but a live Shopify receipt is worth showing deliberately.
   */
  it("suppresses the Shopify receipt by default", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder(CONFIG, INPUT);

    expect(lastCall().body.variables.options).toEqual({ sendReceipt: false });
  });

  it("sends it when the deployment asks for one", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await createPaidOrder({ ...CONFIG, sendReceipt: true }, INPUT);

    expect(lastCall().body.variables.options).toEqual({ sendReceipt: true });
  });

  it("returns the placed order", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(placed());

    await expect(createPaidOrder(CONFIG, INPUT)).resolves.toEqual({
      id: "gid://shopify/Order/55",
      name: "#1042",
      statusPageUrl: "https://ecom360-cf.myshopify.com/thank_you/55",
    });
  });

  // userErrors sit beside a 200 and an empty `order`. Reading only the HTTP
  // status would report a placed order that does not exist.
  it("throws the userErrors message", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({
        data: {
          orderCreate: {
            order: null,
            userErrors: [
              { field: ["order", "lineItems"], message: "Variant not found" },
            ],
          },
        },
      }),
    );

    await expect(createPaidOrder(CONFIG, INPUT)).rejects.toThrow(
      "Variant not found",
    );
  });

  // A scope or version failure comes back as a top-level `errors` array with
  // no `data.orderCreate` at all, so the userErrors path never sees it.
  it("throws top-level GraphQL errors", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ errors: [{ message: "Access denied for orderCreate field" }] }),
    );

    await expect(createPaidOrder(CONFIG, INPUT)).rejects.toThrow(
      "Access denied for orderCreate field",
    );
  });

  it("throws on a non-200", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: "[API] Invalid API key or access token" }),
    } as Response);

    await expect(createPaidOrder(CONFIG, INPUT)).rejects.toThrow(/401/);
  });
});

describe("loadShopifyAdminConfig", () => {
  // Absent rather than fatal. The demo's whole flow — catalog, cart, OTP,
  // address, payment — works without an Admin token; only the order sync
  // needs one. Throwing here would take the store down to add a feature that
  // runs after the money has already moved.
  it("returns null when no token is configured", () => {
    expect(
      loadShopifyAdminConfig({ SHOP_DOMAIN: "ecom360-cf.myshopify.com" }),
    ).toBeNull();
  });

  it("reads the token and defaults the API version", () => {
    expect(
      loadShopifyAdminConfig({
        SHOP_DOMAIN: "ecom360-cf.myshopify.com",
        SHOPIFY_ADMIN_TOKEN: "shpat_TEST",
      }),
    ).toEqual({
      shopDomain: "ecom360-cf.myshopify.com",
      accessToken: "shpat_TEST",
      // orderCreate is only served from 2026-07 onwards.
      apiVersion: "2026-07",
      // Off unless explicitly switched on — a second receipt for one purchase
      // reads as a double charge.
      sendReceipt: false,
    });
  });
});

describe("loadShopifyAdminConfig — receipt", () => {
  const BASE = {
    SHOP_DOMAIN: "ecom360-cf.myshopify.com",
    SHOPIFY_ADMIN_TOKEN: "shpat_TEST",
  };

  it("sends the receipt only for an exact opt-in", () => {
    // Anything other than "true" is off. A half-set variable must not start
    // emailing a merchant's customers.
    expect(loadShopifyAdminConfig(BASE)?.sendReceipt).toBe(false);
    expect(
      loadShopifyAdminConfig({ ...BASE, SHOPIFY_SEND_RECEIPT: "" })?.sendReceipt,
    ).toBe(false);
    expect(
      loadShopifyAdminConfig({ ...BASE, SHOPIFY_SEND_RECEIPT: "yes" })
        ?.sendReceipt,
    ).toBe(false);
    expect(
      loadShopifyAdminConfig({ ...BASE, SHOPIFY_SEND_RECEIPT: "true" })
        ?.sendReceipt,
    ).toBe(true);
  });
});
