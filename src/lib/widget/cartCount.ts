import type { Cart } from "../ucp/types";

/**
 * How many items are in the cart, for the badge both the grid and the detail
 * screen render.
 *
 * Derived on every render rather than stored. The two screens cannot disagree
 * because there is no counter to keep in step: `useCart.setQuantity` is the
 * only path that mutates a cart, and it re-seeds from the server's answer.
 */
export function cartItemCount(cart: Cart | null | undefined): number {
  return (cart?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
}
