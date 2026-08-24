import { useCallback, useEffect, useState } from "react";
import { PRODUCTS_PER_PAGE, Results } from "./Results";
import { CartView } from "./Cart";
import { ProductDetail } from "./ProductDetail";
import { formatMoney } from "../lib/ucp/normalise";
import { useCart, type CartSnapshot } from "../hooks/useCart";
import { useWidgetState } from "../hooks/useWidgetState";
import { useCheckoutFlow } from "../hooks/useCheckoutFlow";
import { useOrderStatus } from "../hooks/useOrderStatus";
import { useProducts } from "../hooks/useProducts";
import { applySearchResult } from "../lib/widget/session";
import { PhoneEntry } from "./PhoneEntry";
import { OtpEntry } from "./OtpEntry";
import { AddressStep } from "./AddressStep";
import { MethodSelector } from "./MethodSelector";
import { PaymentResult } from "./PaymentResult";
import type {
  CheckoutSnapshot,
  Product,
  Screen,
  ToolResponseMetadata,
  WidgetState,
} from "../types";

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

/**
 * How long to wait for a tool result before trusting persisted state.
 *
 * Claude re-delivers the cached result on remount within milliseconds, so the
 * stale receipt this protects against never gets painted. ChatGPT never
 * re-delivers it at all, and waiting forever would strand a buyer mid-payment
 * on a placeholder.
 */
const TOOL_RESULT_GRACE_MS = 1_500;

export function App({ toolMeta, toolInput }: AppProps) {
  const query = (toolInput as { query?: string } | null)?.query ?? "";

  // Persisted through the host so a re-render does not discard the cart the
  // user has already built — the body included. This used to keep only the id
  // and quantities and refetch the rest, on the assumption that a remount was
  // rare. It is not: Claude recreates the widget iframe as the buyer scrolls,
  // so a refetch-on-mount is a Shopify call per scroll cycle per widget.
  const [widgetState, setWidgetState] = useWidgetState<WidgetState>({
    screen: "results",
    quantities: {},
  });

  // A search result the widget has not shown yet means the buyer asked to
  // browse, so the grid is what they get — whatever screen the previous widget
  // instance left behind in host state. See applySearchResult for the rest.
  const searchId = toolMeta?.searchId;

  // Derived during render, not in the effect below, because an effect paints
  // the old screen first. A buyer who asked for pants watched the previous
  // order's "Payment received" appear and then get replaced. Rendering from
  // the reset value means that frame never exists; the effect only persists
  // what is already on screen.
  const effective = applySearchResult(widgetState, searchId, query);
  useEffect(() => {
    setWidgetState((prev) => applySearchResult(prev, searchId, query));
  }, [searchId, query, setWidgetState]);

  // A reload remounts the widget without re-running the tool, and ChatGPT
  // hands back no catalog, so the widget asks our own server instead.
  const products = useProducts(
    BASE_URL,
    toolMeta?.products ?? [],
    effective.query,
    effective.screen === "results",
  );

  const [graceExpired, setGraceExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceExpired(true), TOOL_RESULT_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Remounts the shopping session whenever a new search resets it.
   *
   * useCart and useCheckoutFlow seed their state at mount and never re-read
   * what they were passed, so they — not widget state — are the real owners.
   * Clearing widget state alone changed nothing and the hooks wrote their
   * stale values straight back: measured, the paid cart id reappeared one
   * render after the reset, and the buyer's next item was added to a cart
   * Shopify had already completed.
   *
   * Keying on the search id makes React discard that state instead, so the
   * hooks re-seed from the widget state the reset just wrote.
   */
  // Before the first tool result there is no searchId, so applySearchResult
  // cannot tell a finished payment from a live one and leaves state alone.
  // The widget then paints whatever localStorage held — measured at 23:24:37
  // as the previous order's receipt, shown while the cart loaded behind it.
  //
  // A payment that already went out belongs to the widget that ran it, so it
  // is never worth restoring into a new one. Everything earlier in the flow
  // still restores immediately: an unfinished checkout is exactly what this
  // state exists to protect.
  if (
    toolMeta === null &&
    !graceExpired &&
    effective.checkout?.step === "paying"
  ) {
    return <Waiting />;
  }

  return (
    <StoreSession
      key={effective.lastSearchId ?? "initial"}
      products={products}
      query={effective.query ?? query}
      storeName={toolMeta?.storeName}
      widgetState={effective}
      setWidgetState={setWidgetState}
    />
  );
}

/** Shown whenever there is nothing trustworthy to render yet. */
function Waiting() {
  return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-sm text-secondary">Searching the store…</p>
    </div>
  );
}

interface StoreSessionProps {
  /** Credited in the grid header. Absent until a tool result carries it. */
  storeName?: string;
  products: Product[];
  query: string;
  widgetState: WidgetState;
  setWidgetState: (update: (prev: WidgetState) => WidgetState) => void;
}

