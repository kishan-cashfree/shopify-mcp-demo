import { z } from "zod";
import { UcpError } from "../ucp/client";
import type { ShopService } from "../ucp/shop";
import type { Product } from "../ucp/types";

export interface SearchToolResult {
  content: { type: "text"; text: string }[];
  _meta: { products: Product[] };
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
    _meta: { products },
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
    return { status: 200, body: cart };
  } catch (error) {
    return { status: 502, body: { error: (error as Error).message } };
  }
}
