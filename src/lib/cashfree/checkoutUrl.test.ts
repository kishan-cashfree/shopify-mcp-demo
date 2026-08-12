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
