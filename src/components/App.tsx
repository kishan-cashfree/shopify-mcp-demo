import { useCallback, useState } from "react";
import { Results } from "./Results";
import { CartView } from "./Cart";
import { useCart, type CartSnapshot } from "../hooks/useCart";
import { useWidgetState } from "../hooks/useWidgetState";
import type { ToolResponseMetadata, WidgetState } from "../types";

interface AppProps {
  toolMeta: ToolResponseMetadata | null;
  toolInput: unknown;
}

/**
 * The widget calls its own server. The origin is injected into the widget HTML
 * at assembly time, because the bundle is built before the server knows its own
 * public origin — so a Vite-time constant could never carry an ngrok URL.
 */
const BASE_URL =
  (window as { __SERVER_URL__?: string }).__SERVER_URL__ ??
  "http://localhost:8787";

export function App({ toolMeta, toolInput }: AppProps) {
  const products = toolMeta?.products ?? [];
  const query = (toolInput as { query?: string } | null)?.query ?? "";

  // Persisted through the host so a re-render does not discard the cart the
  // user has already built. Only the cart id and desired quantities are kept —
  // the cart body is re-fetched, because Shopify is the authority on it.
  const [widgetState, setWidgetState] = useWidgetState<WidgetState>({
    screen: "results",
    quantities: {},
  });

  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const screen = widgetState.screen;
  const setScreen = useCallback(
    (next: "results" | "cart") =>
      setWidgetState((prev) => ({ ...prev, screen: next })),
    [setWidgetState],
  );

  const handlePersist = useCallback(
    (snapshot: CartSnapshot) =>
      setWidgetState((prev) => ({
        ...prev,
        cartId: snapshot.cartId,
        quantities: snapshot.quantities,
      })),
    [setWidgetState],
  );

  const { cart, busy, error, setQuantity } = useCart(
    BASE_URL,
    { cartId: widgetState.cartId, quantities: widgetState.quantities },
    handlePersist,
  );

  const handleAdd = useCallback(
    async (variantId: string) => {
      const existing =
        cart?.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
      await setQuantity(variantId, existing + 1);
      setScreen("cart");
    },
    [cart, setQuantity, setScreen],
  );

  const handleCheckout = useCallback(() => {
    if (!cart) return;
    // Synchronous inside the click handler. Awaiting anything first is exactly
    // what popup blockers suppress, and a blocked window.open fails silently.
    const opened = window.open(
      cart.continueUrl,
      "_blank",
      "noopener,noreferrer",
    );
    if (opened) {
      setCheckoutOpened(true);
      setPopupBlocked(false);
    } else {
      setPopupBlocked(true);
    }
  }, [cart]);

  if (screen === "cart") {
    return (
      <CartView
        cart={cart}
        busy={busy}
        error={error}
        checkoutOpened={checkoutOpened}
        popupBlocked={popupBlocked}
        onQuantityChange={(variantId, quantity) => {
          void setQuantity(variantId, quantity);
        }}
        onCheckout={handleCheckout}
        onBack={() => setScreen("results")}
      />
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-secondary">Searching the store…</p>
      </div>
    );
  }

  return (
    <Results
      products={products}
      query={query}
      onAdd={(variantId) => {
        void handleAdd(variantId);
      }}
    />
  );
}
