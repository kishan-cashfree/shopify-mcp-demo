import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentResult } from "./PaymentResult";
import type { Cart } from "../lib/ucp/types";
import type { OccAddress } from "../lib/cashfree/occ";

const CART: Cart = {
  cartId: "gid://shopify/Cart/1",
  currency: "INR",
  lines: [
    {
      lineId: "l1",
      variantId: "v1",
      title: "Afnan 9PM EDP for Men",
      imageUrl: "https://cdn.example/9pm.jpg",
      quantity: 2,
      unitPrice: { amountMinor: 302500, currency: "INR" },
      lineSubtotal: { amountMinor: 605000, currency: "INR" },
      lineTotal: { amountMinor: 605000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 605000, currency: "INR" },
  total: { amountMinor: 605000, currency: "INR" },
  continueUrl: "https://belvish.myshopify.com/checkouts/cn/abc",
};

const ADDRESS: OccAddress = {
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

const BASE = {
  cart: CART,
  shippingAddress: null as OccAddress | null,
  orderId: "order_4303293Hqul",
  status: null as string | null,
  timedOut: false,
  polling: true,
  onStopWaiting: vi.fn(),
  onRetry: vi.fn(),
  onBack: vi.fn(),
};

describe("PaymentResult", () => {
  it("keeps the waiting copy true for every payment path", () => {
    // Every flow now lands here, including the in-conversation one where the
    // cashfree-here widget renders in the same chat. Naming a tab was only
    // ever true of the external-link path, and sends the buyer looking for a
    // window that does not exist.
    render(<PaymentResult {...BASE} />);

    expect(screen.getByText(/waiting for payment/i)).toBeInTheDocument();
    expect(screen.queryByText(/tab/i)).not.toBeInTheDocument();
  });

  it("shows the order id while the payment is still open", () => {
    render(<PaymentResult {...BASE} />);

    expect(screen.getByText(/order_4303293Hqul/)).toBeInTheDocument();
  });

  it("itemises what was bought once the payment lands", () => {
    render(<PaymentResult {...BASE} status="PAID" polling={false} />);

    // Scoped to the line, because a single-line cart's line total and its cart
    // total are the same number in two places.
    const line = within(screen.getByRole("listitem"));
    expect(line.getByText("Afnan 9PM EDP for Men")).toBeInTheDocument();
    expect(line.getByText("2 × ₹3,025.00")).toBeInTheDocument();
    expect(line.getByText("₹6,050.00")).toBeInTheDocument();
  });

  it("carries the order id and status a buyer would quote to support", async () => {
    // Behind the Order details toggle on the paid path since the receipt was
    // reordered — one click, not gone. The unpaid paths still show it outright;
    // that is asserted separately.
    render(<PaymentResult {...BASE} status="PAID" polling={false} />);

    await userEvent.click(screen.getByRole("button", { name: /order details/i }));

    expect(screen.getByText("order_4303293Hqul")).toBeInTheDocument();
    expect(screen.getByText("PAID")).toBeInTheDocument();
  });

  it("offers no way out once the order is paid", () => {
    // Narrowed from "no buttons at all" when the receipt gained its Order
    // details toggle. The invariant was never about button count: it is that a
    // finished order offers no route back into the flow it just completed.
    render(<PaymentResult {...BASE} status="PAID" polling={false} />);

    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /payment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cart/i })).not.toBeInTheDocument();
  });

  it("routes a failed payment back to the method picker", async () => {
    const onRetry = vi.fn();
    render(
      <PaymentResult
        {...BASE}
        status="FAILED"
        polling={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /back to payment/i }),
    );

    expect(onRetry).toHaveBeenCalled();
  });

  it("stays non-committal when it could not confirm the outcome", () => {
    // A timeout means we do not know. Telling a buyer their payment failed
    // when their account may have been debited is the worst thing this widget
    // can do.
    render(<PaymentResult {...BASE} timedOut polling={false} />);

    expect(screen.getByText(/couldn’t confirm this yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/didn’t go through/i)).not.toBeInTheDocument();
  });

  it("lets a buyer call off a poll they no longer want", async () => {
    const onStopWaiting = vi.fn();
    render(<PaymentResult {...BASE} onStopWaiting={onStopWaiting} />);

    await userEvent.click(screen.getByRole("button", { name: /stop waiting/i }));

    expect(onStopWaiting).toHaveBeenCalled();
  });

  it("carries the Cashfree assurance the earlier steps show", () => {
    // Phone entry and OTP both footer this. A checkout that drops it partway
    // reads as having handed the buyer somewhere else mid-payment.
    render(<PaymentResult {...BASE} />);

    expect(screen.getByText(/secured by/i)).toBeInTheDocument();
    expect(screen.getByText("Cashfree")).toBeInTheDocument();
  });


  describe("the paid receipt", () => {
    const PAID = { ...BASE, status: "PAID", polling: false, shippingAddress: ADDRESS };

    it("leads with confirmation and a tick", () => {
      render(<PaymentResult {...PAID} />);

      // Asserted from the tick outwards rather than the heading inwards: the
      // footer's Cashfree symbol is also an aria-hidden svg, so a
      // document-wide query for one passes without a tick ever being drawn.
      const marks = [...document.querySelectorAll("svg[aria-hidden='true']")];
      const tick = marks.find((svg) =>
        svg.parentElement?.textContent?.includes("Payment received"),
      );

      expect(screen.getByText("Payment received")).toBeInTheDocument();
      expect(tick).toBeDefined();
    });

    it("orders the receipt confirmation, address, items, then details", () => {
      const { container } = render(<PaymentResult {...PAID} />);
      const text = container.textContent ?? "";

      const confirm = text.indexOf("Payment received");
      const address = text.indexOf("Karle Town Centre");
      const item = text.indexOf("Afnan 9PM EDP for Men");
      const details = text.indexOf("Order details");

      expect(confirm).toBeGreaterThanOrEqual(0);
      expect(address).toBeGreaterThan(confirm);
      expect(item).toBeGreaterThan(address);
      expect(details).toBeGreaterThan(item);
    });

    it("says where the order is going", () => {
      render(<PaymentResult {...PAID} />);

      expect(screen.getByText(/will be shipped to/i)).toBeInTheDocument();
      expect(screen.getByText(/Kishan Kumar Maurya/)).toBeInTheDocument();
      expect(screen.getByText(/560045/)).toBeInTheDocument();
    });

    it("omits the address block when no address reached this screen", () => {
      // selectAddress discarded its argument until now, so an order paid from
      // a widget that reloaded mid-flow can still arrive here with nothing.
      // Better a receipt without the block than the words "shipped to" over a
      // blank line.
      render(<PaymentResult {...PAID} shippingAddress={null} />);

      expect(screen.queryByText(/will be shipped to/i)).toBeNull();
      expect(screen.getByText("Payment received")).toBeInTheDocument();
    });

    it("keeps the order details collapsed until asked", async () => {
      render(<PaymentResult {...PAID} />);

      const toggle = screen.getByRole("button", { name: /order details/i });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(PAID.orderId)).toBeNull();

      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(PAID.orderId)).toBeInTheDocument();
    });

    it("still shows the order id outright when the payment did not succeed", async () => {
      // The id is the only thing a buyer can quote to support, and a failure is
      // exactly when they need it. Collapsing it behind a toggle on the paths
      // that go wrong would bury it.
      render(<PaymentResult {...BASE} status="FAILED" polling={false} />);

      expect(screen.getByText(BASE.orderId)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /order details/i })).toBeNull();
    });
  });
});

