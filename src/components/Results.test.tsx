import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Results } from "./Results";
import type { Product } from "../lib/ucp/types";

const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    variants: [
      {
        id: "gid://shopify/ProductVariant/1",
        title: "Red",
        price: { amountMinor: 120000, currency: "INR" },
        available: true,
        imageUrl: "https://cdn.shopify.com/a.jpg",
      },
    ],
  },
  {
    id: "gid://shopify/Product/2",
    title: "Sold Out Hoody",
    variants: [
      {
        id: "gid://shopify/ProductVariant/2",
        title: "Black",
        price: { amountMinor: 250000, currency: "INR" },
        available: false,
      },
    ],
  },
];

describe("Results", () => {
  it("renders title, formatted price and image", () => {
    render(<Results products={PRODUCTS} query="shirt" onAdd={vi.fn()} />);

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
    expect(screen.getByText(/1,200\.00/)).toBeInTheDocument();
    expect(screen.getByAltText("short sleeve t-shirt")).toHaveAttribute(
      "src",
      "https://cdn.shopify.com/a.jpg",
    );
  });

  it("shows the variant name so the chosen option is never a surprise", () => {
    render(<Results products={PRODUCTS} query="shirt" onAdd={vi.fn()} />);

    expect(screen.getByText("Red")).toBeInTheDocument();
  });

  it("calls onAdd with the variant id, not the product id", async () => {
    const onAdd = vi.fn();
    render(<Results products={PRODUCTS} query="shirt" onAdd={onAdd} />);

    await userEvent.click(screen.getAllByRole("button", { name: /add/i })[0]);

    expect(onAdd).toHaveBeenCalledWith("gid://shopify/ProductVariant/1");
  });

  it("disables Add for an unavailable variant", () => {
    render(<Results products={PRODUCTS} query="shirt" onAdd={vi.fn()} />);

    const buttons = screen.getAllByRole("button", { name: /add|unavailable/i });
    expect(buttons[1]).toBeDisabled();
  });

  it("renders an empty state echoing the query", () => {
    render(<Results products={[]} query="unobtainium" onAdd={vi.fn()} />);

    expect(screen.getByText(/unobtainium/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });

  it("renders a product with no image without crashing", () => {
    render(<Results products={[PRODUCTS[1]]} query="hoody" onAdd={vi.fn()} />);

    expect(screen.getByText("Sold Out Hoody")).toBeInTheDocument();
  });
});
