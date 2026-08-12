import { formatMoney } from "../lib/ucp/normalise";
import type { Product, Variant } from "../lib/ucp/types";

interface ResultsProps {
  products: Product[];
  query: string;
  onAdd: (variantId: string) => void;
}

/**
 * Milestone 1 has no product detail screen, so a card represents its first
 * available variant — falling back to the first variant when none are in
 * stock, so the card can still render as unavailable rather than vanish.
 */
function pickVariant(product: Product): Variant | undefined {
  return product.variants.find((v) => v.available) ?? product.variants[0];
}

export function Results({ products, query, onAdd }: ResultsProps) {
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

  return (
    <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
      {products.map((product) => {
        const variant = pickVariant(product);
        if (!variant) return null;

        const image = variant.imageUrl ?? product.imageUrl;

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
              <p className="line-clamp-2 text-sm font-medium">{product.title}</p>
              {/* Naming the variant matters: with no detail screen, this is the
                  only place the user learns which option is being added. */}
              <p className="text-xs text-secondary">{variant.title}</p>
              <p className="mt-auto text-sm font-semibold">
                {formatMoney(variant.price)}
              </p>

              <button
                type="button"
                disabled={!variant.available}
                onClick={() => onAdd(variant.id)}
                className="mt-2 rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {variant.available ? "Add" : "Unavailable"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
