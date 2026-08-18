import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Results } from "./Results";
import type { Product } from "../lib/ucp/types";

const inr = (amountMinor: number) => ({ amountMinor, currency: "INR" });

/**
 * The demo store's shape: one product with three colours, one with none.
 * Before the detail screen existed the grid rendered the t-shirt as three
 * separate cards.
 */
const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    handle: "short-sleeve-t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    description: "A soft cotton tee.",
    priceRange: { min: inr(120000), max: inr(140000) },
    variants: [
      {
        id: "v-red",
        title: "Red",
        price: inr(120000),
        listPrice: inr(120000),
        available: true,
        imageUrl: "https://cdn.shopify.com/a.jpg",
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
  },
  {
    id: "gid://shopify/Product/2",
    title: "Sold Out Hoody",
    handle: "sold-out-hoody",
    description: "Heavyweight fleece.",
    priceRange: { min: inr(250000), max: inr(250000) },
    variants: [
      {
        id: "v-hoody",
        title: "Default Title",
        price: inr(250000),
        listPrice: inr(250000),
        available: false,
        options: [{ name: "Title", label: "Default Title" }],
      },
    ],
  },
];

const CART = {
  cartId: "c1",
  currency: "INR",
  continueUrl: "https://store.test/c/1",
  lines: [
    {
      lineId: "l1",
      variantId: "v-red",
      title: "Red",
      quantity: 2,
      unitPrice: inr(120000),
      lineSubtotal: inr(240000),
      lineTotal: inr(240000),
    },
  ],
  subtotal: inr(240000),
  total: inr(240000),
};

const BASE = {
  query: "shirt",
  cart: null,
  busy: false,
  onOpenProduct: vi.fn(),
  onViewCart: vi.fn(),
};

describe("Results", () => {
  it("renders one card per product, not one per variant", () => {
    // The demo store's t-shirt is three variants. Before the detail screen
    // existed each was its own card, so one product a buyer thinks of as one
    // thing occupied three tiles.
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getAllByText("short sleeve t-shirt")).toHaveLength(1);
    expect(screen.queryByText("Red")).toBeNull();
  });

  it("shows a price range when the variants disagree", () => {
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getByText(/1,200\.00.*1,400\.00/)).toBeInTheDocument();
  });

  it("shows one price when the variants agree", () => {
    render(<Results {...BASE} products={PRODUCTS} />);

    const hoodyPrice = screen.getByText(/2,500\.00/);
    expect(hoodyPrice.textContent).not.toMatch(/–/);
  });

  it("summarises the options a product offers", () => {
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getByText("3 colors")).toBeInTheDocument();
  });

  it("does not summarise Shopify's Default Title placeholder", () => {
    // A single-variant product carries { name: "Title", label: "Default
    // Title" }. Summarising it would put "1 titles" under the Hoody.
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.queryByText(/title/i)).toBeNull();
  });

  it("opens the detail screen for the product tapped", async () => {
    const onOpenProduct = vi.fn();
    render(
      <Results {...BASE} products={PRODUCTS} onOpenProduct={onOpenProduct} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /short sleeve t-shirt/i }),
    );

    expect(onOpenProduct).toHaveBeenCalledWith("gid://shopify/Product/1");
  });

  it("badges a product that has variants in the cart", () => {
    // The badge counts the product's variants, so two Reds read as 2 — not as
    // one line.
    render(<Results {...BASE} products={PRODUCTS} cart={CART} />);

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not badge a product with nothing in the cart", () => {
    render(<Results {...BASE} products={[PRODUCTS[1]]} cart={CART} />);

    expect(screen.queryByText("2")).toBeNull();
  });

  it("renders title, formatted price and image", () => {
    render(<Results {...BASE} products={PRODUCTS} />);

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
    expect(screen.getByAltText("short sleeve t-shirt")).toHaveAttribute(
      "src",
      "https://cdn.shopify.com/a.jpg",
    );
  });

  it("renders an empty state echoing the query", () => {
    render(<Results {...BASE} products={[]} query="unobtainium" />);

    expect(screen.getByText(/unobtainium/)).toBeInTheDocument();
  });

  it("renders a product with no image without crashing", () => {
    render(<Results {...BASE} products={[PRODUCTS[1]]} />);

    expect(screen.getByText("Sold Out Hoody")).toBeInTheDocument();
  });

  it("shows the cart bar only once there is something in it", () => {
    const { rerender } = render(<Results {...BASE} products={PRODUCTS} />);
    expect(screen.queryByRole("button", { name: /view cart/i })).toBeNull();

    rerender(<Results {...BASE} products={PRODUCTS} cart={CART} />);
    expect(
      screen.getByRole("button", { name: /view cart/i }),
    ).toBeInTheDocument();
  });
});
