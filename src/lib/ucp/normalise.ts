import type {
  Cart,
  CartDiscount,
  CartLine,
  Money,
  Product,
  RawCart,
  RawProduct,
  RawSearchResponse,
  Variant,
} from "./types";

/**
 * Format money for display. The decimal count comes from Intl rather than a
 * hardcoded 100, so zero-decimal currencies (JPY, KRW, VND) are not silently
 * divided into a hundredth of their real value.
 */
export function formatMoney(money: Money, locale = "en-IN"): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(money.amountMinor / 10 ** digits);
}

function firstImage(media: { url: string }[] | undefined): string | undefined {
  return media?.[0]?.url;
}

function normaliseVariant(
  raw: RawProduct["variants"][number],
  productImage: string | undefined,
): Variant {
  return {
    id: raw.id,
    title: raw.title,
    price: { amountMinor: raw.price.amount, currency: raw.price.currency },
    // Cashfree's cart summary wants both an original and a discounted price.
    // Undiscounted variants omit list_price, so it falls back to price and the
    // summary shows no strike-through rather than a missing field.
    listPrice: {
      amountMinor: raw.list_price?.amount ?? raw.price.amount,
      currency: raw.list_price?.currency ?? raw.price.currency,
    },
    available: raw.availability?.available ?? false,
    imageUrl: firstImage(raw.media) ?? productImage,
  };
}

export function normaliseProducts(raw: unknown): Product[] {
  const payload = raw as RawSearchResponse;
  if (!payload || !Array.isArray(payload.products)) {
    throw new Error("Unexpected search payload: no products array");
  }

  return payload.products.map((product) => {
    const productImage = firstImage(product.media);
    return {
      id: product.id,
      title: product.title,
      handle: product.handle ?? "",
      imageUrl: productImage,
      variants: (product.variants ?? []).map((v) =>
        normaliseVariant(v, productImage),
      ),
    };
  });
}

export function normaliseCart(raw: unknown): Cart {
  const payload = raw as RawCart;
  if (!payload || typeof payload.id !== "string") {
    throw new Error("Unexpected cart payload: no cart id");
  }
  if (typeof payload.continue_url !== "string") {
    throw new Error(
      "Unexpected cart payload: continue_url missing — nothing to check out to",
    );
  }

  const currency = payload.currency;

  const lines: CartLine[] = (payload.line_items ?? []).map((line) => {
    const unitMinor = line.item.price;
    return {
      lineId: line.id,
      variantId: line.item.id,
      title: line.item.title,
      imageUrl: line.item.image_url,
      quantity: line.quantity,
      // Cart line prices arrive as bare integers; the currency lives once on
      // the cart. Rejoining them here is the whole point of this function.
      unitPrice: { amountMinor: unitMinor, currency },
      lineSubtotal: {
        amountMinor:
          line.totals?.find((t) => t.type === "subtotal")?.amount ??
          unitMinor * line.quantity,
        currency,
      },
      lineTotal: {
        amountMinor:
          line.totals?.find((t) => t.type === "total")?.amount ??
          unitMinor * line.quantity,
        currency,
      },
    };
  });

  const totalMinor =
    payload.totals?.find((t) => t.type === "total")?.amount ?? 0;

  // Not every store discounts, so a missing subtotal row means "same as total"
  // rather than zero — which would render the whole cart as one big reduction.
  const subtotalMinor =
    payload.totals?.find((t) => t.type === "subtotal")?.amount ?? totalMinor;

  return {
    cartId: payload.id,
    currency,
    lines,
    subtotal: { amountMinor: subtotalMinor, currency },
    discount: readDiscount(payload, currency),
    total: { amountMinor: totalMinor, currency },
    continueUrl: payload.continue_url,
  };
}

/**
 * The totals row owns the money; `discounts.applied` only supplies a name.
 * Reading the amount from the titles instead would under-report whenever
 * Shopify allocates a reduction it does not itemise.
 */
function readDiscount(
  payload: RawCart,
  currency: string,
): CartDiscount | undefined {
  const discountMinor = payload.totals
    ?.filter((t) => t.type.endsWith("discount") || t.type.endsWith("discounts"))
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  if (!discountMinor) return undefined;

  const applied = payload.discounts?.applied ?? [];
  const titles = applied.map((d) => d.title).filter(Boolean);
  // One offer earns its name on screen. Two cannot share a single line without
  // crediting one of them for the other's money.
  const label = titles.length === 1 ? titles[0]! : titles.length > 1 ? "Discounts" : "Discount";

  return { label, amount: { amountMinor: discountMinor, currency } };
}
