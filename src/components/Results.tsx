import { formatMoney } from "../lib/ucp/normalise";
import { cartItemCount } from "../lib/widget/cartCount";
import { ACCENT_BLUE, CTA_BG, CashfreeMark, FIELD_DARK } from "./checkoutChrome";
import type { Cart, Product, Variant } from "../lib/ucp/types";

interface ResultsProps {
  products: Product[];
  query: string;
  /** The store the catalog came from. Empty until the tool result carries it. */
  storeName?: string;
  cart: Cart | null;
  busy: boolean;
  onOpenProduct: (productId: string) => void;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onViewCart: () => void;
}

/**
 * What the control under a card should be.
 *
 * A card represents a product, but the cart holds variants, so the two only
 * line up some of the time. Where they do not, this refuses rather than
 * guesses: a minus that removes a colour the buyer did not choose is worse
 * than a card that asks them to open the product first.
 */
type CardControl =
  | { kind: "add"; variantId: string; available: boolean }
  | { kind: "choose" }
  | { kind: "step"; variantId: string; quantity: number }
  | { kind: "none" };

function cardControl(product: Product, cart: Cart | null): CardControl {
  const inCart = (cart?.lines ?? []).filter((line) =>
    product.variants.some((v) => v.id === line.variantId),
  );

  // Exactly one of this product's variants is in the cart, so a stepper has
  // one unambiguous target — whether or not the product has other colours.
  if (inCart.length === 1) {
    return {
      kind: "step",
      variantId: inCart[0].variantId,
      quantity: inCart[0].quantity,
    };
  }

  // Two colours of the same product. The badge still totals them; the stepper
  // does not appear, because it would have to pick one.
  if (inCart.length > 1) return { kind: "none" };

  const only = product.variants.length === 1 ? product.variants[0] : undefined;
  if (only) {
    return { kind: "add", variantId: only.id, available: only.available };
  }

  // Nothing in the cart and more than one variant: the card cannot know which
  // colour is wanted, so Add means "go and choose".
  return { kind: "choose" };
}

/**
 * How many of this product's variants are in the cart.
 *
 * Counted across variants, not lines: two Reds and one Blue is three, and a
 * badge reading "2" under a product holding three items is worse than none.
 */
