import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Results } from "./Results";
import type { Product } from "../lib/ucp/types";

const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    handle: "short-sleeve-t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    description: "A soft cotton tee.",
    priceRange: {
      min: { amountMinor: 120000, currency: "INR" },
      max: { amountMinor: 120000, currency: "INR" },
    },
    variants: [
      {
        id: "gid://shopify/ProductVariant/1",
        title: "Red",
        price: { amountMinor: 120000, currency: "INR" },
        listPrice: { amountMinor: 120000, currency: "INR" },
        available: true,
        imageUrl: "https://cdn.shopify.com/a.jpg",
        options: [{ name: "Color", label: "Red" }],
      },
    ],
  },
  {
    id: "gid://shopify/Product/2",
    title: "Sold Out Hoody",
    handle: "sold-out-hoody",
    description: "Heavyweight fleece.",
    priceRange: {
      min: { amountMinor: 250000, currency: "INR" },
      max: { amountMinor: 250000, currency: "INR" },
    },
    variants: [
      {
        id: "gid://shopify/ProductVariant/2",
        title: "Black",
        price: { amountMinor: 250000, currency: "INR" },
        listPrice: { amountMinor: 250000, currency: "INR" },
        available: false,
        options: [{ name: "Title", label: "Default Title" }],
      },
    ],
  },
];

const BASE = {
  query: "perfume",
  cart: null,
  busy: false,
  onQuantityChange: vi.fn(),
  onViewCart: vi.fn(),
};

/** Live shape from belvish: ₹24,500 against a ₹34,000 compare-at price. */
const DISCOUNTED: Product[] = [
  {
    ...PRODUCTS[0],
    title: "Parfums de Marly Sedley EDP",
    variants: [
      {
        ...PRODUCTS[0].variants[0],
        title: "125ml",
        price: { amountMinor: 2450000, currency: "INR" },
        listPrice: { amountMinor: 3400000, currency: "INR" },
      },
    ],
  },
];

describe("Results — compare-at pricing", () => {
  it("strikes the list price through when it is higher than the price", () => {
    render(<Results {...BASE} products={DISCOUNTED} />);

    expect(
      screen.getByText(/34,000\.00/, { selector: "s" }),
    ).toBeInTheDocument();
    // The payable price must not be struck through.
    expect(screen.getByText(/24,500\.00/).tagName).not.toBe("S");
  });

  it("shows no strike-through when list price equals price", () => {
    // Most of this catalog carries a list price, but Fragrance World does not,
    // and normaliseVariant falls it back to price. Rendering "₹3,025 was
    // ₹3,025" would invent a discount that does not exist.
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.queryByText(/1,200\.00/, { selector: "s" })).toBeNull();
  });

  it("ignores a list price below the price", () => {
    // Nonsense data must not render as a negative saving.
    const inverted: Product[] = [
      {
        ...DISCOUNTED[0],
        variants: [
          {
            ...DISCOUNTED[0].variants[0],
            price: { amountMinor: 2450000, currency: "INR" },
            listPrice: { amountMinor: 2000000, currency: "INR" },
          },
        ],
      },
    ];

    render(<Results {...BASE} products={inverted} />);

    expect(screen.queryByText(/20,000\.00/)).toBeNull();
  });
});

describe("Results", () => {
  it("renders title, formatted price and image", () => {
    render(
      <Results
        products={PRODUCTS}
        query="shirt"
        cart={null}
        busy={false}
        onQuantityChange={vi.fn()}
        onViewCart={vi.fn()}
      />,
    );

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
    expect(screen.getByText(/1,200\.00/)).toBeInTheDocument();
    expect(screen.getByAltText("short sleeve t-shirt")).toHaveAttribute(
      "src",
      "https://cdn.shopify.com/a.jpg",
    );
  });

  it("shows the variant name so the chosen option is never a surprise", () => {
    render(
      <Results
        products={PRODUCTS}
        query="shirt"
        cart={null}
        busy={false}
        onQuantityChange={vi.fn()}
        onViewCart={vi.fn()}
      />,
    );

    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  it("disables Add for an unavailable variant", () => {
    render(
      <Results
        products={PRODUCTS}
        query="shirt"
        cart={null}
        busy={false}
        onQuantityChange={vi.fn()}
        onViewCart={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /add|unavailable/i });
    expect(buttons[1]).toBeDisabled();
  });

  it("renders an empty state echoing the query", () => {
    render(
      <Results
        products={[]}
        query="unobtainium"
        cart={null}
        busy={false}
        onQuantityChange={vi.fn()}
        onViewCart={vi.fn()}
      />,
    );

    expect(screen.getByText(/unobtainium/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });

  it("renders a product with no image without crashing", () => {
    render(
      <Results
        products={[PRODUCTS[1]]}
        query="hoody"
        cart={null}
        busy={false}
        onQuantityChange={vi.fn()}
        onViewCart={vi.fn()}
      />,
    );

    expect(screen.getByText("Sold Out Hoody")).toBeInTheDocument();
  });
});
