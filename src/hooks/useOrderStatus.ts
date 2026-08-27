import { useCallback, useEffect, useState } from "react";

/** Starts fast, because most payments settle within a few seconds. */
const FIRST_POLL_MS = 2_000;
/** Then backs off, because a payment nobody is completing is the common case. */
const MAX_POLL_MS = 15_000;
const BACKOFF = 1.6;
const TIMEOUT_MS = 3 * 60_000;

const TERMINAL = new Set(["PAID", "FAILED", "CANCELLED", "EXPIRED"]);

/**
 * The shortest gap the visibility catch-up will honour.
 *
 * A host can flip visibility repeatedly — Claude recreates the widget iframe
 * as the buyer scrolls — and without this each flip would be a request. This
 * repo has already taken a Shopify 429 from exactly that shape of accidental
 * fan-out, so the catch-up is rate-limited rather than trusted.
 */
const CATCH_UP_FLOOR_MS = 1_000;

/** What Shopify called the order, once the server has placed it. */
export interface ShopifyOrderRef {
  id: string;
  name: string;
  statusPageUrl?: string;
}

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
    let inFlight = false;
    let lastPollAt = 0;
    let settled = false;
    const startedAt = Date.now();

    async function poll(): Promise<void> {
      if (cancelled || inFlight) return;
      inFlight = true;
      lastPollAt = Date.now();
      try {
        await attempt();
      } finally {
        inFlight = false;
      }
    }

    async function attempt(): Promise<void> {

      if (Date.now() - startedAt > TIMEOUT_MS) {
        setTimedOut(true);
        settled = true;
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
            if (TERMINAL.has(body.orderStatus)) {
              // Recorded, so the visibility catch-up does not start polling
              // again for an order there is nothing more to learn about.
              settled = true;
              return;
            }
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

    /**
     * Polls the instant the widget is looked at again.
     *
     * The backoff tops out at 15s, but a backgrounded iframe has its
     * setTimeout throttled hard by the browser: measured 2026-08-27, two live
     * polls 58 seconds apart while the buyer was on Cashfree's tab. The
     * payment had already landed — the receipt was waiting on a timer that was
     * not running.
     *
     * Only on becoming visible. Going away is not an event worth a request.
     */
    const onVisibilityChange = () => {
      if (cancelled || settled) return;
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastPollAt < CATCH_UP_FLOOR_MS) return;

      if (timer) clearTimeout(timer);
      // Back to the fast interval too: the buyer is watching again, and a
      // backoff earned while nobody was looking should not outlive them.
      wait = FIRST_POLL_MS;
      void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
