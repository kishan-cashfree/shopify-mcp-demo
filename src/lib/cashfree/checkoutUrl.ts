import type { CashfreeEnvironment } from "./config";

const HOSTS: Record<CashfreeEnvironment, string> = {
  sandbox: "https://sandbox.cashfree.com",
  production: "https://api.cashfree.com",
};

/**
 * The picker's codes mapped onto the hosted page's own method routes.
 *
 * These exist so the buyer's choice no longer has to be baked into the order.
 * `order_meta.payment_methods` is settable solely at Create Order, and the
 * order has to exist before that choice is made — its payment_session_id is
 * the `x-chxs-id` OCC login runs against — which is why picking a method used
 * to create a SECOND order. The route takes the choice at open time instead.
 *
 * Measured 2026-08-27 against sandbox.cashfree.com and api.cashfree.com:
 * /checkout/payment-method/{upi,card,net-banking,emi} all return 200 and
 * differ in size from one another, while /payment-method/banana is a hard 404
 * — which is what proves these are real routes and not one single-page app
 * answering every path with the same shell.
 *
 * One card entry, not credit and debit: /payment-method/credit-card and
 * /debit-card are both 404s, so Cashfree serves a single card page. While
 * order_meta carried the filter the picker could tell the two apart; a route
 * cannot, and two rows opening the same screen is a picker lying about what
 * it does.
 *
 * /payment-method/emi answers 200 as well and is deliberately not offered —
 * the screen is three methods, and EMI needs its own eligibility copy.
 */
const METHOD_ROUTES: Record<string, string> = {
  upi: "payment-method/upi",
  card: "payment-method/card",
  nb: "payment-method/net-banking",
};

/**
 * Cashfree's hosted checkout page for a payment session.
 *
 * This is the URL cashfree-here's own CheckoutTool opens in external mode, so
 * it is their sanctioned entry point rather than one invented here. Verified
 * live returning the Cashfree Checkout page.
 *
 * Used for the fallback link shown when the host suppresses a payment tool
 * dispatch — a plain anchor the buyer can click, which is the one path
 * measured working in this host.
 */
export function buildHostedCheckoutUrl(
  environment: CashfreeEnvironment,
  paymentSessionId: string,
  method?: string,
): string {
  // An unmapped method falls back to the whole page rather than building a URL
  // Cashfree will 404. The buyer picks again on Cashfree's own page, which is
  // worse than the deep link and far better than an error page reached after
  // they have already committed to paying.
  const route = method ? METHOD_ROUTES[method] : undefined;
  const path = route ? `/checkout/${route}` : "/checkout";
  return `${HOSTS[environment]}${path}?pt=${encodeURIComponent(paymentSessionId)}`;
}
