import { formatMoney } from "../lib/ucp/normalise";
import { cartItemCount } from "../lib/widget/cartCount";
import type { Cart, Product } from "../lib/ucp/types";

interface ResultsProps {
  products: Product[];
  query: string;
  cart: Cart | null;
  busy: boolean;
  onOpenProduct: (productId: string) => void;
  onViewCart: () => void;
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

          return (
            <button
              key={product.id}
              type="button"
              disabled={busy}
              onClick={() => onOpenProduct(product.id)}
              className="relative flex flex-col overflow-hidden rounded-xl border border-black/10 text-left"
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

              {inCart > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-black/90 px-2 py-0.5 text-xs font-semibold text-white">
                  {inCart}
                </span>
              )}

              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-2 text-sm font-medium">
                  {product.title}
                </p>
                {summary && <p className="text-xs text-secondary">{summary}</p>}
                <p className="mt-auto text-sm font-semibold">
                  {min.amountMinor === max.amountMinor
                    ? formatMoney(min)
                    : `${formatMoney(min)} \u2013 ${formatMoney(max)}`}
                </p>
              </div>
            </button>
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
