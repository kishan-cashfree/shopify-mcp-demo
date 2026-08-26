import type { UcpClient } from "./client";
import { normaliseCart, normaliseProducts } from "./normalise";
import type { Cart, CartRequest, Product } from "./types";

/**
 * How many products one search returns. The grid pages through them locally,
 * six at a time, so this is the whole catalog the buyer can reach.
 *
 * Fetched in one call rather than by following the cursor: measured against
 * belvish.myshopify.com on 2026-08-26, limit 100 returns 100 products in a
 * single response, so walking pages would only add upstream calls. This repo
 * has already taken a Shopify 429 from catalog volume, which is why one call
 * matters.
 *
 * 100 normalises to about 112 KB in the tool result's _meta — 1.1 KB a
 * product, measured across 50 and 100. That payload crosses the host on every
 * search, and no ceiling has been measured, so raising this further is a
 * payload question before it is a Shopify one. has_next_page is still true at
 * 100: the store has more than this, and nothing follows the cursor.
 *
 * The value had no effect at all until 2026-08-26: pagination was passed as a
 * sibling of catalog while Shopify's schema declares it inside, so the key was
 * dropped silently and every search came back at the schema default of 10.
 * Asking for 50 returned 10 as well, which is what gave it away.
 */
const SEARCH_LIMIT = 100;

export interface LoadedCart {
  cart: Cart;
  /** variantId → product handle */
  handles: Record<string, string>;
  /** variantId → pre-discount unit price, minor units */
  listPrices: Record<string, number>;
}

export interface ShopService {
  searchProducts(query: string): Promise<Product[]>;
  saveCart(request: CartRequest): Promise<Cart>;
  loadCartForOrder(cartId: string): Promise<LoadedCart>;
}

/** lookup_catalog accepts at most 10 identifiers per call. */
const LOOKUP_LIMIT = 10;

export function createShopService(client: UcpClient): ShopService {
  async function searchProducts(query: string): Promise<Product[]> {
    const raw = await client.call("search_catalog", {
      catalog: { query, pagination: { limit: SEARCH_LIMIT } },
    });
    return normaliseProducts(raw);
  }

  async function saveCart(request: CartRequest): Promise<Cart> {
    // update_cart replaces the entire line set, so removal is expressed by
    // omission. Filtering here keeps that rule in one place.
    const lineItems = request.lines
      .filter((line) => line.quantity > 0)
      .map((line) => ({
        item: { id: line.variantId },
        quantity: line.quantity,
      }));

    const raw = request.cartId
      ? await client.call("update_cart", {
          id: request.cartId,
          cart: { line_items: lineItems },
        })
      : await client.call("create_cart", {
          cart: { line_items: lineItems },
        });

    return normaliseCart(raw);
  }

  /**
   * The cart Cashfree's order needs, plus the two catalog fields the cart
   * response does not carry: the product handle (for a product link) and the
   * pre-discount price (for strike-through pricing).
   */
  async function loadCartForOrder(cartId: string): Promise<LoadedCart> {
    const cart = normaliseCart(await client.call("get_cart", { id: cartId }));

    const ids = cart.lines.map((line) => line.variantId).slice(0, LOOKUP_LIMIT);
    const handles: Record<string, string> = {};
    const listPrices: Record<string, number> = {};

    if (ids.length > 0) {
      try {
        const looked = await client.call("lookup_catalog", {
          catalog: { ids },
        });
        for (const product of normaliseProducts(looked)) {
          for (const variant of product.variants) {
            if (product.handle) handles[variant.id] = product.handle;
            listPrices[variant.id] = variant.listPrice.amountMinor;
          }
        }
      } catch {
        // Both fields are cosmetic in Cashfree's order summary. Losing them
        // should not block a checkout that is otherwise fine.
      }
    }

    return { cart, handles, listPrices };
  }

  return { searchProducts, saveCart, loadCartForOrder };
}