/**
 * The store's own order number, once the paid Cashfree order has been placed
 * on Shopify.
 *
 * It matters more to the buyer than the Cashfree order id does: it is the
 * number the merchant's emails, packing slip and support desk all use. The
 * Cashfree id stays, because it is the one that identifies the payment.
 */
describe("PaymentResult — the Shopify order", () => {
  const SHOPIFY = { id: "gid://shopify/Order/55", name: "#1042" };

  it("names the store's order once it exists", () => {
    render(
      <PaymentResult
        {...BASE}
        status="PAID"
        polling={false}
        shopifyOrder={SHOPIFY}
      />,
    );

    expect(screen.getByText(/#1042/)).toBeInTheDocument();
  });

  /**
   * The payment is real whether or not the order reached Shopify. Showing a
   * receipt that hedges on it would tell a buyer whose money is gone that
   * something may be wrong, when the thing that failed is ours to fix.
   */
  it("says nothing about it when the sync has not landed", () => {
    render(<PaymentResult {...BASE} status="PAID" polling={false} />);

    expect(screen.getByText(/payment received/i)).toBeInTheDocument();
    expect(screen.queryByText(/store order/i)).not.toBeInTheDocument();
  });

  it("keeps it in the order details beside the payment id", async () => {
    render(
      <PaymentResult
        {...BASE}
        status="PAID"
        polling={false}
        shopifyOrder={SHOPIFY}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /order details/i }));

    expect(screen.getByText(/order_4303293Hqul/)).toBeInTheDocument();
    expect(screen.getByText("Store order")).toBeInTheDocument();
  });
});
