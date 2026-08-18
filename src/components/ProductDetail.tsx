import { formatMoney } from "../lib/ucp/normalise";
import { cartItemCount } from "../lib/widget/cartCount";
import type { Cart, Product, Variant } from "../lib/ucp/types";

interface ProductDetailProps {
  product: Product;
  /** Undefined after a remount that cleared it — see `selected` below. */
  selectedVariantId?: string;
  cart: Cart | null;
  busy: boolean;
  onSelectVariant: (variantId: string) => void;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onViewCart: () => void;
  onBack: () => void;
}

/**
 * Shopify sends `{ name: "Title", label: "Default Title" }` for every product
 * that has no real options. Rendering it produces a picker with one button
 * called "Default Title", so an axis is only real when the product has more
 * than one variant to choose between.
 */
function optionAxes(product: Product): string[] {
  if (product.variants.length < 2) return [];
  const names: string[] = [];
  for (const variant of product.variants) {
    for (const option of variant.options) {
      if (!names.includes(option.name)) names.push(option.name);
    }
  }
  return names;
}

/** The variants offering a given label on a given axis. */
function variantsFor(product: Product, name: string, label: string): Variant[] {
  return product.variants.filter((variant) =>
    variant.options.some((o) => o.name === name && o.label === label),
  );
}

function labelsFor(product: Product, name: string): string[] {
  const labels: string[] = [];
  for (const variant of product.variants) {
    for (const option of variant.options) {
      if (option.name === name && !labels.includes(option.label)) {
        labels.push(option.label);
      }
    }
  }
  return labels;
}

/**
 * One product, with the description and options the grid has no room for.
 *
 * Holds no state. The selected variant arrives as a prop because it lives in
 * WidgetState: this widget is destroyed and recreated as the buyer scrolls,
 * and anything kept in a hook here would be lost on every remount.
 */
export function ProductDetail({
  product,
  selectedVariantId,
  cart,
  busy,
  onSelectVariant,
  onQuantityChange,
  onViewCart,
  onBack,
}: ProductDetailProps) {
  // A remount can arrive with the selection cleared. Falling back to the first
  // available variant renders something priced and buyable rather than an
  // empty screen; it matches what the grid card would have shown.
  const selected =
    product.variants.find((v) => v.id === selectedVariantId) ??
    product.variants.find((v) => v.available) ??
    product.variants[0];

  const quantity =
    cart?.lines.find((line) => line.variantId === selected?.id)?.quantity ?? 0;
  const itemCount = cartItemCount(cart);
  const axes = optionAxes(product);

  if (!selected) return null;

  const image = selected.imageUrl ?? product.imageUrl;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-black/10 p-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium"
          aria-label="Back to results"
        >
          ← Back
        </button>
        {itemCount > 0 && (
          <span className="text-sm text-secondary">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {image ? (
          <img
            src={image}
            alt={product.title}
            className="aspect-square w-full rounded-xl object-cover"
          />
        ) : (
          <div className="aspect-square w-full rounded-xl bg-black/5" />
        )}

        <h2 className="text-base font-semibold">{product.title}</h2>

        {/* listPrice falls back to price on undiscounted variants, so only a
            strictly higher value is a real compare-at price. Rendering it
            otherwise invents a saving of zero. */}
        <p className="flex items-baseline gap-2 text-lg font-semibold">
          {formatMoney(selected.price)}
          {selected.listPrice.amountMinor > selected.price.amountMinor && (
            <s className="text-sm font-normal text-secondary">
              {formatMoney(selected.listPrice)}
            </s>
          )}
        </p>

        {product.description && (
          <p className="text-sm text-secondary">{product.description}</p>
        )}

        {axes.map((name) => (
          <div key={name} className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-secondary">{name}</p>
            <div className="flex flex-wrap gap-2">
              {labelsFor(product, name).map((label) => {
                const matches = variantsFor(product, name, label);
                const target = matches.find((v) => v.available) ?? matches[0];
                const isSelected = selected.options.some(
                  (o) => o.name === name && o.label === label,
                );
                return (
                  <button
                    key={label}
                    type="button"
                    // Sold out renders disabled rather than hidden: hiding
                    // Black leaves a buyer wondering why three colours are two.
                    disabled={!matches.some((v) => v.available) || busy}
                    onClick={() => target && onSelectVariant(target.id)}
                    className={`rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSelected
                        ? "border-black/70 font-medium"
                        : "border-black/15"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {quantity > 0 ? (
          <div className="flex items-center justify-between rounded-lg border border-black/15 px-3 py-2">
            <button
              type="button"
              aria-label={`Decrease quantity of ${product.title}`}
              disabled={busy}
              onClick={() => onQuantityChange(selected.id, quantity - 1)}
              className="h-8 w-8 disabled:opacity-40"
            >
              −
            </button>
            <span className="text-sm font-medium">{quantity}</span>
            <button
              type="button"
              aria-label={`Increase quantity of ${product.title}`}
              disabled={busy}
              onClick={() => onQuantityChange(selected.id, quantity + 1)}
              className="h-8 w-8 disabled:opacity-40"
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!selected.available || busy}
            onClick={() => onQuantityChange(selected.id, 1)}
            className="rounded-xl bg-black/90 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selected.available ? "Add to cart" : "Unavailable"}
          </button>
        )}
      </div>

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
