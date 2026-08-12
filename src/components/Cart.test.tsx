import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CartView } from "./Cart";
import type { Cart } from "../lib/ucp/types";

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "gid://shopify/CartLine/1",
      variantId: "gid://shopify/ProductVariant/1",
      title: "short sleeve t-shirt - Red",
      imageUrl: "https://cdn.shopify.com/a.jpg",
      quantity: 2,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 240000, currency: "INR" },
    },
  ],
  total: { amountMinor: 240000, currency: "INR" },
};

const BASE = {
  busy: false,
  error: null,
  checkoutOpened: false,
  popupBlocked: false,
  onQuantityChange: vi.fn(),
  onCheckout: vi.fn(),
  onBack: vi.fn(),
};

describe("CartView", () => {
  it("renders line items and the server-provided total", () => {
    render(<CartView {...BASE} cart={CART} />);

    expect(screen.getByText("short sleeve t-shirt - Red")).toBeInTheDocument();
    expect(screen.getByText(/2,400\.00/)).toBeInTheDocument();
  });

  it("increments through onQuantityChange rather than local state", async () => {
    const onQuantityChange = vi.fn();
    render(
      <CartView {...BASE} cart={CART} onQuantityChange={onQuantityChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /increase/i }));

    expect(onQuantityChange).toHaveBeenCalledWith(
      "gid://shopify/ProductVariant/1",
      3,
    );
    // The displayed quantity must not move until the server confirms.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("decrements to zero so a line can be removed", async () => {
    const onQuantityChange = vi.fn();
    const single = {
      ...CART,
      lines: [{ ...CART.lines[0], quantity: 1 }],
    };
    render(
      <CartView {...BASE} cart={single} onQuantityChange={onQuantityChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /decrease/i }));

    expect(onQuantityChange).toHaveBeenCalledWith(
      "gid://shopify/ProductVariant/1",
      0,
    );
  });

  it("disables the steppers and checkout while a mutation is in flight", () => {
    render(<CartView {...BASE} cart={CART} busy />);

    expect(screen.getByRole("button", { name: /increase/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /checkout/i })).toBeDisabled();
  });

  it("shows an error with a retry affordance", () => {
    render(<CartView {...BASE} cart={CART} error="Variant unavailable" />);

    expect(screen.getByText(/Variant unavailable/)).toBeInTheDocument();
  });

  it("fires onCheckout when Checkout is tapped", async () => {
    const onCheckout = vi.fn();
    render(<CartView {...BASE} cart={CART} onCheckout={onCheckout} />);

    await userEvent.click(screen.getByRole("button", { name: /checkout/i }));

    expect(onCheckout).toHaveBeenCalledTimes(1);
  });

  it("renders a fallback link when the popup was blocked", () => {
    render(<CartView {...BASE} cart={CART} popupBlocked />);

    expect(screen.getByRole("link", { name: /checkout/i })).toHaveAttribute(
      "href",
      "https://store.test/cart/c/abc",
    );
  });

  it("states only that checkout opened, never that payment succeeded", () => {
    render(<CartView {...BASE} cart={CART} checkoutOpened />);

    expect(screen.getByText(/opened in a new tab/i)).toBeInTheDocument();
    // The widget cannot observe the payment outcome, so it must never imply
    // one. Matched as phrases, not bare words: "complete your payment" is an
    // instruction and must stay allowed, while "payment complete" is a claim
    // and must not.
    expect(
      screen.queryByText(
        /success|\bpaid\b|payment complete|order confirmed|thank you/i,
      ),
    ).toBeNull();
  });

  it("renders an empty cart without a checkout button", () => {
    render(
      <CartView
        {...BASE}
        cart={{
          ...CART,
          lines: [],
          total: { amountMinor: 0, currency: "INR" },
        }}
      />,
    );

    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /checkout/i })).toBeNull();
  });

  it("renders nothing but a message when there is no cart yet", () => {
    render(<CartView {...BASE} cart={null} />);

    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
  });
});
