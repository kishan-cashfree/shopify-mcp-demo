import { useCallback, useRef, useState } from "react";
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
