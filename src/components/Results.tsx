import { formatMoney } from "../lib/ucp/normalise";
import { cartItemCount } from "../lib/widget/cartCount";
import type { Cart, Product } from "../lib/ucp/types";

interface ResultsProps {
  products: Product[];
  query: string;
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

export function Results({
  products,
  query,
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
      <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        {products.map((product) => {
          const image = product.imageUrl ?? product.variants[0]?.imageUrl;
          const inCart = inCartCount(product, cart);
          const summary = optionSummary(product);
          const { min, max } = product.priceRange;
          const control = cardControl(product, cart);

          return (
            <div
              key={product.id}
              className="relative flex flex-col overflow-hidden rounded-xl border border-black/10"
            >
              {/* The card is a div, not a button: the stepper below lives
                  inside it, and a button cannot contain buttons. */}
              <button
                type="button"
                onClick={() => onOpenProduct(product.id)}
                className="flex flex-1 flex-col text-left"
              >
                {image ? (
                  <img
                    src={image}
                    alt={product.title}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full bg-black/5" />
                )}

                <div className="flex flex-1 flex-col gap-1 p-3 pb-1">
                  <p className="line-clamp-2 text-sm font-medium">
                    {product.title}
                  </p>
                  {summary && (
                    <p className="text-xs text-secondary">{summary}</p>
                  )}
                  <p className="mt-auto text-sm font-semibold">
                    {min.amountMinor === max.amountMinor
                      ? formatMoney(min)
                      : `${formatMoney(min)} \u2013 ${formatMoney(max)}`}
                  </p>
                </div>
              </button>

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

              <div className="p-3 pt-2">
                {control.kind === "step" && (
                  <div className="flex items-center justify-between rounded-lg border border-black/15 px-2 py-1">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${product.title}`}
                      disabled={busy}
                      onClick={() =>
                        onQuantityChange(
                          control.variantId,
                          control.quantity - 1,
                        )
                      }
                      className="h-7 w-7 text-sm disabled:opacity-40"
                    >
                      \u2212
                    </button>
                    <span className="text-sm font-medium">
                      {control.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${product.title}`}
                      disabled={busy}
                      onClick={() =>
                        onQuantityChange(
                          control.variantId,
                          control.quantity + 1,
                        )
                      }
                      className="h-7 w-7 text-sm disabled:opacity-40"
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
                    className="w-full rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {control.available ? "Add" : "Unavailable"}
                  </button>
                )}

                {/* Add here means "choose a colour", so it opens the product
                    rather than putting one in the cart on the buyer's behalf. */}
                {control.kind === "choose" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOpenProduct(product.id)}
                    className="w-full rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* The way forward, shown only once there is something to check out.
          Adding no longer jumps to the cart, so this is what moves the buyer
          on when they are done browsing. */}
      {cart && itemCount > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-black/10 bg-surface p-3">
          <span className="text-sm">
            {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold">{formatMoney(cart.total)}</span>
          </span>
          <button
            type="button"
            onClick={onViewCart}
            className="rounded-xl bg-black/90 px-4 py-2 text-sm font-semibold text-white"
          >
            View cart
          </button>
        </div>
      )}
    </div>
  );
}
