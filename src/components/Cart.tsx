import { formatMoney } from "../lib/ucp/normalise";
import type { Cart, CartLine } from "../lib/ucp/types";

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
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back to products
      </button>

      {isEmpty ? (
        <p className="py-12 text-center text-sm text-secondary">
          Your cart is empty.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {cart.lines.map((line) => (
              <li
                key={line.lineId}
                className="flex items-center gap-3 rounded-xl border border-black/10 p-2"
              >
                {line.imageUrl ? (
                  <img
                    src={line.imageUrl}
                    alt={line.title}
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-lg bg-black/5" />
                )}

                <div className="flex-1">
                  <p className="text-sm font-medium">{line.title}</p>
                  <p className="text-xs text-secondary">
                    <LinePrice line={line} />
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Decrease quantity of ${line.title}`}
                    disabled={busy}
                    onClick={() =>
                      onQuantityChange(line.variantId, line.quantity - 1)
                    }
                    className="h-7 w-7 rounded-full border border-black/15 disabled:opacity-40"
                  >
                    −
                  </button>
                  {/* Rendered from the server response. It does not move until
                      Shopify confirms the new quantity. */}
                  <span className="w-5 text-center text-sm">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase quantity of ${line.title}`}
                    disabled={busy}
                    onClick={() =>
                      onQuantityChange(line.variantId, line.quantity + 1)
                    }
                    className="h-7 w-7 rounded-full border border-black/15 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* Shown only when the store reduced the price. Without these rows a
              ₹24,500 item totalling ₹23,275 reads as broken arithmetic. */}
          {cart.discount && (
            <>
              <div className="flex items-center justify-between px-1 pt-1">
                <span className="text-sm text-secondary">Subtotal</span>
                <span className="text-sm">{formatMoney(cart.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between px-1">
                <span className="text-sm text-secondary">
                  {cart.discount.label}
                </span>
                <span className="text-sm text-green-600">
                  −{formatMoney(cart.discount.amount)}
                </span>
              </div>
            </>
          )}

          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-sm text-secondary">Total</span>
            <span className="text-base font-semibold">
              {formatMoney(cart.total)}
            </span>
          </div>
        </>
      )}

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error} — your cart was restored to its last saved state. Try again.
        </p>
      )}

      {!isEmpty && (
        <button
          type="button"
          disabled={busy}
          onClick={onCheckout}
          className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Checkout
        </button>
      )}

    </div>
  );
}
