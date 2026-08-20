import { formatMoney } from "../lib/ucp/normalise";
import type { Cart } from "../lib/ucp/types";
import { CTA_BG, SecuredByCashfree } from "./checkoutChrome";

interface PaymentResultProps {
  cart: Cart | null;
  orderId: string;
  /** Cashfree order status, or null while the first poll is in flight. */
  status: string | null;
  timedOut: boolean;
  /** Live poll in progress, so the buyer can call it off. */
  polling: boolean;
  onStopWaiting: () => void;
  onRetry: () => void;
  onBack: () => void;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-secondary">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * What the buyer sees after paying: verification while Cashfree settles, then
 * the outcome with enough detail to recognise the order.
 *
 * The order id is shown on every terminal state, success or not — it is the
 * only thing a buyer can quote to support, and it is exactly when something
 * went wrong that they need it.
 */
export function PaymentResult({
  cart,
  orderId,
  status,
  timedOut,
  polling,
  onStopWaiting,
  onRetry,
  onBack,
}: PaymentResultProps) {
  const paid = status === "PAID";
  const failed = status === "FAILED" || status === "CANCELLED";

  if (!paid && !failed && !timedOut) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-base font-medium">Waiting for payment…</p>
        {/* Deliberately says nothing about where. Every payment path lands
            here now: in-conversation the Cashfree widget is right below in the
            same chat, and only the blocked path opens a tab. Naming one sends
            half the buyers looking for a window that was never opened. */}
        <p className="text-sm text-secondary">
          Finish the payment to continue. This updates on its own — you do not
          need to refresh.
        </p>
        <p className="mt-2 text-xs text-secondary">Order {orderId}</p>
        {/* A buyer who changed their mind should not leave a poller running
            for minutes. */}
        {polling && (
          <button
            type="button"
            onClick={onStopWaiting}
            className="mt-2 text-xs text-secondary underline"
          >
            Stop waiting
          </button>
        )}
        {/* On the waiting screen too, not only the terminal one: this is the
            moment the buyer is staring at an unfinished payment wondering who
            has their money. */}
        <SecuredByCashfree />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {paid && (
        <>
          <p className="text-base font-semibold">Payment received</p>
          <p className="text-sm text-secondary">
            Cashfree confirmed this order.
          </p>
        </>
      )}

      {failed && (
        <>
          <p className="text-base font-semibold text-red-600">
            That payment didn&rsquo;t go through
          </p>
          <p className="text-sm text-secondary">
            Nothing was charged. You can try again.
          </p>
        </>
      )}

      {timedOut && !paid && !failed && (
        // Non-committal on purpose. A timeout means we do not know, and
        // telling a buyer their payment failed when their account may have
        // been debited is the worst thing this widget can do.
        <>
          <p className="text-base font-semibold">
            We couldn&rsquo;t confirm this yet
          </p>
          <p className="text-sm text-secondary">
            Check your bank or UPI app before paying again.
          </p>
        </>
      )}

      <div className="flex flex-col gap-1 rounded-xl border border-black/10 p-3">
        <Line label="Order" value={orderId} />
        {cart && <Line label="Total" value={formatMoney(cart.total)} />}
        {status && <Line label="Status" value={status} />}
      </div>

      {cart && cart.lines.length > 0 && (
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
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <div className="h-12 w-12 rounded-lg bg-black/5" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">{line.title}</p>
                <p className="text-xs text-secondary">
                  {line.quantity} × {formatMoney(line.unitPrice)}
                </p>
              </div>
              <span className="text-sm font-medium">
                {formatMoney(line.lineTotal)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!paid && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl px-4 py-3 text-sm font-semibold text-white"
            style={{ backgroundColor: CTA_BG }}
        >
          Back to payment
        </button>
      )}

      {/* No exit offered once paid — the order is done and the receipt is the
          last thing worth showing. "Back to cart" stays on the unpaid paths,
          which are the ones the buyer still needs a way out of. */}
      {!paid && (
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-secondary underline"
        >
          Back to cart
        </button>
      )}
      <SecuredByCashfree />
    </div>
  );
}
