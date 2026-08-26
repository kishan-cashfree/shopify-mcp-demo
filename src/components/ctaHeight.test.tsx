import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CTA_BASE, CTA_INLINE_WIDTH, FIELD_CLASS } from "./checkoutChrome";
import { PhoneEntry } from "./PhoneEntry";
import { OtpEntry } from "./OtpEntry";
import { AddressStep } from "./AddressStep";
import { CartView } from "./Cart";
import { ProductDetail } from "./ProductDetail";
import { Results } from "./Results";
import { PaymentResult } from "./PaymentResult";
import type { Cart, Product } from "../lib/ucp/types";
import type { OccAddress } from "../lib/cashfree/occ";

const inr = (amountMinor: number) => ({ amountMinor, currency: "INR" });

const PRODUCT: Product = {
  id: "p1",
  title: "Lattafa Asad EDP",
  handle: "lattafa-asad",
  imageUrl: "https://cdn.shopify.com/a.jpg",
  description: "",
  priceRange: { min: inr(249900), max: inr(249900) },
  variants: [
    {
      id: "v1",
      title: "Default Title",
      price: inr(249900),
      listPrice: inr(249900),
      available: true,
      options: [{ name: "Title", label: "Default Title" }],
    },
  ],
};

const CART: Cart = {
  cartId: "c1",
  currency: "INR",
  continueUrl: "https://store.test/c",
  lines: [
    {
      lineId: "l1",
      variantId: "v1",
      title: "Lattafa Asad EDP",
      quantity: 1,
      unitPrice: inr(249900),
      lineSubtotal: inr(249900),
      lineTotal: inr(249900),
    },
  ],
  subtotal: inr(249900),
  total: inr(249900),
};

const ADDRESS: OccAddress = {
  id: "a1",
  customer_name: "Kishan Kumar Maurya",
  address_line_one: "4th Floor, Karle Town Centre",
  address_line_two: "",
  city: "Bangalore",
  country: "India",
  country_code: "IN",
  zip_code: "560045",
  state: "Karnataka",
  state_code: "KA",
  phone: "+91 8433719326",
  email: "k@example.com",
};

const noop = () => {};

/**
 * One height for every screen's primary action.
 *
 * They had drifted to five: py-3.5 on the login steps, py-3 on the address and
 * result screens, py-2.5 on Add to cart, py-2 on the two View cart bars. Read
 * one screen at a time nothing looks wrong; walked end to end the button
 * changes size four times.
 *
 * Asserted against the shared constant rather than a literal so this cannot be
 * satisfied by copying the same numbers into eight files again — that is how
 * they drifted in the first place.
 */
const SCREENS: [string, () => void, RegExp][] = [
  // PhoneEntry and OtpEntry are deliberately absent: their submit control is
  // an arrow inside the field, not a screen-width CTA, so CTA_BASE does not
  // apply to either. Each screen's own test file asserts that control's shape.
  ["AddressStep", () => render(
    <AddressStep addresses={[]} busy={false} error={null} onSelect={noop} onCreate={noop} onBack={noop} />,
  ), /save address/i],
  ["Cart", () => render(
    <CartView cart={CART} busy={false} error={null} onQuantityChange={noop} onCheckout={noop} onBack={noop} />,
  ), /checkout/i],
  ["ProductDetail", () => render(
    <ProductDetail product={PRODUCT} selectedVariantId="v1" cart={null} busy={false} onSelectVariant={noop} onQuantityChange={noop} onBack={noop} onViewCart={noop} />,
  ), /add to cart/i],
  ["Results", () => render(
    <Results products={[PRODUCT]} query="perfume" cart={CART} busy={false} onOpenProduct={noop} onQuantityChange={noop} onViewCart={noop} visibleCount={6} onShowMore={noop} />,
  ), /view cart/i],
  ["PaymentResult", () => render(
    <PaymentResult cart={CART} shippingAddress={ADDRESS} orderId="order_1" status="FAILED" timedOut={false} polling={false} onStopWaiting={noop} onRetry={noop} onBack={noop} />,
  ), /back to payment/i],
];

