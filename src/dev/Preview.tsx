/**
 * A dev-only screen previewer, reachable at `?screen=<name>` under `npm run dev`.
 *
 * Every screen in this widget normally sits behind the real journey — search,
 * cart, order creation, OTP — so looking at the login screen meant paying for a
 * Shopify search and a Cashfree order first, and reaching the payment result
 * meant actually paying. That made UI work slow and, worse, made it tempting to
 * judge a layout from a screenshot instead of the running component.
 *
 * This file is imported behind `import.meta.env.DEV` in `index.tsx`, so Vite
 * drops it and everything it pulls in from the production bundle. It renders
 * screens with stub props only — it never talks to the server, and no state it
 * sets can reach a real cart or order.
 */
import { useState } from "react";
import { PhoneEntry } from "../components/PhoneEntry";
import { OtpEntry } from "../components/OtpEntry";
import { AddressStep } from "../components/AddressStep";
import { PaymentResult } from "../components/PaymentResult";
import { Results } from "../components/Results";
import { ProductDetail } from "../components/ProductDetail";
import { CartView } from "../components/Cart";
import { MethodSelector } from "../components/MethodSelector";
import { formatMoney } from "../lib/ucp/normalise";
import type { Cart, Product } from "../lib/ucp/types";

const inr = (amountMinor: number) => ({ amountMinor, currency: "INR" });

const IMG =
  "https://cdn.shopify.com/s/files/1/0772/1448/2736/products/lattafa-asad.webp";


const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "Lattafa Asad EDP",
    handle: "lattafa-asad-edp",
    imageUrl: IMG,
    description: "Eau de Parfum. Top notes: black pepper, pineapple, tobacco.",
    priceRange: { min: inr(249900), max: inr(429900) },
    variants: [
      { id: "v-50", title: "50ml", price: inr(249900), listPrice: inr(299900), available: true, options: [{ name: "Size", label: "50ml" }] },
      { id: "v-100", title: "100ml", price: inr(429900), listPrice: inr(429900), available: true, options: [{ name: "Size", label: "100ml" }] },
    ],
  },
  {
    id: "gid://shopify/Product/2",
    title: "Oud Mood Elixir",
    handle: "oud-mood-elixir",
    description: "Warm, resinous, long-wearing.",
    priceRange: { min: inr(189900), max: inr(189900) },
    variants: [
      { id: "v-oud", title: "Default Title", price: inr(189900), listPrice: inr(189900), available: true, options: [{ name: "Title", label: "Default Title" }] },
    ],
  },
];

/**
 * A four-line cart with real image URLs.
 *
 * The images matter: a stub without `imageUrl` renders the no-image fallback,
 * which reads as "the cart shows a grey box" when the real cart shows the
 * product. A preview that misrepresents the component is worse than no
 * preview.
 */
const CART: Cart = {
  cartId: "gid://shopify/Cart/preview",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/preview",
  lines: [
    { lineId: "l1", variantId: "v-50", title: "Tom Ford Oud Wood All Over Body Spray - 150ml", imageUrl: IMG, quantity: 1, unitPrice: inr(599900), lineSubtotal: inr(599900), lineTotal: inr(599900) },
    { lineId: "l2", variantId: "v-100", title: "Juicy Couture Viva La Juicy Gold Couture EDP for Women - 100ml", imageUrl: IMG, quantity: 1, unitPrice: inr(605000), lineSubtotal: inr(605000), lineTotal: inr(605000) },
    { lineId: "l3", variantId: "v-ch", title: "Carolina Herrera Good Girl Blush EDP for Women - 80ml", imageUrl: IMG, quantity: 1, unitPrice: inr(955000), lineSubtotal: inr(955000), lineTotal: inr(955000) },
    // Deliberately image-less, so the fallback stays visible in the preview —
    // real carts do contain lines Shopify has no image for.
    { lineId: "l4", variantId: "v-jm", title: "Jo Malone Velvet Rose & Oud Hair Mist - 30ml", quantity: 1, unitPrice: inr(275000), lineSubtotal: inr(275000), lineTotal: inr(275000) },
  ],
  subtotal: inr(2434900),
  discount: { label: "MISTY1200", amount: inr(120000) },
  total: inr(2314900),
};

