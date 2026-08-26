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
      lineSubtotal: { amountMinor: 360000, currency: "INR" },
      lineTotal: { amountMinor: 360000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 360000, currency: "INR" },
  total: { amountMinor: 360000, currency: "INR" },
};

const HANDLES = { "gid://shopify/ProductVariant/1": "short-sleeve-t-shirt" };
const LIST = { "gid://shopify/ProductVariant/1": 150000 };

const ORDER_INPUT = {
  cart: CART,
  phone: "8433719326",
  shopDomain: "shop.myshopify.com",
  handles: HANDLES,
  listPrices: LIST,
  returnUrl: "https://srv.test/thanks?order_id={order_id}",
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const CREATED = {
  order_id: "o1",
  payment_session_id: "session_x",
  order_amount: 3600,
};

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

  it("defaults to sandbox when the environment is unset", () => {
    // Defaulting to production would let a missing env var take real money.
    const c = loadCashfreeConfig({
      CASHFREE_CLIENT_ID: "a",
      CASHFREE_CLIENT_SECRET: "b",
    } as NodeJS.ProcessEnv);
    expect(c.environment).toBe("sandbox");
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

  it("never claims a list price below what the cart charges", () => {
    // Measured on belvish.myshopify.com, 2026-08-26. Variant
    // gid://shopify/ProductVariant/50459424915760 sells at 6,850 while
    // lookup_catalog reports list_price 2,375 — a compare-at price below the
    // selling price. Alongside a normal line (4,450 / list 5,900) that put
    // sum(original) at 8,275 against sum(discounted) 11,300, so Cashfree's
    // Cart Discount came out at -3,025 and the hosted page rendered its own
    // minus in front of ours: "- -3,025".
    //
    // The widget already refuses a strike-through when list <= price
    // (Results.tsx discountPercent, ProductDetail's price row); the Cashfree
    // payload was the one path without that check. Nothing here fabricates a
    // discount, it only declines to report a negative one.
    const [item] = toCartItems(CART, "shop.myshopify.com", HANDLES, {
      "gid://shopify/ProductVariant/1": 90000,
    });

    expect(item.item_original_unit_price).toBe(1200);
    expect(item.item_discounted_unit_price).toBe(1200);
  });

  it("builds the product url from the shop domain and handle", () => {
    const [item] = toCartItems(CART, "shop.myshopify.com", HANDLES, LIST);
    expect(item.item_details_url).toBe(
      "https://shop.myshopify.com/products/short-sleeve-t-shirt",
    );
  });

  it("omits the product url when the handle is unknown", () => {
    // A link to a page that does not exist is worse than no link.
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
      lines: [
        { ...CART.lines[0], unitPrice: { amountMinor: 5000, currency: "JPY" } },
      ],
      total: { amountMinor: 5000, currency: "JPY" },
    };
    const [item] = toCartItems(jpy, "shop.myshopify.com", HANDLES, {});
    expect(item.item_discounted_unit_price).toBe(5000);
  });
});

describe("createOrder", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /pg/orders with credential headers", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CREATED) as never);

    await createOrder(CONFIG, ORDER_INPUT);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders");
    const h = init?.headers as Record<string, string>;
    expect(h["x-client-id"]).toBe("TESTid");
    expect(h["x-client-secret"]).toBe("TESTsecret");
    expect(h["x-api-version"]).toBe("2023-08-01");
  });

  it("prices the order from the cart total in major units", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CREATED) as never);

    await createOrder(CONFIG, ORDER_INPUT);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.order_amount).toBe(3600);
    expect(body.order_currency).toBe("INR");
    expect(body.customer_details.customer_phone).toBe("8433719326");
  });

  it("does not enable one_click_checkout on the order", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CREATED) as never);

    await createOrder(CONFIG, ORDER_INPUT);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    // The widget already does OTP login and address selection. Enabling OCC
    // makes the hosted page offer to do both again, so the buyer logs in
    // twice. The OCC endpoints themselves do not need the flags — measured.
    expect(body.products).toBeUndefined();
  });

  it("sends the cart items", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CREATED) as never);

    await createOrder(CONFIG, ORDER_INPUT);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.cart_details.cart_items).toHaveLength(1);
    expect(body.cart_details.cart_items[0].item_quantity).toBe(3);
  });

  it("returns the order id and payment session id", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CREATED) as never);

    const result = await createOrder(CONFIG, ORDER_INPUT);

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
      json: async () => ({
        message: "order_amount is invalid",
        code: "order_amount_invalid",
      }),
    } as never);

    await expect(createOrder(CONFIG, ORDER_INPUT)).rejects.toThrow(
      "order_amount is invalid",
    );
  });

  it("still throws usefully when the error body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    } as never);

    await expect(createOrder(CONFIG, ORDER_INPUT)).rejects.toThrow(/502/);
  });
});

describe("getOrderStatus", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the order and returns its status", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ order_id: "o1", order_status: "PAID" }) as never,
    );

    const result = await getOrderStatus(CONFIG, "o1");

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://sandbox.cashfree.com/pg/orders/o1",
    );
    expect(result).toEqual({ orderId: "o1", orderStatus: "PAID" });
  });

  it("url-encodes the order id", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ order_id: "a/b", order_status: "ACTIVE" }) as never,
    );

    await getOrderStatus(CONFIG, "a/b");

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://sandbox.cashfree.com/pg/orders/a%2Fb",
    );
  });
});

describe("getOrderRaw", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("passes Cashfree's body through untouched", async () => {
    const raw = {
      order_id: "o1",
      order_status: "PAID",
      order_amount: 1200,
      payments: { url: "https://x" },
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => raw,
    } as never);

    const { getOrderRaw } = await import("./orders");
    const result = await getOrderRaw(CONFIG, "o1");

    // cashfree-here's recon parses the raw Cashfree shape; normalising here
    // leaves it unable to reach a terminal state.
    expect(result.body).toEqual(raw);
    expect(result.status).toBe(200);
  });

  it("preserves a non-200 status for the caller to forward", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "order not found" }),
    } as never);

    const { getOrderRaw } = await import("./orders");

    expect((await getOrderRaw(CONFIG, "nope")).status).toBe(404);
  });
});