describe("CTA height", () => {
  for (const [name, mount, label] of SCREENS) {
    it(`gives ${name}'s primary action the shared height`, () => {
      mount();

      const cta = screen.getByRole("button", { name: label });

      // CTA_BASE, not CTA_CLASS: horizontal padding and width legitimately
      // differ — Add to cart is sized to its label and centred, the login steps
      // span the screen. Height, radius and weight are the shared part, and
      // height is what this file is about.
      for (const token of CTA_BASE.split(/\s+/)) {
        expect(cta.className.split(/\s+/)).toContain(token);
      }
    });
  }

  it("keeps Add to cart off the full width of the product screen", () => {
    // It sits in the bottom bar beside a secondary View cart. shrink-0 keeps
    // the row from squeezing it, and the explicit w-44 is what stops
    // align-items stretching it — a stretch only applies while width is auto.
    render(
      <ProductDetail product={PRODUCT} selectedVariantId="v1" cart={null} busy={false} onSelectVariant={noop} onQuantityChange={noop} onBack={noop} onViewCart={noop} />,
    );

    const cta = screen.getByRole("button", { name: /add to cart/i });

    expect(cta.className.split(/\s+/)).toContain("shrink-0");
    expect(cta.className.split(/\s+/)).toContain(CTA_INLINE_WIDTH);
    expect(cta.className.split(/\s+/)).not.toContain("w-full");
  });

  it("keeps the stepper the width Add to cart just was", () => {
    // The stepper replaces Add to cart in place the instant an item is added.
    // Sized to their own contents the two are different widths, so pressing
    // the button made it visibly change size under the buyer's finger.
    const { rerender } = render(
      <ProductDetail product={PRODUCT} selectedVariantId="v1" cart={null} busy={false} onSelectVariant={noop} onQuantityChange={noop} onBack={noop} onViewCart={noop} />,
    );
    const before = screen.getByRole("button", { name: /add to cart/i });
    expect(before.className.split(/\s+/)).toContain(CTA_INLINE_WIDTH);

    rerender(
      <ProductDetail product={PRODUCT} selectedVariantId="v1" cart={CART} busy={false} onSelectVariant={noop} onQuantityChange={noop} onBack={noop} onViewCart={noop} />,
    );

    const stepper = screen
      .getByRole("button", { name: /increase quantity/i })
      .parentElement!;
    expect(stepper.className.split(/\s+/)).toContain(CTA_INLINE_WIDTH);
    expect(stepper.className.split(/\s+/)).toContain("shrink-0");
    expect(stepper.className.split(/\s+/)).toContain("h-12");
  });

  it("fixes the height rather than deriving it from padding and font size", () => {
    // py-3.5 with text-base and py-3 with text-sm are 52px and 44px. Matching
    // them by eye is what produced five heights; an explicit h- token cannot
    // drift when a label's font size changes.
    expect(CTA_BASE).toMatch(/\bh-\d/);
  });
});

describe("field height", () => {
  /** The CTA's height token, e.g. "h-12". */
  const ctaHeight = CTA_BASE.split(/\s+/).find((t) => /^h-\d/.test(t));

  it("matches the CTA on the phone screen", () => {
    // The field's shell is the bordered row, not the <input>: +91 and the
    // divider sit beside the input inside it, so the input itself is
    // transparent and full-height.
    const { container } = render(
      <PhoneEntry busy={false} error={null} onSubmit={noop} onBack={noop} />,
    );
    const shell = container.querySelector(`.${CSS.escape(ctaHeight!)}`);

    expect(shell).toBeInTheDocument();
    expect(shell!.querySelector("input")).toBeInTheDocument();
  });

  it("matches the CTA on the OTP screen", () => {
    // The shell is the bordered box, not the <input>: the submit arrow sits
    // beside the input inside it, so the input itself is transparent and
    // full-height.
    const { container } = render(
      <OtpEntry phone="8433719326" busy={false} error={null} onSubmit={noop} onResend={noop} onBack={noop} />,
    );
    const shell = container.querySelector(`.${CSS.escape(ctaHeight!)}`);

    expect(shell).toBeInTheDocument();
    expect(shell!.querySelector("input")).toBeInTheDocument();
  });

  it("caps both fields in rem rather than as a fraction of the row", () => {
    // The arrow moved inside the field, so a field spanning the screen reads as
    // an unfinished row. But the contents have a fixed size — "+91", a divider,
    // ten digits and a 36px arrow is about 230px — and a fraction of a
    // container the widget does not control cannot honour that: w-1/4 clipped
    // the placeholder to "10 digit". A max-width caps it on a wide host and
    // still lets it shrink on a narrow one.
    const phone = render(
      <PhoneEntry busy={false} error={null} onSubmit={noop} onBack={noop} />,
    );
    expect(
      phone.container.querySelector("div.h-12")!.className.split(/\s+/),
    ).toContain("max-w-[18rem]");
    phone.unmount();

    const otp = render(
      <OtpEntry phone="8433719326" busy={false} error={null} onSubmit={noop} onResend={noop} onBack={noop} />,
    );
    expect(
      otp.container.querySelector("div.h-12")!.className.split(/\s+/),
    ).toContain("max-w-[14rem]");
  });

  it("states the field height instead of deriving it", () => {
    // py-3 with text-base is 48px and py-3 with text-lg is 52px — the same
    // padding, two heights, which is how the OTP box ended up 4px taller than
    // the button under it while the phone box matched.
    expect(FIELD_CLASS).toContain(ctaHeight);
  });
});
