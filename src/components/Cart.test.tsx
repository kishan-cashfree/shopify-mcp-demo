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
      lineSubtotal: { amountMinor: 240000, currency: "INR" },
      lineTotal: { amountMinor: 240000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 240000, currency: "INR" },
  total: { amountMinor: 240000, currency: "INR" },
};

/** The live shape from belvish.myshopify.com: a ₹24,500 item, 5% off. */
const DISCOUNTED_CART: Cart = {
  ...CART,
  lines: [
    {
      ...CART.lines[0],
      title: "Parfums de Marly Sedley EDP - 125ml",
      quantity: 1,
      unitPrice: { amountMinor: 2450000, currency: "INR" },
      lineSubtotal: { amountMinor: 2450000, currency: "INR" },
      lineTotal: { amountMinor: 2327500, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 2450000, currency: "INR" },
  discount: {
    label: "NOCHAINS",
    amount: { amountMinor: 122500, currency: "INR" },
  },
  total: { amountMinor: 2327500, currency: "INR" },
};

const BASE = {
  busy: false,
  error: null,
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

  it("shows no subtotal or discount row when nothing was discounted", () => {
    // An undiscounted cart should stay a single Total line, not grow a
    // redundant Subtotal that repeats it.
    render(<CartView {...BASE} cart={CART} />);

    expect(screen.queryByText("Subtotal")).not.toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("explains a discounted total with a subtotal and a named discount", () => {
    // The reported bug: ₹24,500 on the line, ₹23,275 at the bottom, and
    // nothing on screen accounting for the ₹1,225 in between.
    render(<CartView {...BASE} cart={DISCOUNTED_CART} />);

    // Twice, correctly: once as "₹24,500.00 each" on the line, once as the
    // subtotal the discount is taken from.
    expect(screen.getAllByText(/24,500\.00/)).toHaveLength(2);
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    // The store's own name for the offer, so the buyer can tell what applied.
    expect(screen.getByText("NOCHAINS")).toBeInTheDocument();
    expect(screen.getByText(/−.*1,225\.00/)).toBeInTheDocument();
    // Twice as well: the discounted unit price on the line, and the total.
    expect(screen.getAllByText(/23,275\.00/)).toHaveLength(2);
  });

  it("strikes the old unit price through and prints the discounted one", () => {
    render(<CartView {...BASE} cart={DISCOUNTED_CART} />);

    const struck = screen.getByText(/24,500\.00/, { selector: "s" });
    expect(struck).toBeInTheDocument();
    // The discounted price must not also be struck through — that would read
    // as though nothing is payable.
    expect(screen.getByText(/23,275\.00 each/).tagName).not.toBe("S");
  });

  it("leaves the unit price unstruck when nothing was discounted", () => {
    render(<CartView {...BASE} cart={CART} />);

    expect(
      screen.queryByText(/1,200\.00/, { selector: "s" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/1,200\.00 each/)).toBeInTheDocument();
  });

  it("shows line totals, not a per-unit price, when the discount does not divide evenly", () => {
    // ₹100 off three units is ₹33.333… each. Printing a rounded "each" makes
    // three of them fail to add up to the line, so show the line instead.
    const uneven: Cart = {
      ...CART,
      lines: [
        {
          ...CART.lines[0],
          quantity: 3,
          unitPrice: { amountMinor: 100000, currency: "INR" },
          lineSubtotal: { amountMinor: 300000, currency: "INR" },
          lineTotal: { amountMinor: 290000, currency: "INR" },
        },
      ],
      subtotal: { amountMinor: 300000, currency: "INR" },
      discount: {
        label: "TENOFF",
        amount: { amountMinor: 10000, currency: "INR" },
      },
      total: { amountMinor: 290000, currency: "INR" },
    };

    render(<CartView {...BASE} cart={uneven} />);

    expect(screen.getByText(/3,000\.00/, { selector: "s" })).toBeInTheDocument();
    expect(screen.getByText(/2,900\.00 total/)).toBeInTheDocument();
    expect(screen.queryByText(/each/)).not.toBeInTheDocument();
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
