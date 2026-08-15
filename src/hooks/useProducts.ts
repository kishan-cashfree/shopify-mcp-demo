import { useEffect, useState } from "react";
import type { Product } from "../lib/ucp/types";

/**
 * The products to render, from the host if it has them and from our own server
 * if it does not.
 *
 * A host reload remounts the widget but does not re-run the tool. Measured in
 * ChatGPT: four `resources/read` after the last `SearchProducts`, and
 * `window.openai.toolResponseMetadata` empty afterwards — so the catalog was
 * simply gone and the grid sat on "Searching the store…" with nothing able to
 * clear it, because only another search would have. Claude re-delivers the
 * cached result and never reaches the fetch below.
 *
 * The host's copy always wins when present: it is the one the model is
 * talking about.
 *
 * It also waits before firing. On a reload the widget remounts holding a
 * stored query but no products, so the fallback used to race the host and
 * lose: Claude delivers the cached result milliseconds later and the fetch
 * was pure waste. Every live widget did this for its own catalog on every
 * remount, which is how one session reached 35 catalog fetches and Shopify
 * answered `429 Rate limit exceeded`. ChatGPT never delivers, so there the
 * fetch still happens — just a moment later.
 *
 * Gated on actually needing a grid. Every earlier widget in a conversation
 * stays live and each recovers independently, which turned into 35 catalog
 * fetches in one session — most of them for widgets parked on a checkout
 * screen that renders no products. Shopify answered the resulting volume with
 * `429 Rate limit exceeded` on update_cart, and the buyer's cart went empty.
 */
/**
 * How long to let the host deliver before asking the store ourselves.
 *
 * Long enough that Claude's cached re-delivery always wins the race, short
 * enough that a ChatGPT reload does not sit on an empty grid.
 */
const HOST_DELIVERY_GRACE_MS = 1_200;

export function useProducts(
  baseUrl: string,
  hostProducts: Product[],
  query: string | undefined,
  /** False on screens that never render a grid. See the note on volume below. */
  needed: boolean,
): Product[] {
  const [recovered, setRecovered] = useState<Product[]>([]);
  const hasHostProducts = hostProducts.length > 0;

  useEffect(() => {
    if (!needed || hasHostProducts || !query) return;

    let cancelled = false;
    const timer = setTimeout(() => void recover(), HOST_DELIVERY_GRACE_MS);

    async function recover() {
      try {
        const response = await fetch(`${baseUrl}/api/shop/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { products?: Product[] };
        if (!cancelled && body.products) setRecovered(body.products);
      } catch {
        // An empty grid is already the failure state, and an error banner on
        // arrival would be worse than the buyer simply asking again.
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [baseUrl, hasHostProducts, query, needed]);

  return hasHostProducts ? hostProducts : recovered;
}
