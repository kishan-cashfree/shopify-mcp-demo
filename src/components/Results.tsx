import { formatMoney } from "../lib/ucp/normalise";
import { cartItemCount } from "../lib/widget/cartCount";
import type { Cart, Product, Variant } from "../lib/ucp/types";

interface ResultsProps {
  products: Product[];
  query: string;
  cart: Cart | null;
  busy: boolean;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onViewCart: () => void;
}

/**
 * Milestone 1 has no product detail screen, so a card represents its first
 * available variant — falling back to the first variant when none are in
 * stock, so the card can still render as unavailable rather than vanish.
 */
function pickVariant(product: Product): Variant | undefined {
  return product.variants.find((v) => v.available) ?? product.variants[0];
}

export function Results({
  products,
  query,
  cart,
  busy,
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

  const quantityOf = (variantId: string) =>
    cart?.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;

  const itemCount = cartItemCount(cart);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        {products.map((product) => {
          const variant = pickVariant(product);
          if (!variant) return null;

          const image = variant.imageUrl ?? product.imageUrl;
          const quantity = quantityOf(variant.id);

          return (
            <div
              key={product.id}
              className="flex flex-col overflow-hidden rounded-xl border border-black/10"
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

              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-2 text-sm font-medium">
                  {product.title}
                </p>
                {/* Naming the variant matters: with no detail screen, this is
                    the only place the user learns which option is being added. */}
                <p className="text-xs text-secondary">{variant.title}</p>
                {/* listPrice falls back to price on undiscounted variants, so
                    only a strictly higher value is a real compare-at price.
                    Rendering it otherwise invents a saving of zero — or, on
                    bad data, a negative one. */}
                <p className="mt-auto flex items-baseline gap-1.5 text-sm font-semibold">
                  {variant.listPrice.amountMinor >
                    variant.price.amountMinor && (
                    <s className="text-xs font-normal text-secondary">
                      {formatMoney(variant.listPrice)}
                    </s>
                  )}
                  {formatMoney(variant.price)}
                </p>

                {/* Once an item is in the cart the button becomes a stepper, so
                    a second tap adds another rather than navigating away. The
                    buyer stays on the grid and can add several products before
                    checking out. */}
                {quantity > 0 ? (
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-black/15 px-2 py-1">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${product.title}`}
                      disabled={busy}
                      onClick={() => onQuantityChange(variant.id, quantity - 1)}
                      className="h-7 w-7 text-sm disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="text-sm font-medium">{quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${product.title}`}
                      disabled={busy}
                      onClick={() => onQuantityChange(variant.id, quantity + 1)}
                      className="h-7 w-7 text-sm disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!variant.available || busy}
                    onClick={() => onQuantityChange(variant.id, 1)}
                    className="mt-2 rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {variant.available ? "Add" : "Unavailable"}
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
