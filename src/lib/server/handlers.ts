import { randomUUID } from "node:crypto";
import { z } from "zod";
import { UcpError } from "../ucp/client";
import type { ShopService } from "../ucp/shop";
import type { Product } from "../ucp/types";
import { toMinor } from "../money";

export interface SearchToolResult {
  content: { type: "text"; text: string }[];
  _meta: {
    products: Product[];
    searchId: string;
    storeName: string;
    /** The range the buyer asked for, in major units. Absent if they named none. */
    priceMin?: number;
    priceMax?: number;
  };
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
/**
 * A price range as the MODEL supplies it — the buyer's own units.
 *
 * "under 5k" becomes { max: 5000 }, because that is what the buyer said and
 * what a model reliably produces. Shopify wants minor units, and this handler
 * is the one place that conversion happens.
 */
export interface PriceQuery {
  min?: number;
  max?: number;
}

/**
 * The currency the model's price is assumed to be in.
 *
 * The filter has to be sent BEFORE any result comes back, so the store's
 * currency is not yet known. INR matches every demo store here and the
 * README's "INR only" statement; toMinor takes the decimal count from Intl
 * regardless, so a two-decimal currency behaves identically and a zero-decimal
 * one is not multiplied.
 */
const SEARCH_CURRENCY = "INR";

export async function handleSearchProducts(
  shop: ShopService,
  /** Absent for "show me all products", which has no keyword to search on. */
  query: string | undefined,
  shopDomain = "",
  price?: PriceQuery,
): Promise<SearchToolResult> {
  let products: Product[] = [];
  let summary: string;

  /**
   * Blank is browse-all, and padding is not part of the search.
   *
   * Probed against the live server on 2026-09-03: {"query":"   "} answered
   * `Found 17 products for "   "` — Shopify happened to ignore the spaces, so
   * the grid looked right while the sentence the model reads back named a
   * query of spaces. A store whose search is less forgiving returns nothing
   * instead, and that reads as an empty store rather than a bad request.
   *
   * Owned here because both callers reach Shopify through this function — the
   * MCP tool and /api/shop/search. A second copy of this rule at either entry
   * point is how the two CSP blocks drifted until Claude blocked every image.
   */
  const keyword = query?.trim() || undefined;

  const range =
    price?.min === undefined && price?.max === undefined
      ? undefined
      : {
          ...(price?.min === undefined
            ? {}
            : { minMinor: toMinor(price.min, SEARCH_CURRENCY) }),
          ...(price?.max === undefined
            ? {}
            : { maxMinor: toMinor(price.max, SEARCH_CURRENCY) }),
        };

  try {
    products = await shop.searchProducts(keyword, range);
    const count = `${products.length} product${products.length === 1 ? "" : "s"}`;
    // Two wordings, because a keywordless search has nothing to name. The
    // earlier single template interpolated the query straight in, so a browse
    // would have read back to the model as: Found 100 products for "undefined".
    summary = keyword
      ? products.length === 0
        ? `No products matched "${keyword}" in this store.`
        : `Found ${count} for "${keyword}".`
      : products.length === 0
        ? `This store has no products to show.`
        : `Found ${count} in this store.`;
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
      // Echoed so a reload can reapply it. ChatGPT does not re-deliver the
      // tool result, so useProducts re-searches from widget state; without the
      // range there, a buyer who asked for "under 5k" and reloaded got the
      // whole catalog back.
      ...(price?.min === undefined ? {} : { priceMin: price.min }),
      ...(price?.max === undefined ? {} : { priceMax: price.max }),
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