function StoreSession({
  products,
  query,
  storeName,
  widgetState,
  setWidgetState,
}: StoreSessionProps) {
  const screen = widgetState.screen;
  const setScreen = useCallback(
    (next: Screen) => setWidgetState((prev) => ({ ...prev, screen: next })),
    [setWidgetState],
  );

  // Both ids are set together: opening a product without seeding a variant
  // would render the detail screen's fallback instead of the variant the card
  // was priced from.
  const openProduct = useCallback(
    (productId: string) =>
      setWidgetState((prev) => {
        const product = products.find((p) => p.id === productId);
        const variant =
          product?.variants.find((v) => v.available) ?? product?.variants[0];
        return {
          ...prev,
          screen: "product" as Screen,
          selectedProductId: productId,
          selectedVariantId: variant?.id,
        };
      }),
    [products, setWidgetState],
  );

  const selectVariant = useCallback(
    (variantId: string) =>
      setWidgetState((prev) => ({ ...prev, selectedVariantId: variantId })),
    [setWidgetState],
  );

  const handlePersist = useCallback(
    (snapshot: CartSnapshot) =>
      setWidgetState((prev) => ({
        ...prev,
        cartId: snapshot.cartId,
        quantities: snapshot.quantities,
        cart: snapshot.cart,
        cartFetchedAt: snapshot.fetchedAt,
      })),
    [setWidgetState],
  );

  const { cart, busy, error, setQuantity } = useCart(
    BASE_URL,
    {
      cartId: widgetState.cartId,
      quantities: widgetState.quantities,
      cart: widgetState.cart,
      fetchedAt: widgetState.cartFetchedAt,
    },
    handlePersist,
  );

  const persistCheckout = useCallback(
    (checkout: CheckoutSnapshot) =>
      setWidgetState((prev) => ({ ...prev, checkout })),
    [setWidgetState],
  );

  const flow = useCheckoutFlow(
    BASE_URL,
    widgetState.checkout ?? { step: "phone" },
    persistCheckout,
  );

  const order = useOrderStatus(
    BASE_URL,
    flow.step === "paying" ? flow.orderId : null,
  );

  if (screen === "product") {
    const product = products.find(
      (p) => p.id === widgetState.selectedProductId,
    );
    // A reload can restore `screen: "product"` before the catalog is back —
    // ChatGPT does not hand the tool result to a remounted widget, so
    // useProducts refetches from /api/shop/search and products is briefly
    // empty. Falling through to the grid beats rendering nothing.
    if (product) {
      return (
        <ProductDetail
          product={product}
          selectedVariantId={widgetState.selectedVariantId}
          cart={cart}
          busy={busy}
          onSelectVariant={selectVariant}
          onQuantityChange={(variantId, quantity) => {
            void setQuantity(variantId, quantity);
          }}
          onViewCart={() => setScreen("cart")}
          onBack={() => setScreen("results")}
        />
      );
    }
  }

  if (screen === "cart") {
    return (
      <CartView
        cart={cart}
        busy={busy}
        error={error}
        onQuantityChange={(variantId, quantity) => {
          void setQuantity(variantId, quantity);
        }}
        onCheckout={() => setScreen("checkout")}
        onBack={() => setScreen("results")}
      />
    );
  }

  if (screen === "checkout") {
    // One switch, one source of truth. The flow hook owns every transition;
    // App decides only when to leave checkout entirely.
    if (flow.step === "phone") {
      return (
        <PhoneEntry
          busy={flow.busy}
          error={flow.error}
          onSubmit={(phone) => {
            if (cart) void flow.start(cart.cartId, phone);
          }}
          onBack={() => setScreen("cart")}
        />
      );
    }

    if (flow.step === "otp") {
      return (
        <OtpEntry
          phone={flow.phone ?? ""}
          busy={flow.busy}
          error={flow.error}
          onSubmit={(otp) => void flow.submitOtp(otp)}
          onResend={() => void flow.resendOtp()}
          onBack={() => flow.reset()}
        />
      );
    }

    if (flow.step === "address") {
      return (
        <AddressStep
          addresses={flow.addresses}
          busy={flow.busy}
          error={flow.error}
          onSelect={flow.selectAddress}
          onCreate={(address) => void flow.createAddress(address)}
          onBack={() => setScreen("cart")}
        />
      );
    }

    if (
      flow.step === "method" &&
      flow.paymentSessionId &&
      flow.orderId &&
      flow.checkoutUrl
    ) {
      return (
        <MethodSelector
          baseUrl={BASE_URL}
          checkoutUrl={flow.checkoutUrl}
          paymentSessionId={flow.paymentSessionId}
          orderId={flow.orderId}
          // Creates the payable order carrying the buyer's chosen filter. The
          // login order above cannot carry it: order_meta is fixed at Create
          // Order, and that one had to exist before OTP could run.
          onPayWithMethods={(codes) =>
            cart
              ? flow.payWithMethods(cart.cartId, codes)
              : Promise.resolve(null)
          }
          // Matches the customer_id the order was created with, in orders.ts.
          customerId={`mcp_${flow.phone ?? ""}`}
          amountLabel={cart ? formatMoney(cart.total) : ""}
          onDispatched={flow.markDispatched}
          // One stage back, to the address list. Dropping to the cart here
          // left the buyer re-entering checkout to change a delivery address.
          onBack={() => void flow.backToAddress()}
        />
      );
    }

    return (
      <PaymentResult
        cart={cart}
        shippingAddress={flow.shippingAddress}
        orderId={flow.orderId ?? ""}
        status={order.status}
        timedOut={order.timedOut}
        polling={order.polling}
        onStopWaiting={order.stop}
        onRetry={flow.backToPayment}
        onBack={() => setScreen(order.status === "PAID" ? "results" : "cart")}
      />
    );
  }

  if (products.length === 0) {
    return <Waiting />;
  }

  return (
    <Results
      products={products}
      query={query}
      storeName={storeName}
      cart={cart}
      busy={busy}
      onOpenProduct={openProduct}
      onQuantityChange={(variantId, quantity) => {
        void setQuantity(variantId, quantity);
      }}
      onViewCart={() => setScreen("cart")}
      visibleCount={widgetState.visibleProducts ?? PRODUCTS_PER_PAGE}
      onShowMore={() =>
        setWidgetState((prev) => ({
          ...prev,
          visibleProducts:
            (prev.visibleProducts ?? PRODUCTS_PER_PAGE) + PRODUCTS_PER_PAGE,
        }))
      }
    />
  );
}
