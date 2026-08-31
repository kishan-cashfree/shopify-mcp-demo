import { describe, it, expect, vi } from "vitest";
import { createShopService } from "./shop";
import searchFixture from "./__fixtures__/search-catalog.json";
import cartFixture from "./__fixtures__/cart.json";
import type { UcpClient } from "./client";

function fakeClient(payload: unknown): UcpClient & {
  call: ReturnType<typeof vi.fn>;
} {
  return { call: vi.fn().mockResolvedValue(payload) };
}

describe("searchProducts", () => {
  it("nests pagination inside catalog, where the schema puts it", async () => {
    // This assertion used to encode the bug it should have caught. Shopify's
    // search_catalog schema declares pagination under catalog, alongside query
    // and filters; sent at the top level it is dropped without complaint and
    // the schema default of 10 applies instead.
    //
    // Measured against belvish.myshopify.com on 2026-08-26: top-level
    // pagination returned 10 products for limit 12 and for limit 50 alike,
    // while the same query with pagination inside catalog returned 24 for
    // limit 24. The cursor is dead at the top level too — five pages came back
    // with the same first product until the nesting was corrected.
    const client = fakeClient(searchFixture);

    await createShopService(client).searchProducts("shirt");

    expect(client.call).toHaveBeenCalledWith("search_catalog", {
      catalog: { query: "shirt", pagination: { limit: 100 } },
    });
  });

  /**
   * Measured against belvish.myshopify.com on 2026-08-31, which is the whole
   * reason this exists: "perfumes under 5k" sent as one query string returned
   * 20 products of which SIX were above the ceiling — Xerjoff Naxos at
   * Rs 20,900, four times what the buyer asked for. Shopify matches "perfumes"
   * and treats "under 5k" as noise, because a price ceiling in a search string
   * is not a price filter.
   *
   * The same search with filters.price.max returned 20 products and none over
   * the limit. A tighter ceiling of Rs 2,500 returned a different, cheaper set
   * topping out at Rs 2,450 — so this excludes rather than merely re-ranks.
   */
  it("sends a price ceiling as a filter, not as words in the query", async () => {
    const client = fakeClient(searchFixture);

    await createShopService(client).searchProducts("perfume", {
      maxMinor: 500000,
    });

    expect(client.call).toHaveBeenCalledWith("search_catalog", {
      catalog: {
        query: "perfume",
        filters: { price: { max: 500000 } },
        pagination: { limit: 100 },
      },
    });
  });

  it("sends a floor, and both ends together", async () => {
    const client = fakeClient(searchFixture);

    await createShopService(client).searchProducts("perfume", {
      minMinor: 200000,
      maxMinor: 500000,
    });

    expect(client.call).toHaveBeenCalledWith("search_catalog", {
      catalog: {
        query: "perfume",
        filters: { price: { min: 200000, max: 500000 } },
        pagination: { limit: 100 },
      },
    });
  });

  it("omits filters entirely when no range was asked for", async () => {
    // An empty filters object is not the same request: `available` defaults to
    // true inside filters, and sending the key invites a future edit to start
    // populating it. No range means no filters.
    const client = fakeClient(searchFixture);

    await createShopService(client).searchProducts("perfume");

    expect(client.call).toHaveBeenCalledWith("search_catalog", {
      catalog: { query: "perfume", pagination: { limit: 100 } },
    });
  });

  it("returns normalised products", async () => {
    const client = fakeClient(searchFixture);

    const products = await createShopService(client).searchProducts("shirt");

    expect(products[0].variants[0].price.currency).toBe("INR");
  });
});

