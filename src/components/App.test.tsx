import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";
import type { Cart, Product } from "../lib/ucp/types";

const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    handle: "short-sleeve-t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    variants: [
      {
        id: "v1",
        title: "Red",
        price: { amountMinor: 120000, currency: "INR" },
        listPrice: { amountMinor: 120000, currency: "INR" },
        available: true,
      },
    ],
  },
];

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "l1",
      variantId: "v1",
      title: "short sleeve t-shirt - Red",
      quantity: 1,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineSubtotal: { amountMinor: 120000, currency: "INR" },
      lineTotal: { amountMinor: 120000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 120000, currency: "INR" },
  total: { amountMinor: 120000, currency: "INR" },
};

const openExternal = vi.fn();

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => CART }),
    );
    openExternal.mockReset().mockResolvedValue(undefined);
    // Stubbed at the host boundary — window.openai is what the platform bridge
    // reads. Mocking the bridge module instead would replace a class instance
    // with an object literal and lose its prototype methods, and mocking
    // window.open would exercise only the no-host fallback.
    vi.stubGlobal("openai", {
      widgetState: null,
      setWidgetState: vi.fn(),
      openExternal,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the results grid from tool metadata", () => {
    render(
      <App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />,
    );

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
  });




  it("shows a waiting state when no products have arrived yet", () => {
    render(<App toolMeta={null} toolInput={null} />);

    expect(screen.getByText(/searching|no products/i)).toBeInTheDocument();
  });
});
