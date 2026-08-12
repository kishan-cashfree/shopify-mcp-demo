import { useCallback, useEffect, useState } from "react";

/** Starts fast, because most payments settle within a few seconds. */
const FIRST_POLL_MS = 2_000;
/** Then backs off, because a payment nobody is completing is the common case. */
const MAX_POLL_MS = 15_000;
const BACKOFF = 1.6;
const TIMEOUT_MS = 3 * 60_000;

const TERMINAL = new Set(["PAID", "FAILED", "CANCELLED", "EXPIRED"]);

export interface OrderStatusResult {
  status: string | null;
  done: boolean;
  timedOut: boolean;
  /** True while polling is live, so the UI can offer to stop. */
  polling: boolean;
  stop: () => void;
}

/**
 * Polls our own order-status proxy until Cashfree reports a terminal state.
 *
 * Written here rather than reused from cashfree-here: that package's export
 * map exposes only its server entry, and its hooks are never compiled into
 * dist. Owning it also means the interval and timeout are ours to tune.
 *
 * The interval backs off rather than staying flat. A buyer who never completes
 * payment is the common case, and a fixed 3s poll spent roughly a hundred
 * requests on an order that sat ACTIVE the whole time.
 */
export function useOrderStatus(
  baseUrl: string,
  orderId: string | null,
): OrderStatusResult {
  const [status, setStatus] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [stopped, setStopped] = useState(false);

  const stop = useCallback(() => setStopped(true), []);

  useEffect(() => {
    if (!orderId || stopped) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wait = FIRST_POLL_MS;
    const startedAt = Date.now();

    async function poll(): Promise<void> {
      if (cancelled) return;

      if (Date.now() - startedAt > TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }

      try {
        // POST, not GET. Measured in ChatGPT: GET requests from this widget
        // never reach the server while every POST does — the same failure that
        // leaves cashfree-here's own GET-based recon reporting "unable to
        // verify payment status".
        const response = await fetch(`${baseUrl}/api/orders/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        if (response.ok) {
          const body = (await response.json()) as { orderStatus?: string };
          if (!cancelled && body.orderStatus) {
            setStatus(body.orderStatus);
            if (TERMINAL.has(body.orderStatus)) return;
          }
        }
      } catch {
        // A failed poll is not a failed payment. Keep trying until the timeout.
      }

      if (!cancelled) {
        timer = setTimeout(() => void poll(), wait);
        wait = Math.min(Math.round(wait * BACKOFF), MAX_POLL_MS);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [baseUrl, orderId, stopped]);

  const done = status !== null && TERMINAL.has(status);

  return {
    status,
    done,
    timedOut,
    polling: !!orderId && !done && !timedOut && !stopped,
    stop,
  };
}
