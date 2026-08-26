import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductDetail } from "./ProductDetail";
import { CTA_INLINE_WIDTH } from "./checkoutChrome";
import type { Product } from "../lib/ucp/types";

const inr = (amountMinor: number) => ({ amountMinor, currency: "INR" });

const TEE: Product = {
  id: "gid://shopify/Product/1",
  title: "short sleeve t-shirt",
  handle: "short-sleeve-t-shirt",
  imageUrl: "https://cdn.shopify.com/tee.jpg",
  description: "A soft cotton tee, cut for everyday wear.",
  priceRange: { min: inr(120000), max: inr(140000) },
  variants: [
    {
      id: "v-red",
      title: "Red",
      price: inr(120000),
      listPrice: inr(150000),
      available: true,
      imageUrl: "https://cdn.shopify.com/red.jpg",
      options: [{ name: "Color", label: "Red" }],
    },
    {
      id: "v-blue",
      title: "Blue",
      price: inr(130000),
      listPrice: inr(130000),
      available: true,
      options: [{ name: "Color", label: "Blue" }],
    },
    {
      id: "v-black",
      title: "Black",
      price: inr(140000),
      listPrice: inr(140000),
      available: false,
      options: [{ name: "Color", label: "Black" }],
    },
  ],
};

/** Shopify's placeholder for a product that has no real options. */
const HOODY: Product = {
  id: "gid://shopify/Product/2",
  title: "Hoody",
  handle: "hoody",
  description: "Heavyweight fleece.",
  priceRange: { min: inr(240000), max: inr(240000) },
  variants: [
    {
      id: "v-hoody",
      title: "Default Title",
      price: inr(240000),
      listPrice: inr(240000),
      available: true,
      options: [{ name: "Title", label: "Default Title" }],
    },
  ],
};

const BASE = {
  cart: null,
  busy: false,
  onSelectVariant: vi.fn(),
  onQuantityChange: vi.fn(),
  onViewCart: vi.fn(),
  onBack: vi.fn(),
};