const ADDRESS = {
  id: "a1",
  customer_name: "Kishan Kumar Maurya",
  address_line_one: "4th Floor, Karle Town Centre, Nagavara",
  address_line_two: "Outer Ring Road",
  city: "Bangalore",
  country: "India",
  country_code: "IN",
  zip_code: "560045",
  state: "Karnataka",
  state_code: "KA",
  phone: "+91 8433719326",
  email: "kishan.maurya@cashfree.com",
};

const noop = () => {};

const SCREENS: Record<string, (busy: boolean, error: string | null) => JSX.Element> = {
  phone: (busy, error) => (
    <PhoneEntry busy={busy} error={error} onSubmit={noop} onBack={noop} />
  ),
  otp: (busy, error) => (
    <OtpEntry phone="8433719326" busy={busy} error={error} onSubmit={noop} onResend={noop} onBack={noop} />
  ),
  address: (busy, error) => (
    <AddressStep addresses={[ADDRESS]} busy={busy} error={error} onSelect={noop} onCreate={noop} onBack={noop} />
  ),
  result: () => (
    <PaymentResult cart={CART} orderId="order_4303293I5YakNvkEWRosz" status="PAID" timedOut={false} polling={false} onStopWaiting={noop} onRetry={noop} onBack={noop} />
  ),
  results: (busy) => (
    <Results products={PRODUCTS} query="perfume" storeName="Belvish" cart={CART} busy={busy} onOpenProduct={noop} onQuantityChange={noop} onViewCart={noop} />
  ),
  product: (busy) => (
    <ProductDetail product={PRODUCTS[0]} selectedVariantId="v-50" cart={CART} busy={busy} onSelectVariant={noop} onQuantityChange={noop} onBack={noop} onViewCart={noop} />
  ),
  cart: (busy, error) => (
    <CartView cart={CART} busy={busy} error={error} onQuantityChange={noop} onCheckout={noop} onBack={noop} />
  ),
  // onPayWithMethods resolves null on purpose: null is the one return value
  // that stops openHostedCheckout before it touches the host bridge, so the
  // preview can exercise the picker and the button's "Opening Cashfree…" state
  // without creating a Cashfree order or opening a tab.
  pay: () => (
    <MethodSelector
      baseUrl="http://localhost:8787"
      paymentSessionId="session_preview"
      orderId="order_preview"
      customerId="cust_preview"
      onPayWithMethods={async () => null}
      checkoutUrl="https://payments.cashfree.com/order/#preview"
      amountLabel={formatMoney(CART.total)}
      onDispatched={noop}
      onBack={noop}
    />
  ),
};

export function Preview() {
  const initial = new URLSearchParams(window.location.search).get("screen") ?? "phone";
  const [screen, setScreen] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const render = SCREENS[screen];

  return (
    <div>
      {/* Dev chrome, deliberately ugly so it is never mistaken for the widget. */}
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-black/30 bg-yellow-100 p-2 text-xs text-black">
        <strong>preview</strong>
        {Object.keys(SCREENS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setScreen(name)}
            className={`rounded px-2 py-1 ${name === screen ? "bg-black text-white" : "bg-white"}`}
          >
            {name}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1">
          <input type="checkbox" checked={busy} onChange={(e) => setBusy(e.target.checked)} />
          busy
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={error} onChange={(e) => setError(e.target.checked)} />
          error
        </label>
        <button
          type="button"
          onClick={() =>
            document.documentElement.setAttribute(
              "data-theme",
              document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark",
            )
          }
          className="rounded bg-white px-2 py-1"
        >
          toggle theme
        </button>
      </div>

      {render ? (
        render(busy, error ? "Something went wrong upstream." : null)
      ) : (
        <p className="p-4 text-sm">
          Unknown screen “{screen}”. Try: {Object.keys(SCREENS).join(", ")}
        </p>
      )}
    </div>
  );
}