function inCartCount(product: Product, cart: Cart | null): number {
  const ids = new Set(product.variants.map((v) => v.id));
  return (cart?.lines ?? [])
    .filter((line) => ids.has(line.variantId))
    .reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * "3 colors", from the first axis only.
 *
 * A multi-axis product names one axis rather than enumerating a matrix — a
 * grid card is not the place to spell out Size x Color. Shopify's "Title"
 * placeholder is not an axis, so a single-variant product summarises to
 * nothing.
 */
function optionSummary(product: Product): string | null {
  if (product.variants.length < 2) return null;
  const name = product.variants[0]?.options[0]?.name;
  if (!name) return null;
  const labels = new Set(
    product.variants.flatMap((v) =>
      v.options.filter((o) => o.name === name).map((o) => o.label),
    ),
  );
  if (labels.size < 2) return null;
  return `${labels.size} ${name.toLowerCase()}s`;
}

/**
 * The variant a card prices: the cheapest sellable one, or the cheapest at all
 * when the product is gone. Pricing off a sold-out variant puts a number on
 * the card that cannot be paid.
 */
function pricedVariant(product: Product): Variant | undefined {
  const pool = product.variants.filter((v) => v.available);
  const from = pool.length > 0 ? pool : product.variants;
  return from.reduce<Variant | undefined>(
    (best, v) =>
      !best || v.price.amountMinor < best.price.amountMinor ? v : best,
    undefined,
  );
}

/**
 * The saving as a whole percent, or null when there is none.
 *
 * Rounded rather than truncated, and computed from the variant actually being
 * priced — a badge derived from a different variant than the price beside it
 * is worse than no badge.
 */
function discountPercent(variant: Variant | undefined): number | null {
  if (!variant) return null;
  const was = variant.listPrice.amountMinor;
  const now = variant.price.amountMinor;
  if (was <= now || was <= 0) return null;
  const pct = Math.round(((was - now) / was) * 100);
  return pct > 0 ? pct : null;
}

export function Results({
  products,
  query,
  storeName,
  cart,
  busy,
  onOpenProduct,
  onQuantityChange,
  onViewCart,
}: ResultsProps) {
  if (products.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
        <p className="text-base font-medium">No products matched “{query}”.</p>
        <p className="mt-1 text-sm text-secondary">
          Try a different search term.
        </p>
      </div>
    );
  }

  const itemCount = cartItemCount(cart);

  return (
    <div className="flex flex-col">
      {/* Who the catalog came from, and who is taking the money. Both are
          claims a buyer is entitled to before they add anything. */}
      <div className="flex items-center justify-between px-3 pt-3 text-sm">
        <span className="text-secondary">
          <span className="font-semibold text-primary">
            {products.length} product{products.length === 1 ? "" : "s"}
          </span>
          {storeName ? ` from ${storeName}` : ""}
        </span>
        <CashfreeMark className="text-secondary" />
      </div>

      <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        {products.map((product) => {
          const image = product.imageUrl ?? product.variants[0]?.imageUrl;
          const inCart = inCartCount(product, cart);
          const priced = pricedVariant(product);
          const percentOff = discountPercent(priced);
          const summary = optionSummary(product);
          const control = cardControl(product, cart);

          return (
            <div
              key={product.id}
              className="relative flex flex-col overflow-hidden rounded-2xl border border-black/10"
            >
              <button
                type="button"
                onClick={() => onOpenProduct(product.id)}
                className="flex flex-1 flex-col text-left"
              >
                <div className="relative aspect-square w-full bg-[#fdfaf3]">
                  {image ? (
                    <img
                      src={image}
                      alt={product.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    // Said, not left blank: an empty tile reads as a failed
                    // load the buyer might wait on.
                    <span className="flex h-full w-full items-center justify-center text-sm text-black/35">
                      No image
                    </span>
                  )}

                  {percentOff !== null && (
                    <span
                      className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold text-white"
                      style={{ backgroundColor: ACCENT_BLUE }}
                    >
                      -{percentOff}%
                    </span>
                  )}

                  {inCart > 0 && (
                    <span
                      // Labelled because the stepper below can show the same
                      // number, and because a bare digit floating on an image
                      // says nothing to a screen reader.
                      aria-label={`${inCart} in cart`}
                      className="absolute right-2 top-2 rounded-full bg-black/90 px-2 py-0.5 text-xs font-semibold text-white"
                    >
                      {inCart}
                    </span>
                  )}
                </div>

                <div
                  className="flex flex-1 flex-col gap-0.5 px-3 pt-3"
                  style={{ backgroundColor: FIELD_DARK }}
                >
                  <p className="line-clamp-2 text-sm font-medium text-white">
                    {product.title}
                  </p>
                  {summary && (
                    <p className="text-xs text-white/50">{summary}</p>
                  )}
                  <p className="mt-1 flex items-baseline gap-2">
                    <span className="text-base font-bold text-white">
                      {/* "from" when the variants disagree. The card prices the
                          cheapest one, and a bare figure on a product whose
                          other sizes cost more is a number the buyer cannot
                          pay — the old range said this, and dropping it
                          silently would be a regression, not a restyle. */}
                      {product.priceRange.min.amountMinor !==
                      product.priceRange.max.amountMinor
                        ? `from ${formatMoney(product.priceRange.min)}`
                        : formatMoney(priced?.price ?? product.priceRange.min)}
                    </span>
                    {percentOff !== null && priced && (
                      <s className="text-sm text-white/40">
                        {formatMoney(priced.listPrice)}
                      </s>
                    )}
                  </p>
                </div>
              </button>

              <div className="px-3 pb-3 pt-2" style={{ backgroundColor: FIELD_DARK }}>
                {control.kind === "step" && (
                  <div className="flex items-center justify-between rounded-xl border border-white/25 px-2 py-1.5">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${product.title}`}
                      disabled={busy}
                      onClick={() =>
                        onQuantityChange(control.variantId, control.quantity - 1)
                      }
                      className="h-7 w-7 text-white disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="text-sm font-medium text-white">
                      {control.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${product.title}`}
                      disabled={busy}
                      onClick={() =>
                        onQuantityChange(control.variantId, control.quantity + 1)
                      }
                      className="h-7 w-7 text-white disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                )}

                {control.kind === "add" && (
                  <button
                    type="button"
                    disabled={!control.available || busy}
                    onClick={() => onQuantityChange(control.variantId, 1)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ backgroundColor: control.available ? CTA_BG : "#3f3f46" }}
                  >
                    {control.available ? "+ Add" : "Unavailable"}
                  </button>
                )}

                {/* Add here means "choose a variant", so it opens the product
                    rather than putting one in the cart on the buyer's behalf. */}
                {control.kind === "choose" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOpenProduct(product.id)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                    style={{ backgroundColor: CTA_BG }}
                  >
                    + Add
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* The way forward, shown only once there is something to check out. */}
      {cart && itemCount > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-black/10 bg-surface p-3">
          <span className="text-sm">
            {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold">{formatMoney(cart.total)}</span>
          </span>
          <button
            type="button"
            onClick={onViewCart}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: CTA_BG }}
          >
            View cart
          </button>
        </div>
      )}
    </div>
  );
}
