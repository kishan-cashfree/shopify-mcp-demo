import { describe, it, expect, vi } from "vitest";
import {
  handleSearchProducts,
  handleCartRequest,
  storeDisplayName,
} from "./handlers";
import { UcpError } from "../ucp/client";
import type { ShopService } from "../ucp/shop";
import type { Cart, Product } from "../ucp/types";

const PRODUCT: Product = {
  id: "gid://shopify/Product/1",
  title: "short sleeve t-shirt",
  handle: "short-sleeve-t-shirt",
  imageUrl: "https://cdn.test/a.jpg",
  description: "A soft cotton tee.",
  priceRange: {
    min: { amountMinor: 120000, currency: "INR" },
    max: { amountMinor: 120000, currency: "INR" },
  },
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "Red",
      price: { amountMinor: 120000, currency: "INR" },
      listPrice: { amountMinor: 120000, currency: "INR" },
      available: true,
      options: [{ name: "Color", label: "Red" }],
    },
  ],
};

// Carries the line the tests ask to add. It used to be empty, which is the
// shape Shopify returns when it REFUSES a line — so the happy-path test was
// asserting on the failure case without knowing it.
const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  lines: [
    {
      lineId: "l1",
      variantId: "gid://shopify/ProductVariant/1",
      title: "short sleeve t-shirt - Red",
      quantity: 2,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineSubtotal: { amountMinor: 240000, currency: "INR" },
      lineTotal: { amountMinor: 240000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 240000, currency: "INR" },
  total: { amountMinor: 240000, currency: "INR" },
  continueUrl: "https://store.test/cart/c/abc",
};

function fakeShop(overrides: Partial<ShopService> = {}): ShopService {
  return {
    searchProducts: vi.fn().mockResolvedValue([PRODUCT]),
    saveCart: vi.fn().mockResolvedValue(CART),
    loadCartForOrder: vi
      .fn()
      .mockResolvedValue({ cart: CART, handles: {}, listPrices: {} }),
    ...overrides,
  };
}

describe("handleSearchProducts", () => {
  /**
   * The unit boundary, and the only place it exists.
   *
   * The model reads "under 5k" and fills priceMax in the buyer's own units —
   * 5000 rupees. Shopify's filters.price is documented in MINOR units, so
   * passing 5000 straight through caps the search at fifty rupees and returns
   * an all-but-empty grid. That failure looks like an empty store, not like a
   * unit bug, which is why it is pinned here rather than left to a reviewer.
   */
  it("converts the model's major-unit ceiling to the minor units Shopify wants", async () => {
    const shop = fakeShop();

    await handleSearchProducts(shop, "perfume", "", { max: 5000 });

    expect(shop.searchProducts).toHaveBeenCalledWith("perfume", {
      maxMinor: 500000,
    });
  });

  it("passes no range through when the buyer named no price", async () => {
    const shop = fakeShop();

    await handleSearchProducts(shop, "perfume");

    expect(shop.searchProducts).toHaveBeenCalledWith("perfume", undefined);
  });

  it("searches with no keyword when the buyer asked for the whole catalog", async () => {
    const shop = fakeShop();

    await handleSearchProducts(shop, undefined);

    expect(shop.searchProducts).toHaveBeenCalledWith(undefined, undefined);
  });

  /**
   * The summary is model-facing text. Interpolating an absent query straight
   * into it reads back as: Found 1 product for "undefined".
   */
  it("summarises a keywordless search without naming a query", async () => {
    const shop = fakeShop();

    const result = await handleSearchProducts(shop, undefined);

    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("undefined");
    expect(text).not.toContain('""');
    expect(text).toContain("1 product");
  });

  /**
   * Probed against the live server on 2026-09-03, both found by trying the
   * inputs a model would actually produce for "show me everything":
   *
   *   {"query":"   "} -> Found 17 products for "   ".
   *
   * Shopify ignored the whitespace and returned the catalog, so it LOOKED
   * right — but the summary the model reads back names a query of spaces, the
   * echoed _meta.query sends the reload path searching for spaces, and on a
   * store whose search is less forgiving it is an empty grid.
   *
   * Normalised here rather than at either entry point, because both the MCP
   * tool and /api/shop/search reach Shopify through this function, and two
   * copies of one rule is how the CSP blocks drifted apart.
   */
  it("treats a blank or whitespace query as no query at all", async () => {
    for (const blank of ["", "   ", "\t"]) {
      const shop = fakeShop();
      const result = await handleSearchProducts(shop, blank);

      expect(shop.searchProducts).toHaveBeenCalledWith(undefined, undefined);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("in this store");
      expect(text).not.toContain('"');
    }
  });

  it("trims a real keyword rather than searching for the spaces around it", async () => {
    const shop = fakeShop();

    await handleSearchProducts(shop, "  perfume  ");

    expect(shop.searchProducts).toHaveBeenCalledWith("perfume", undefined);
  });

  it("echoes the applied range back, so a reload can reapply it", async () => {
    // Host state outlives the widget and ChatGPT does not re-deliver the tool
    // result, so useProducts re-searches on its own. Without the range in
    // _meta that recovery silently widens the grid back out — the buyer asked
    // for under 5k, reloaded, and got everything.
    const result = await handleSearchProducts(fakeShop(), "perfume", "", {
      max: 5000,
    });

    expect(result._meta.priceMax).toBe(5000);
  });

  it("sends a short summary to the model, not the catalog", async () => {
    const result = await handleSearchProducts(fakeShop(), "shirt");

    const text = result.content[0].text;
    expect(text).toContain("1");
    expect(text).toContain("shirt");
    // The model must not receive prices — it will paraphrase them from memory.
    expect(text).not.toContain("120000");
    expect(text).not.toContain("1,200");
  });

  it("stamps every search with an id the widget has never seen", async () => {
    // The widget resets to the results grid on an unfamiliar search id. If two
    // calls shared one, a buyer searching again after paying would stay parked
    // on the payment receipt — the bug this exists to prevent.
    const first = await handleSearchProducts(fakeShop(), "shirt");
    const second = await handleSearchProducts(fakeShop(), "shirt");

    expect(first._meta.searchId).toBeTruthy();
    expect(second._meta.searchId).not.toBe(first._meta.searchId);
  });

  it("sends the full product array to the widget via _meta", async () => {
    const result = await handleSearchProducts(fakeShop(), "shirt");

    expect(result._meta.products).toEqual([PRODUCT]);
  });

  it("reports an empty result without erroring", async () => {
    const shop = fakeShop({ searchProducts: vi.fn().mockResolvedValue([]) });

    const result = await handleSearchProducts(shop, "unobtainium");

    expect(result.content[0].text).toMatch(/no products/i);
    expect(result._meta.products).toEqual([]);
  });

  it("surfaces Shopify's own message when the store rejects the call", async () => {
    const shop = fakeShop({
      searchProducts: vi
        .fn()
        .mockRejectedValue(new UcpError("Invalid arguments", "search_catalog")),
    });

    const result = await handleSearchProducts(shop, "shirt");

    expect(result.content[0].text).toContain("Invalid arguments");
    expect(result._meta.products).toEqual([]);
  });
});

describe("handleCartRequest", () => {
  it("returns 200 and the normalised cart", async () => {
    const result = await handleCartRequest(fakeShop(), {
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 2 }],
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(CART);
  });

  it("passes cartId through when present", async () => {
    const shop = fakeShop();

    await handleCartRequest(shop, {
      cartId: "gid://shopify/Cart/abc",
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
    });

    expect(shop.saveCart).toHaveBeenCalledWith({
      cartId: "gid://shopify/Cart/abc",
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
    });
  });

  it("rejects a body with no lines array", async () => {
    const result = await handleCartRequest(fakeShop(), { cartId: "x" });

    expect(result.status).toBe(400);
  });

  it("rejects a line with a non-numeric quantity", async () => {
    const result = await handleCartRequest(fakeShop(), {
      lines: [{ variantId: "v1", quantity: "two" }],
    });

    expect(result.status).toBe(400);
  });

  it("returns 502 with Shopify's message when the store rejects the cart", async () => {
    const shop = fakeShop({
      saveCart: vi
        .fn()
        .mockRejectedValue(new UcpError("Variant unavailable", "update_cart")),
    });

    const result = await handleCartRequest(shop, {
      lines: [{ variantId: "v1", quantity: 1 }],
    });

    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "Variant unavailable" });
  });
});

