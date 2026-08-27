import { describe, it, expect } from "vitest";
import { buildHostedCheckoutUrl } from "./checkoutUrl";

describe("buildHostedCheckoutUrl", () => {
  it("builds the sandbox url cashfree-here's CheckoutTool opens", () => {
    expect(buildHostedCheckoutUrl("sandbox", "session_abc")).toBe(
      "https://sandbox.cashfree.com/checkout?pt=session_abc",
    );
  });

  it("builds the production url", () => {
    expect(buildHostedCheckoutUrl("production", "session_abc")).toBe(
      "https://api.cashfree.com/checkout?pt=session_abc",
    );
  });

  it("encodes the session id, since it is a query parameter here", () => {
    expect(buildHostedCheckoutUrl("sandbox", "a b+c")).toContain("a%20b%2Bc");
  });
});

/**
 * Deep links into the hosted page's own method routes.
 *
 * These replace `order_meta.payment_methods`, which is settable only at Create
 * Order and so forced a second order to be created once the buyer had picked.
 * The routes take the choice at open time instead, off the one session that
 * already exists.
 *
 * Measured 2026-08-27 against both hosts: /checkout/payment-method/{upi,card,
 * net-banking,emi} return 200 and differ in size from each other, while an
 * invented method — /payment-method/banana — is a hard 404. The 404 is what
 * rules out a single-page app answering every path with the same shell.
 */
describe("buildHostedCheckoutUrl — method routes", () => {
  it("opens the UPI route", () => {
    expect(buildHostedCheckoutUrl("sandbox", "session_abc", "upi")).toBe(
      "https://sandbox.cashfree.com/checkout/payment-method/upi?pt=session_abc",
    );
  });

  it("opens the netbanking route, which is hyphenated", () => {
    // /payment-method/netbanking is a 404. The hyphen is not cosmetic.
    expect(buildHostedCheckoutUrl("sandbox", "session_abc", "nb")).toBe(
      "https://sandbox.cashfree.com/checkout/payment-method/net-banking?pt=session_abc",
    );
  });

  // One card route, and one card option on the picker to match.
  // /payment-method/credit-card and /debit-card are both 404s, so Cashfree
  // serves a single card page and a picker that split credit from debit was
  // offering two rows that did the same thing.
  it("opens the card route", () => {
    expect(buildHostedCheckoutUrl("sandbox", "session_abc", "card")).toBe(
      "https://sandbox.cashfree.com/checkout/payment-method/card?pt=session_abc",
    );
  });

  // The codes the picker retired. They must not resolve to a route by
  // accident: a stale snapshot restoring "cc" should fall back to the whole
  // page, not silently keep working and hide that the code is gone.
  it("does not answer the retired credit and debit codes", () => {
    const whole = "https://sandbox.cashfree.com/checkout?pt=session_abc";
    expect(buildHostedCheckoutUrl("sandbox", "session_abc", "cc")).toBe(whole);
    expect(buildHostedCheckoutUrl("sandbox", "session_abc", "dc")).toBe(whole);
  });

  it("works the same on production", () => {
    expect(buildHostedCheckoutUrl("production", "session_abc", "upi")).toBe(
      "https://api.cashfree.com/checkout/payment-method/upi?pt=session_abc",
    );
  });

  /**
   * A method with no route falls back to the full page rather than building a
   * URL Cashfree will 404. The buyer then picks again on Cashfree's own page,
   * which is a worse experience than the deep link and a far better one than
   * an error page after they have already committed to paying.
   */
  it("falls back to the whole page for a method it has no route for", () => {
    expect(
      buildHostedCheckoutUrl("sandbox", "session_abc", "wallet" as never),
    ).toBe("https://sandbox.cashfree.com/checkout?pt=session_abc");
  });
});