describe("ProductDetail", () => {
  it("shows the description the grid had no room for", () => {
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />);

    expect(
      screen.getByText("A soft cotton tee, cut for everyday wear."),
    ).toBeInTheDocument();
  });

  it("prices the selected variant, not the product", () => {
    render(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-blue" />,
    );

    expect(screen.getByText(/1,300\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/1,200\.00/)).not.toBeInTheDocument();
  });

  it("strikes through a real compare-at price only", () => {
    // listPrice falls back to price on undiscounted variants, so rendering it
    // unconditionally invents a saving of zero.
    const { rerender } = render(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />,
    );
    expect(screen.getByText(/1,500\.00/)).toBeInTheDocument();

    rerender(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-blue" />,
    );
    expect(screen.queryByText(/1,300\.00/)).toBeInTheDocument();
    expect(document.querySelector("s")).toBeNull();
  });

  it("ignores a list price below the price", () => {
    // Nonsense data must not render as a negative saving. This guard used to
    // live on the grid; the grid no longer renders a compare-at price, so it
    // moved here with the behaviour rather than being deleted with the test.
    const inverted: Product = {
      ...TEE,
      variants: [
        { ...TEE.variants[0], price: inr(2450000), listPrice: inr(2000000) },
      ],
    };

    render(
      <ProductDetail {...BASE} product={inverted} selectedVariantId="v-red" />,
    );

    expect(screen.queryByText(/20,000\.00/)).toBeNull();
    expect(document.querySelector("s")).toBeNull();
  });

  it("builds one picker row per option axis", () => {
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />);

    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });

  it("renders no picker for Shopify's Default Title placeholder", () => {
    // Every single-variant product carries { name: "Title", label:
    // "Default Title" }. That is a placeholder, not an axis — rendering it
    // gives the buyer one button called "Default Title".
    render(
      <ProductDetail {...BASE} product={HOODY} selectedVariantId="v-hoody" />,
    );

    expect(screen.queryByText("Title")).not.toBeInTheDocument();
    expect(screen.queryByText("Default Title")).not.toBeInTheDocument();
  });

  it("disables a sold-out option rather than hiding it", () => {
    // Hiding Black leaves a buyer wondering why three colours are two.
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />);

    expect(screen.getByRole("button", { name: "Black" })).toBeDisabled();
  });

  it("counts each option that is in the cart, on the option itself", async () => {
    // Measured confusion: the grid badged the t-shirt "1" while the detail
    // screen offered "Add to cart", because the colour in the cart was not the
    // colour selected. Nothing on screen explained the gap. The picker does.
    const cart = {
      cartId: "c1",
      currency: "INR",
      continueUrl: "https://store.test/c/1",
      lines: [
        {
          lineId: "l1",
          variantId: "v-red",
          title: "Red",
          quantity: 1,
          unitPrice: inr(120000),
          lineSubtotal: inr(120000),
          lineTotal: inr(120000),
        },
      ],
      subtotal: inr(120000),
      total: inr(120000),
    };

    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-blue"
        cart={cart}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Red 1 in cart" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });

  it("counts nothing on an option the cart does not hold", () => {
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />);

    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /in cart/ })).toBeNull();
  });

  it("reports the variant the buyer picked", async () => {
    const onSelectVariant = vi.fn();
    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-red"
        onSelectVariant={onSelectVariant}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Blue" }));

    expect(onSelectVariant).toHaveBeenCalledWith("v-blue");
  });

  it("adds the selected variant, at quantity one", async () => {
    const onQuantityChange = vi.fn();
    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-blue"
        onQuantityChange={onQuantityChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    expect(onQuantityChange).toHaveBeenCalledWith("v-blue", 1);
  });

  it("becomes a stepper once the variant is in the cart", async () => {
    const onQuantityChange = vi.fn();
    const cart = {
      cartId: "c1",
      currency: "INR",
      continueUrl: "https://store.test/c/1",
      lines: [
        {
          lineId: "l1",
          variantId: "v-blue",
          title: "Blue",
          quantity: 2,
          unitPrice: inr(130000),
          lineSubtotal: inr(260000),
          lineTotal: inr(260000),
        },
      ],
      subtotal: inr(260000),
      total: inr(260000),
    };

    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-blue"
        cart={cart}
        onQuantityChange={onQuantityChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /increase/i }));

    expect(onQuantityChange).toHaveBeenCalledWith("v-blue", 3);
  });

  /** A cart holding a variant this product does not offer, so the add control
   *  stays Add to cart while the bar still has a View cart to sit beside. */
  const OTHER_CART = {
    cartId: "c1",
    currency: "INR" as const,
    continueUrl: "https://store.test/c/1",
    lines: [
      {
        lineId: "l9",
        variantId: "v-elsewhere",
        title: "Something else",
        quantity: 3,
        unitPrice: inr(100000),
        lineSubtotal: inr(300000),
        lineTotal: inr(300000),
      },
    ],
    subtotal: inr(300000),
    total: inr(300000),
  };

  it("puts the add control and View cart in one bar, add first", () => {
    render(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" cart={OTHER_CART} />,
    );

    const add = screen.getByRole("button", { name: /add to cart/i });
    const view = screen.getByRole("button", { name: /view cart/i });

    // Same row, add on the left. They were at opposite ends of the screen —
    // the add control at the end of the content, View cart in the footer — so
    // a buyer adding a second item had to look in two places.
    expect(add.parentElement).toBe(view.parentElement);
    expect(
      add.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps View cart off the width the row has spare", () => {
    // It was flex-1 and took every pixel left over, so on a wide host the
    // secondary button was the largest thing on the screen. Both buttons size
    // to themselves and sit at the far edge; the cart summary holds the left.
    render(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" cart={OTHER_CART} />,
    );

    const view = screen.getByRole("button", { name: /view cart/i });

    expect(view.className.split(/\s+/)).not.toContain("flex-1");
    expect(view.className.split(/\s+/)).toContain("shrink-0");
    // All three controls share one width — Add to cart, the stepper that
    // replaces it, and View cart — so the pair reads as two buttons rather
    // than one button and a banner.
    expect(view.className.split(/\s+/)).toContain(CTA_INLINE_WIDTH);

    // The cart summary holds the left edge of the bar.
    const bar = view.parentElement!.parentElement!;
    expect(bar.firstElementChild!.textContent).toContain("3 items");
  });

  it("makes View cart secondary to the add control", () => {
    // Two filled maroon buttons side by side give a buyer no idea which one
    // this screen is for. Adding is the act here; the cart is a destination.
    render(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" cart={OTHER_CART} />,
    );

    const add = screen.getByRole("button", { name: /add to cart/i });
    const view = screen.getByRole("button", { name: /view cart/i });

    expect(add.getAttribute("style")).toContain("background-color");
    expect(view.getAttribute("style")).not.toContain("background-color");
    expect(view.className).toContain("border-2");
  });

  it("keeps the add control and the stepper in the same slot", async () => {
    // The stepper replaces Add to cart in place, so the bar must not reflow at
    // the moment the buyer taps Add.
    const { rerender } = render(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-blue" cart={OTHER_CART} />,
    );
    const row = screen.getByRole("button", { name: /add to cart/i }).parentElement!;

    const withBlue = {
      ...OTHER_CART,
      lines: [
        ...OTHER_CART.lines,
        {
          lineId: "l1",
          variantId: "v-blue",
          title: "Blue",
          quantity: 2,
          unitPrice: inr(130000),
          lineSubtotal: inr(260000),
          lineTotal: inr(260000),
        },
      ],
    };
    rerender(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-blue" cart={withBlue} />,
    );

    const stepper = screen
      .getByRole("button", { name: /increase quantity/i })
      .parentElement!;
    expect(stepper.parentElement).toBe(row);
    expect(stepper.className).toContain(CTA_INLINE_WIDTH);
  });

  it("falls back to the first available variant when none is selected", () => {
    // A remount can arrive with selectedVariantId cleared. Rendering nothing
    // priced would be worse than picking the variant the grid would have.
    render(<ProductDetail {...BASE} product={TEE} />);

    expect(screen.getByText(/1,200\.00/)).toBeInTheDocument();
  });

  it("offers a way back to the grid", async () => {
    const onBack = vi.fn();
    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-red"
        onBack={onBack}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
