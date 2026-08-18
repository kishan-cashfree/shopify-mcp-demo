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

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Reduces a store's description HTML to plain text.
 *
 * Script and style bodies are removed rather than unwrapped: leaving the text
 * of a `<script>` behind renders an attack as prose, which is visible but
 * still puts attacker-authored content on a screen that also collects an OTP.
 *
 * Written by hand rather than pulled in as a sanitiser, because the output is
 * text — there is no markup to keep safe, so there is no allowlist to get
 * wrong. A sanitiser would be a dependency and a standing security surface for
 * formatting this widget has decided not to render.
 */
export function stripHtml(html: string | undefined): string {
  if (!html) return "";
  return (
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      // Block tags become a space and inline tags vanish. Treating them alike
      // is wrong in both directions: one space per tag turns
      // "<b>tee</b>." into "tee .", and no space at all turns
      // "<p>One</p><p>Two</p>" into "OneTwo".
      .replace(
        /<\/?(?:p|div|br|hr|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|blockquote|pre)\b[^>]*>/gi,
        " ",
      )
      .replace(/<[^>]*>/g, "")
      .replace(
        /&[a-z]+;|&#\d+;/gi,
        (entity) => ENTITIES[entity.toLowerCase()] ?? " ",
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * The span a grid card advertises.
 *
 * Priced off available variants wherever any exist: a sold-out cheap colour
 * setting the headline price puts a number on the card that cannot be paid.
 * Falls back to every variant when the whole product is gone, so a sold-out
 * product still renders a price instead of a range over an empty set.
 */
function priceRangeOf(variants: Variant[]): { min: Money; max: Money } {
  const sellable = variants.filter((v) => v.available);
  const pool = sellable.length > 0 ? sellable : variants;
  if (pool.length === 0) {
    // Unreachable against a real store — Shopify does not return a product
    // with no variants — but normaliseProducts already tolerates a missing
    // variants array, and a price range must not be the thing that starts
    // throwing on it. The currency is arbitrary because there is no variant
    // to read one from; nothing renders this, because a product with no
    // variants has nothing to buy.
    const zero: Money = { amountMinor: 0, currency: "INR" };
    return { min: zero, max: { ...zero } };
  }

  return pool.reduce(
    (range, variant) => ({
      min:
        variant.price.amountMinor < range.min.amountMinor
          ? variant.price
          : range.min,
      max:
        variant.price.amountMinor > range.max.amountMinor
          ? variant.price
          : range.max,
    }),
    { min: pool[0].price, max: pool[0].price },
  );
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
    options: raw.options ?? [],
  };
}

export function normaliseProducts(raw: unknown): Product[] {
  const payload = raw as RawSearchResponse;
  if (!payload || !Array.isArray(payload.products)) {
    throw new Error("Unexpected search payload: no products array");
  }

  return payload.products.map((product) => {
    const productImage = firstImage(product.media);
    const variants = (product.variants ?? []).map((v) =>
      normaliseVariant(v, productImage),
    );
    return {
      id: product.id,
      title: product.title,
      handle: product.handle ?? "",
      imageUrl: productImage,
      description: stripHtml(product.description?.html),
      priceRange: priceRangeOf(variants),
      variants,
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
  const label =
    titles.length === 1
      ? titles[0]!
      : titles.length > 1
        ? "Discounts"
        : "Discount";

  return { label, amount: { amountMinor: discountMinor, currency } };
}
