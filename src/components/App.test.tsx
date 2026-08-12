import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type { Cart, Product } from "../lib/ucp/types";

const PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "short sleeve t-shirt",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    variants: [
      {
        id: "v1",
        title: "Red",
        price: { amountMinor: 120000, currency: "INR" },
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
      lineTotal: { amountMinor: 120000, currency: "INR" },
    },
  ],
  total: { amountMinor: 120000, currency: "INR" },
};

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, json: async () => CART }),
    );
    vi.stubGlobal("open", vi.fn().mockReturnValue({}));
    // The host bridge is absent under jsdom; the widget-state hook needs a
    // stand-in for window.openai to persist into.
    vi.stubGlobal("openai", {
      widgetState: null,
      setWidgetState: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the results grid from tool metadata", () => {
    render(
      <App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />,
    );

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
  });

  it("moves to the cart screen after adding an item", async () => {
    render(
      <App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    expect(
      await screen.findByRole("button", { name: /checkout/i }),
    ).toBeInTheDocument();
  });

  it("opens continue_url in a new tab on checkout", async () => {
    render(
      <App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /checkout/i }),
    );

    expect(window.open).toHaveBeenCalledWith(
      "https://store.test/cart/c/abc",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows the fallback link when the popup is blocked", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    render(
      <App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /checkout/i }),
    );

    expect(
      await screen.findByRole("link", { name: /open checkout here/i }),
    ).toHaveAttribute("href", "https://store.test/cart/c/abc");
  });

  it("returns to the results grid from the cart", async () => {
    render(
      <App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /add/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /back to products/i }),
    );

    expect(screen.getByText("short sleeve t-shirt")).toBeInTheDocument();
  });

  it("shows a waiting state when no products have arrived yet", () => {
    render(<App toolMeta={null} toolInput={null} />);

    expect(screen.getByText(/searching|no products/i)).toBeInTheDocument();
  });
});
