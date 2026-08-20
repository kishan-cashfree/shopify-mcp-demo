import { useCallback, useEffect, useRef, useState } from "react";
import type { Cart } from "../lib/ucp/types";

export interface CartSnapshot {
  cartId?: string;
  quantities: Record<string, number>;
  /**
   * The cart body as the store last returned it. Persisted, not just held in
   * state, because a remount is routine rather than rare — see the load
   * effect below.
   */
  cart?: Cart;
  /** When {@link cart} was fetched, so staleness can be judged on mount. */
  fetchedAt?: number;
}

/**
 * How long a persisted cart body may be rendered before it is refetched.
 *
 * Prices, stock and discounts move, so this is the window in which a *display*
 * total may lag the store. Nothing can be paid at a stale figure: every
 * quantity change re-seeds from the server's answer, and checkout builds off
 * the server's cart, not this copy.
 *
 * This was 30s, which turned out to be shorter than the pauses a buyer leaves.
 * Measured across three flows, the gap between a cart's last fetch and its next
 * mount was 32s, 41s, 41s, 42s, 53s, 80s and 143s — every one of them expired
 * the window, so the cache prevented not one call.
 */
const CART_TTL_MS = 10 * 60_000;

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
  // Seeded from the persisted body so a remount paints the cart it already
  // knows about, before — and usually instead of — any network call.
  const [cart, setCart] = useState<Cart | null>(persisted.cart ?? null);
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
  // Read once, at mount: what matters is how old the body was when this
  // document came up, not how old it becomes while the buyer reads it.
  const persistedFetchedAt = useRef<number | undefined>(
    persisted.cart ? persisted.fetchedAt : undefined,
  );

  // The callback lives in a ref so the mount load can persist without taking
  // onPersist as a dependency, which would re-run the load every time the
  // caller re-created it.
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;

  const persist = useCallback((next: Cart) => {
    onPersistRef.current({
      cartId: next.cartId,
      quantities: quantities.current,
      cart: next,
      fetchedAt: Date.now(),
    });
  }, []);

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
   *
   * Skipped entirely when the persisted body is younger than
   * {@link CART_TTL_MS}, because a remount is not an event worth a round trip.
   *
   * Claude destroys and recreates the widget iframe as the buyer scrolls,
   * serving it the cached HTML — so there is no `resources/read` to notice,
   * and every in-document latch resets. Measured: `OPTIONS /api/shop/cart`
   * (a CORS preflight is cached per document, so a fresh one means a fresh
   * document) at 22:48:29 and again at 22:52:25, each followed by an
   * `update_cart` for a cart that had already been paid for. A host reload
   * does the same to every widget in the conversation at once — three
   * widgets, three carts, three calls, twice over — and Shopify has answered
   * the accumulated volume with `429 Rate limit exceeded`.
   *
   * Confirmed: two reloads of a three-flow conversation, zero calls to the
   * store, and the buyer's items still on screen afterwards — the only way
   * they can be there is the seed above. Same session, 13 upstream calls
   * against 19–20 before.
   */
  useEffect(() => {
    const existing = cartId.current;
    const cachedAt = persistedFetchedAt.current;
    if (!existing) return;
    if (cachedAt !== undefined && Date.now() - cachedAt < CART_TTL_MS) return;

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
        persist(next);
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
    // Everything read above is a ref this hook owns from here on, so this
    // runs exactly once per mount — which is the point.
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

        const next = body as Cart & { unavailableVariantIds?: string[] };
        cartId.current = next.cartId;
        // Re-seed from the server's answer: it is the only authority on what
        // is in the cart after discounts and availability limits apply.
        quantities.current = Object.fromEntries(
          next.lines.map((line) => [line.variantId, line.quantity]),
        );
        setCart(next);
        // Shopify drops a line it will not sell and still answers 200 with a
        // valid cart, so a refusal is indistinguishable from an empty cart —
        // the buyer taps Add, nothing appears, and nothing says why. The
        // server flags the ids it asked for and did not get back.
        setError(
          next.unavailableVariantIds?.length
            ? "That option is out of stock, so it wasn't added."
            : null,
        );
        persist(next);
      } catch (caught) {
        quantities.current = previous;
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, persist],
  );

  return { cart, busy, error, setQuantity };
}