describe("storeDisplayName", () => {
  it("names a myshopify store by its subdomain", () => {
    // The grid credits the store the catalog came from and this is the only
    // name the server has — UCP exposes no storefront metadata call.
    expect(storeDisplayName("belvish.myshopify.com")).toBe("Belvish");
    expect(storeDisplayName("sbox-mukul-store.myshopify.com")).toBe(
      "Sbox-mukul-store",
    );
  });

  it("drops the TLD from a custom domain", () => {
    expect(storeDisplayName("belvish.com")).toBe("Belvish");
    expect(storeDisplayName("https://shop.belvish.co.uk/")).toBe("Belvish");
  });

  it("falls back to the input rather than rendering an empty credit", () => {
    expect(storeDisplayName("")).toBe("");
  });
});

describe("handleCartRequest — silently dropped lines", () => {
  /**
   * Measured live against belvish.myshopify.com on 2026-08-20.
   *
   *   available variant → 200, lines: 1, total 225000
   *   sold-out variant  → 200, lines: 0, total 0, no error field
   *
   * Shopify accepts the request, drops the line and returns a valid empty
   * cart. Nothing distinguishes that from "the buyer's cart is empty", so the
   * widget renders an empty cart and says nothing about why.
   */
  const cartWithLines = (variantIds: string[]): Cart => ({
    cartId: "gid://shopify/Cart/1",
    currency: "INR",
    continueUrl: "https://store.test/c/1",
    lines: variantIds.map((id, i) => ({
      lineId: `l${i}`,
      variantId: id,
      title: `line ${i}`,
      quantity: 1,
      unitPrice: { amountMinor: 100, currency: "INR" },
      lineSubtotal: { amountMinor: 100, currency: "INR" },
      lineTotal: { amountMinor: 100, currency: "INR" },
    })),
    subtotal: { amountMinor: 100, currency: "INR" },
    total: { amountMinor: 100, currency: "INR" },
  });

  const shopReturning = (cart: Cart) =>
    ({ saveCart: vi.fn().mockResolvedValue(cart) }) as unknown as ShopService;

  it("reports a variant Shopify refused to add", async () => {
    const shop = shopReturning(cartWithLines([]));

    const res = await handleCartRequest(shop, {
      lines: [{ variantId: "v-soldout", quantity: 1 }],
    });

    expect(res.status).toBe(200);
    expect((res.body as { unavailableVariantIds?: string[] })
      .unavailableVariantIds).toEqual(["v-soldout"]);
  });

  it("reports only the lines that were dropped, not the ones that landed", async () => {
    const shop = shopReturning(cartWithLines(["v-ok"]));

    const res = await handleCartRequest(shop, {
      lines: [
        { variantId: "v-ok", quantity: 1 },
        { variantId: "v-soldout", quantity: 1 },
      ],
    });

    expect((res.body as { unavailableVariantIds?: string[] })
      .unavailableVariantIds).toEqual(["v-soldout"]);
  });

  it("says nothing when every requested line came back", async () => {
    const shop = shopReturning(cartWithLines(["v-ok"]));

    const res = await handleCartRequest(shop, {
      lines: [{ variantId: "v-ok", quantity: 1 }],
    });

    expect(res.body).not.toHaveProperty("unavailableVariantIds");
  });

  it("does not flag a deliberate removal as a refusal", async () => {
    // update_cart is declarative: quantity 0 IS the remove. Treating the
    // missing line as a refusal would report an error on every removal.
    const shop = shopReturning(cartWithLines([]));

    const res = await handleCartRequest(shop, {
      lines: [{ variantId: "v-ok", quantity: 0 }],
    });

    expect(res.body).not.toHaveProperty("unavailableVariantIds");
  });
});
