import type { UcpClient } from "./client";
import { normaliseCart, normaliseProducts } from "./normalise";
import type { Cart, CartRequest, Product } from "./types";

/** First-page size. Pagination is out of scope for this milestone. */
const SEARCH_LIMIT = 12;

export interface ShopService {
  searchProducts(query: string): Promise<Product[]>;
  saveCart(request: CartRequest): Promise<Cart>;
}

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

  return { searchProducts, saveCart };
}
