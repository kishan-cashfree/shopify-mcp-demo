import { randomUUID } from "node:crypto";
import { z } from "zod";
import { UcpError } from "../ucp/client";
import type { ShopService } from "../ucp/shop";
import type { Product } from "../ucp/types";

export interface SearchToolResult {
  content: { type: "text"; text: string }[];
  _meta: { products: Product[]; searchId: string; storeName: string };
}

/**
 * "belvish.myshopify.com" → "Belvish".
 *
 * The grid credits the store the catalog came from, and the shop domain is the
 * only name this server has — UCP exposes no storefront metadata call.
 *
 * The rule is deliberately dull: drop the scheme and path, drop a leading
 * "www." or "shop.", then take the first label. Trying to find the
 * registrable domain instead turned "shop.belvish.co.uk" into "Shop", because
 * no regex tells "co.uk" from "belvish.com" without a public-suffix list — a
 * dependency for a decoration.
 */
export function storeDisplayName(shopDomain: string): string {
  const host = (shopDomain.replace(/^https?:\/\//, "").split("/")[0] ?? "")
    .replace(/^(www|shop)\./i, "");
  const name = host.split(".")[0] ?? "";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : shopDomain;
}

const cartRequestSchema = z
  .object({
    cartId: z.string().min(1).optional(),
    lines: z.array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(0),
      }),
    ),
  })
  .passthrough();

/**
 * The model gets a one-line summary; the widget gets the catalog via _meta.
 * Sending products through the model burns context and invites it to quote
 * prices from memory instead of rendering the ones we returned.
 */
export async function handleSearchProducts(
  shop: ShopService,
  query: string,
  shopDomain = "",
): Promise<SearchToolResult> {
  let products: Product[] = [];
  let summary: string;

  try {
    products = await shop.searchProducts(query);
    summary =
      products.length === 0
        ? `No products matched "${query}" in this store.`
        : `Found ${products.length} product${products.length === 1 ? "" : "s"} for "${query}".`;
  } catch (error) {
    // Shopify's validation messages are specific and useful — pass them
    // through rather than replacing them with a generic failure.
    summary =
      error instanceof UcpError
        ? `Couldn't search this store: ${error.message}`
        : `Couldn't reach this store: ${(error as Error).message}`;
  }

  return {
    content: [{ type: "text", text: summary }],
    // Stamped per call so the widget can tell a new search from a repaint.
    // Host widget state outlives any one widget instance, so without this a
    // search after a payment renders the previous screen — the receipt.
    _meta: {
      products,
      searchId: randomUUID(),
      storeName: storeDisplayName(shopDomain),
    },
  };
}

export async function handleCartRequest(
  shop: ShopService,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const parsed = cartRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Invalid cart request", details: parsed.error.issues },
    };
  }

  try {
    const cart = await shop.saveCart({
      cartId: parsed.data.cartId,
      lines: parsed.data.lines,
    });

    // Shopify drops a line it will not sell and still answers 200 with a
    // valid cart. Measured live on 2026-08-20 against belvish.myshopify.com:
    // an available variant returned lines:1 total:225000, a sold-out one
    // returned lines:0 total:0 — same status, no error field, nothing to tell
    // the two apart. The buyer taps Add, the cart stays empty and the screen
    // explains nothing.
    //
    // Quantity 0 is excluded because update_cart is declarative: asking for
    // zero IS the removal, so a missing line there is the request succeeding.
    const returned = new Set(cart.lines.map((line) => line.variantId));
    const unavailableVariantIds = parsed.data.lines
      .filter((line) => line.quantity > 0 && !returned.has(line.variantId))
      .map((line) => line.variantId);

    return {
      status: 200,
      body:
        unavailableVariantIds.length > 0
          ? { ...cart, unavailableVariantIds }
          : cart,
    };
  } catch (error) {
    return { status: 502, body: { error: (error as Error).message } };
  }
}
