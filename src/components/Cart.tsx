import { formatMoney } from "../lib/ucp/normalise";
import { CTA_BG, BackLink } from "./checkoutChrome";
import type { Cart, CartLine } from "../lib/ucp/types";

/** An inline tag glyph — no asset, for the same reason as the Cashfree mark. */
function TagIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.6 13.4 12 4.8H4.8V12l8.6 8.6a1.7 1.7 0 0 0 2.4 0l4.8-4.8a1.7 1.7 0 0 0 0-2.4Z" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The price text under a line title.
 *
 * A per-unit figure only exists when the line's discount divides evenly by
 * quantity — ₹100 off three units is ₹33.333… each, and three of a rounded
 * "each" would not add back up to the line. In that case show the line itself
 * rather than a number the buyer cannot reconcile.
 */
function LinePrice({ line }: { line: CartLine }) {
  const discounted = line.lineTotal.amountMinor < line.lineSubtotal.amountMinor;

  if (!discounted) {
    return <>{formatMoney(line.unitPrice)} each</>;
  }

  const divides =
    line.quantity > 0 && line.lineTotal.amountMinor % line.quantity === 0;

  return (
    <>
      <s className="text-secondary">
        {formatMoney(divides ? line.unitPrice : line.lineSubtotal)}
      </s>{" "}
      <span className="text-green-600">
        {divides
          ? `${formatMoney({
              amountMinor: line.lineTotal.amountMinor / line.quantity,
              currency: line.lineTotal.currency,
            })} each`
          : `${formatMoney(line.lineTotal)} total`}
      </span>
    </>
  );
}

interface CartViewProps {
  cart: Cart | null;
  busy: boolean;
  error: string | null;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onCheckout: () => void;
  onBack: () => void;
}

export function CartView({
  cart,
  busy,
  error,
  onQuantityChange,
  onCheckout,
  onBack,
}: CartViewProps) {
  const isEmpty = !cart || cart.lines.length === 0;

  return (
    <div className="flex flex-col p-4">
      <BackLink label="Back to products" onClick={onBack} />

      {isEmpty ? (
        <p className="py-12 text-center text-sm text-secondary">
          Your cart is empty.
        </p>
      ) : (
        <>
          {/* One panel, hairline-separated, rather than a card per line: the
              buyer is reviewing a single order, not four unrelated items. */}
          <ul className="mt-3 overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_24px_-16px_rgba(0,0,0,0.25)]">
            {cart.lines.map((line, i) => (
              <li
                key={line.lineId}
                className={`flex items-center gap-3 p-3 ${i > 0 ? "border-t border-black/[0.07]" : ""}`}
              >
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt={line.title}
                    className="h-14 w-14 shrink-0 rounded-xl bg-[#fdfaf3] object-cover"
                  />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-xl bg-black/5" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#1c1c1e]">{line.title}</p>
                  <p className="mt-0.5 text-xs text-black/55">
                    <LinePrice line={line} />
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1 rounded-full border border-black/15 px-1 py-0.5">
                  <button
                    type="button"
                    aria-label={`Decrease quantity of ${line.title}`}
                    disabled={busy}
                    onClick={() =>
                      onQuantityChange(line.variantId, line.quantity - 1)
                    }
                    className="h-7 w-7 text-[#1c1c1e] disabled:opacity-40"
                  >
                    −
                  </button>
                  {/* Rendered from the server response. It does not move until
                      Shopify confirms the new quantity. */}
                  <span className="w-5 text-center text-sm text-[#1c1c1e]">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase quantity of ${line.title}`}
                    disabled={busy}
                    onClick={() =>
                      onQuantityChange(line.variantId, line.quantity + 1)
                    }
                    className="h-7 w-7 text-[#1c1c1e] disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* The offer the store actually applied, named and quantified. Every
              discount observed from this store arrives `automatic: true` — the
              buyer did not enter it and cannot take it off — so this states
              what happened rather than offering a control that would lie. */}
          {cart.discount && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-[#c7d2fe] bg-[#e0e7ff] p-3 text-[#1e1b4b]">
              <TagIcon />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {cart.discount.label}
                </p>
                <p className="text-sm font-medium text-green-700">
                  You saved {formatMoney(cart.discount.amount)}
                </p>
              </div>
            </div>
          )}

          {/* Shown only when the store reduced the price. Without these rows a
              ₹24,500 item totalling ₹23,275 reads as broken arithmetic. */}
          {cart.discount && (
            <>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-secondary">Subtotal</span>
                <span className="text-sm">{formatMoney(cart.subtotal)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-secondary">
                  {cart.discount.label}
                </span>
                <span className="text-sm font-semibold text-green-600">
                  −{formatMoney(cart.discount.amount)}
                </span>
              </div>
            </>
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-base text-secondary">Total</span>
            <span className="text-xl font-bold">{formatMoney(cart.total)}</span>
          </div>
        </>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error} — your cart was restored to its last saved state. Try again.
        </p>
      )}

      {!isEmpty && (
        <button
          type="button"
          disabled={busy}
          onClick={onCheckout}
          className="mt-4 w-full rounded-xl px-4 py-3.5 text-base font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: CTA_BG }}
        >
          Checkout
        </button>
      )}
    </div>
  );
}
