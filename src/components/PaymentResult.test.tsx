import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentResult } from "./PaymentResult";
import type { Cart } from "../lib/ucp/types";

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

const BASE = {
  cart: CART,
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

  it("carries the order id and status a buyer would quote to support", () => {
    render(<PaymentResult {...BASE} status="PAID" polling={false} />);

    expect(screen.getByText("order_4303293Hqul")).toBeInTheDocument();
    expect(screen.getByText("PAID")).toBeInTheDocument();
  });

  it("offers no way out once the order is paid", () => {
    render(<PaymentResult {...BASE} status="PAID" polling={false} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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

});