describe("saveCart", () => {
  it("calls create_cart when no cartId is given", async () => {
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 2 }],
    });

    expect(client.call).toHaveBeenCalledWith("create_cart", {
      cart: {
        line_items: [
          { item: { id: "gid://shopify/ProductVariant/1" }, quantity: 2 },
        ],
      },
    });
  });

  it("calls update_cart with the id when a cartId is given", async () => {
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      cartId: "gid://shopify/Cart/abc",
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 3 }],
    });

    expect(client.call).toHaveBeenCalledWith("update_cart", {
      id: "gid://shopify/Cart/abc",
      cart: {
        line_items: [
          { item: { id: "gid://shopify/ProductVariant/1" }, quantity: 3 },
        ],
      },
    });
  });

  it("sends the complete line set, because update_cart is declarative", async () => {
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      cartId: "gid://shopify/Cart/abc",
      lines: [
        { variantId: "gid://shopify/ProductVariant/1", quantity: 1 },
        { variantId: "gid://shopify/ProductVariant/2", quantity: 5 },
      ],
    });

    const args = client.call.mock.calls[0][1] as {
      cart: { line_items: unknown[] };
    };
    expect(args.cart.line_items).toHaveLength(2);
  });

  it("drops lines whose quantity has reached zero", async () => {
    // Removal is expressed by omitting the line, since the call replaces the
    // whole set. Sending quantity 0 is not a documented removal signal.
    const client = fakeClient(cartFixture);

    await createShopService(client).saveCart({
      cartId: "gid://shopify/Cart/abc",
      lines: [
        { variantId: "gid://shopify/ProductVariant/1", quantity: 0 },
        { variantId: "gid://shopify/ProductVariant/2", quantity: 2 },
      ],
    });

    const args = client.call.mock.calls[0][1] as {
      cart: { line_items: { item: { id: string } }[] };
    };
    expect(args.cart.line_items).toHaveLength(1);
    expect(args.cart.line_items[0].item.id).toBe(
      "gid://shopify/ProductVariant/2",
    );
  });

  it("returns a normalised cart carrying continueUrl", async () => {
    const client = fakeClient(cartFixture);

    const cart = await createShopService(client).saveCart({
      lines: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
    });

    expect(cart.continueUrl).toMatch(/^https:\/\//);
  });
});

describe("loadCartForOrder", () => {
  it("fetches the cart by id and looks up its variants", async () => {
    const client = fakeClient(cartFixture);
    client.call
      .mockResolvedValueOnce(cartFixture)
      .mockResolvedValueOnce(searchFixture);

    await createShopService(client).loadCartForOrder("gid://shopify/Cart/abc");

    expect(client.call).toHaveBeenNthCalledWith(1, "get_cart", {
      id: "gid://shopify/Cart/abc",
    });
    expect(client.call.mock.calls[1][0]).toBe("lookup_catalog");
  });

  it("returns handles and list prices keyed by variant id", async () => {
    const client = fakeClient(cartFixture);
    client.call
      .mockResolvedValueOnce(cartFixture)
      .mockResolvedValueOnce(searchFixture);

    const result = await createShopService(client).loadCartForOrder("c");

    const variantId = result.cart.lines[0].variantId;
    expect(typeof result.listPrices[variantId]).toBe("number");
    expect(typeof result.handles[variantId]).toBe("string");
  });

  it("skips the catalog lookup for an empty cart", async () => {
    const empty = { ...cartFixture, line_items: [] };
    const client = fakeClient(empty);
    client.call.mockResolvedValueOnce(empty);

    const result = await createShopService(client).loadCartForOrder("c");

    expect(client.call).toHaveBeenCalledTimes(1);
    expect(result.handles).toEqual({});
  });

  it("still returns the cart when the catalog lookup fails", async () => {
    // Handles and list prices are cosmetic in Cashfree's summary. Losing them
    // must not block a checkout that is otherwise fine.
    const client = fakeClient(cartFixture);
    client.call
      .mockResolvedValueOnce(cartFixture)
      .mockRejectedValueOnce(new Error("lookup unavailable"));

    const result = await createShopService(client).loadCartForOrder("c");

    expect(result.cart.lines.length).toBeGreaterThan(0);
    expect(result.handles).toEqual({});
  });
});
