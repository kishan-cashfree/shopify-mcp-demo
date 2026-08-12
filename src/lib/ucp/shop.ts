import type { UcpClient } from "./client";
import { normaliseCart, normaliseProducts } from "./normalise";
import type { Cart, CartRequest, Product } from "./types";

/** First-page size. Pagination is out of scope for this milestone. */
const SEARCH_LIMIT = 12;

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
      catalog: { query },
      pagination: { limit: SEARCH_LIMIT },
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
