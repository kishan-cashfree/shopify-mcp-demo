import type { CashfreeEnvironment } from "./config";

const HOSTS: Record<CashfreeEnvironment, string> = {
  sandbox: "https://sandbox.cashfree.com",
  production: "https://api.cashfree.com",
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
): string {
  return `${HOSTS[environment]}/checkout?pt=${encodeURIComponent(paymentSessionId)}`;
}
