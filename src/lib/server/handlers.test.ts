import { describe, it, expect, vi } from "vitest";
import { handleSearchProducts, handleCartRequest } from "./handlers";
import { UcpError } from "../ucp/client";
import type { ShopService } from "../ucp/shop";
import type { Cart, Product } from "../ucp/types";

const PRODUCT: Product = {
  id: "gid://shopify/Product/1",
  title: "short sleeve t-shirt",
  handle: "short-sleeve-t-shirt",
  imageUrl: "https://cdn.test/a.jpg",
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "Red",
      price: { amountMinor: 120000, currency: "INR" },
      listPrice: { amountMinor: 120000, currency: "INR" },
      available: true,
    },
  ],
};

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  lines: [],
  subtotal: { amountMinor: 0, currency: "INR" },
  total: { amountMinor: 0, currency: "INR" },
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
  it("sends a short summary to the model, not the catalog", async () => {
    const result = await handleSearchProducts(fakeShop(), "shirt");

    const text = result.content[0].text;
    expect(text).toContain("1");
    expect(text).toContain("shirt");
    // The model must not receive prices — it will paraphrase them from memory.
    expect(text).not.toContain("120000");
    expect(text).not.toContain("1,200");
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
