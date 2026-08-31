import type { WidgetState } from "../../types";

/**
 * Folds a freshly-arrived search result into the persisted widget state.
 *
 * The host keeps widget state for the whole conversation and re-hydrates every
 * new widget instance from it. So a second `SearchProducts` call renders a
 * widget that wakes up holding `screen: "checkout"` from the last one, and
 * shows the payment receipt instead of the products the server just returned.
 * Measured: the server answered the second search at 21:04:54 with 200 in
 * 411ms, and the buyer was looking at "Payment received".
 *
 * Asking to browse is unambiguous — it means show me products. So a search id
 * we have not seen before returns the buyer to the results grid.
 */
export function applySearchResult(
  prev: WidgetState,
  searchId: string | undefined,
  query?: string,
  /** The range this search was made with, in major units. */
  price?: { min?: number; max?: number },
): WidgetState {
  // An unstamped result carries no way to tell a new search from a re-render,
  // and guessing would reset the screen under a buyer mid-checkout on every
  // repaint. Leaving state alone is the safe reading.
  if (!searchId || searchId === prev.lastSearchId) return prev;

  const next: WidgetState = {
    ...prev,
    lastSearchId: searchId,
    screen: "results",
    // Asking to browse means show me products, so the detail screen's
    // selection goes with the screen. Left behind, it would re-open on a
    // product the new search never returned.
    selectedProductId: undefined,
    selectedVariantId: undefined,
    // The expanded grid belongs to the result set it was expanded against. Kept
    // across a new search, a buyer who had paged through 30 perfumes would land
    // on the next search already scrolled past its first page.
    visibleProducts: undefined,
    // Kept so the widget can re-fetch its own catalog after a reload.
    query: query ?? prev.query,
    // Taken from THIS search, not carried forward: the range belongs to the
    // result set, so "show me perfumes" after "perfumes under 5k" must come
    // back uncapped rather than quietly hiding the expensive ones.
    priceMin: price?.min,
    priceMax: price?.max,
  };

  // Payment was already dispatched for this cart, so it is spent: adding to it
  // would push items into a cart Shopify has completed. Browsing after paying
  // is a new shopping trip, and it starts empty.
  //
  // This does cost the retry path on a failed payment — but a buyer who wanted
  // to retry would have used the retry button in front of them, not asked to
  // see shirts again.
  if (prev.checkout?.step === "paying") {
    return { ...next, cartId: undefined, quantities: {}, checkout: undefined };
  }

  return next;
}
