import { useCallback } from "react";
import { Results } from "./Results";
import { CartView } from "./Cart";
import { formatMoney } from "../lib/ucp/normalise";
import { useCart, type CartSnapshot } from "../hooks/useCart";
import { useWidgetState } from "../hooks/useWidgetState";
import { useCheckoutFlow } from "../hooks/useCheckoutFlow";
import { useOrderStatus } from "../hooks/useOrderStatus";
import { PhoneEntry } from "./PhoneEntry";
import { OtpEntry } from "./OtpEntry";
import { AddressStep } from "./AddressStep";
import { MethodSelector } from "./MethodSelector";
import { PaymentResult } from "./PaymentResult";
import type {
  CheckoutSnapshot,
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

  const screen = widgetState.screen;
  const setScreen = useCallback(
    (next: Screen) => setWidgetState((prev) => ({ ...prev, screen: next })),
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
          // Matches the customer_id the order was created with, in orders.ts.
          customerId={`mcp_${flow.phone ?? ""}`}
          amountLabel={cart ? formatMoney(cart.total) : ""}
          onDispatched={flow.markDispatched}
          onBack={() => setScreen("cart")}
        />
      );
    }

    return (
      <PaymentResult
        cart={cart}
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
      cart={cart}
      busy={busy}
      onQuantityChange={(variantId, quantity) => {
        void setQuantity(variantId, quantity);
      }}
      onViewCart={() => setScreen("cart")}
    />
  );
}
