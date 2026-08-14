import { useCallback, useEffect, useRef, useState } from "react";
import type { Cart } from "../lib/ucp/types";

export interface CartSnapshot {
  cartId?: string;
  quantities: Record<string, number>;
}

export interface UseCartResult {
  cart: Cart | null;
  busy: boolean;
  error: string | null;
  setQuantity: (variantId: string, quantity: number) => Promise<void>;
}

export function useCart(
  baseUrl: string,
  persisted: CartSnapshot,
  onPersist: (snapshot: CartSnapshot) => void,
): UseCartResult {
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Desired quantities are tracked separately from the rendered cart, because
  // update_cart is declarative: every call must carry the complete set.
  // Seeded from persisted widget state so a host re-render does not drop the
  // cart the user has already built.
  const quantities = useRef<Record<string, number>>({
    ...persisted.quantities,
  });
  const cartId = useRef<string | undefined>(persisted.cartId);

  /**
   * Loads the cart this hook was handed, once, on mount.
   *
   * Only the id and the desired quantities survive a remount — the cart body
   * itself is Shopify's, and nothing was fetching it back. A new search
   * remounts this hook, so the buyer opened their cart to an empty panel and
   * watched their items appear a moment later, or not at all until they
   * nudged a quantity.
   *
   * update_cart is declarative, so re-asserting the quantities we already
   * hold is a read in practice: it returns the current cart and changes
   * nothing.
   */
  useEffect(() => {
    const existing = cartId.current;
    if (!existing) return;

    let cancelled = false;
    const lines = Object.entries(quantities.current)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ variantId: id, quantity: qty }));

    void (async () => {
      setBusy(true);
      try {
        const response = await fetch(`${baseUrl}/api/shop/cart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cartId: existing, lines }),
        });
        const body = await response.json();
        if (cancelled || !response.ok) return;

        const next = body as Cart;
        cartId.current = next.cartId;
        quantities.current = Object.fromEntries(
          next.lines.map((line) => [line.variantId, line.quantity]),
        );
        setCart(next);
      } catch {
        // Leaving the cart unloaded is better than an error on arrival; the
        // next change reports properly and recovers.
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount only: cartId and quantities are refs the hook owns from here on.
  }, [baseUrl]);

  const setQuantity = useCallback(
    async (variantId: string, quantity: number) => {
      const previous = { ...quantities.current };
      quantities.current[variantId] = Math.max(0, quantity);

      const lines = Object.entries(quantities.current)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => ({ variantId: id, quantity: qty }));

      setBusy(true);
      try {
        const response = await fetch(`${baseUrl}/api/shop/cart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cartId: cartId.current, lines }),
        });

        const body = await response.json();

        if (!response.ok) {
          // Roll the desired quantities back so the next change starts from
          // the state Shopify actually holds, not from the rejected one.
          quantities.current = previous;
          setError(
            typeof body?.error === "string"
              ? body.error
              : "Couldn't update cart",
          );
          return;
        }

        const next = body as Cart;
        cartId.current = next.cartId;
        // Re-seed from the server's answer: it is the only authority on what
        // is in the cart after discounts and availability limits apply.
        quantities.current = Object.fromEntries(
          next.lines.map((line) => [line.variantId, line.quantity]),
        );
        setCart(next);
        setError(null);
        onPersist({ cartId: next.cartId, quantities: quantities.current });
      } catch (caught) {
        quantities.current = previous;
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, onPersist],
  );

  return { cart, busy, error, setQuantity };
}
