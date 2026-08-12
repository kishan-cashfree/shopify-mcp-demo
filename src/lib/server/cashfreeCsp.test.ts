import { describe, it, expect } from "vitest";
import { CASHFREE_PAYMENT_HOSTS, augmentCashfreeCsp } from "./cashfreeCsp";

function widgetResult() {
  return {
    contents: [
      {
        uri: "ui://cashfree/payment.html",
        _meta: {
          "openai/widgetCSP": {
            connect_domains: [
              "https://sandbox.cashfree.com",
              "https://sdk.cashfree.com",
            ],
            frame_domains: ["https://sandbox.cashfree.com"],
            resource_domains: ["https://sdk.cashfree.com"],
          },
          ui: {
            csp: {
              connectDomains: ["https://sandbox.cashfree.com"],
              frameDomains: ["https://sandbox.cashfree.com"],
            },
          },
        },
      },
    ],
  };
}

describe("augmentCashfreeCsp", () => {
  it("adds the payments hosts the checkout SDK connects to", () => {
    const csp = augmentCashfreeCsp(widgetResult()).contents[0]._meta[
      "openai/widgetCSP"
    ];

    for (const host of CASHFREE_PAYMENT_HOSTS) {
      // Without these the frame loads and hangs on "Establishing secure
      // connection…" — allowed to appear, not allowed to talk.
      expect(csp.connect_domains).toContain(host);
      expect(csp.frame_domains).toContain(host);
    }
  });

  it("mirrors the additions into the ui.csp block", () => {
    const ui = augmentCashfreeCsp(widgetResult()).contents[0]._meta.ui.csp;

    for (const host of CASHFREE_PAYMENT_HOSTS) {
      expect(ui.connectDomains).toContain(host);
      expect(ui.frameDomains).toContain(host);
    }
  });

  it("keeps the hosts the package already allows", () => {
    const csp = augmentCashfreeCsp(widgetResult()).contents[0]._meta[
      "openai/widgetCSP"
    ];

    expect(csp.connect_domains).toContain("https://sdk.cashfree.com");
    expect(csp.resource_domains).toEqual(["https://sdk.cashfree.com"]);
  });

  it("does not duplicate a host the package later adds itself", () => {
    const input = widgetResult();
    input.contents[0]._meta["openai/widgetCSP"].connect_domains.push(
      CASHFREE_PAYMENT_HOSTS[0],
    );

    const csp = augmentCashfreeCsp(input).contents[0]._meta["openai/widgetCSP"];

    expect(
      csp.connect_domains.filter((d) => d === CASHFREE_PAYMENT_HOSTS[0]),
    ).toHaveLength(1);
  });

  it("passes through a result carrying no CSP metadata", () => {
    expect(() =>
      augmentCashfreeCsp({ contents: [{ uri: "ui://cashfree/payment.html" }] }),
    ).not.toThrow();
  });
});
