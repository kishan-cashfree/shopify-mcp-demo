import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import type { Cart, Product } from "../lib/ucp/types";

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
        id: "v1",
        title: "Red",
        price: { amountMinor: 120000, currency: "INR" },
        listPrice: { amountMinor: 120000, currency: "INR" },
        available: true,
        options: [{ name: "Color", label: "Red" }],
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

const ADDRESS = {
  id: "a1",
  customer_name: "Kishan",
  address_line_one: "Koramangala",
  address_line_two: "",
  city: "Bangalore",
  country: "India",
  country_code: "IN",
  zip_code: "560034",
  state: "Karnataka",
  state_code: "KA",
  phone: "+91 8433719326",
  email: "b@e.test",
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

  it("shows the new products when the buyer searches again after paying", async () => {
    // Reported live: after a payment completed, "Show me shirts from store"
    // returned 200 with a fresh catalog at 21:04:54 and the widget still
    // rendered "Payment received". Host widget state outlives the widget, so
    // the new instance woke up holding screen "checkout".
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "checkout",
        cartId: CART.cartId,
        quantities: { v1: 1 },
        lastSearchId: "search-1",
        checkout: {
          step: "paying",
          orderId: "order_4303293",
          phone: "8433719326",
        },
      },
      setWidgetState: vi.fn(),
      openExternal,
    });

    render(
      <App
        toolMeta={{ products: PRODUCTS, searchId: "search-2" }}
        toolInput={{ query: "shirt" }}
      />,
    );

    expect(await screen.findByText("short sleeve t-shirt")).toBeInTheDocument();
    expect(screen.queryByText(/payment received/i)).toBeNull();
  });

  it("recovers the grid after a reload the host did not re-run the tool for", async () => {
    // ChatGPT remounts the widget and hands back no products, so the grid sat
    // on "Searching the store…" permanently — only another search would have
    // cleared it. The query is persisted so the widget can ask our own server.
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "results",
        quantities: {},
        lastSearchId: "search-1",
        query: "shirt",
      },
      setWidgetState: vi.fn(),
      openExternal,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ products: PRODUCTS }),
      }),
    );

    render(<App toolMeta={null} toolInput={null} />);

    // Longer than the grace useProducts gives the host to answer first.
    expect(
      await screen.findByText("short sleeve t-shirt", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
  });

  it("restores a payment in flight when no tool result is coming", async () => {
    // The guard below withholds a finished payment until a tool result
    // arrives, which is right on Claude where one lands in milliseconds. On
    // ChatGPT after a reload none ever arrives, and waiting forever would
    // strand a buyer mid-payment on a placeholder.
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "checkout",
        cartId: "gid://shopify/Cart/abc",
        quantities: { v1: 1 },
        lastSearchId: "search-1",
        checkout: { step: "paying", orderId: "order_4303293" },
      },
      setWidgetState: vi.fn(),
      openExternal,
    });

    render(<App toolMeta={null} toolInput={null} />);

    expect(screen.queryByText(/order_4303293/)).toBeNull();
    expect(
      await screen.findByText(/order_4303293/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it("does not show a finished payment before the tool result arrives", async () => {
    // Measured live at 23:24:37, with no tool result yet:
    //   metaKeys:null searchId:null screen:"checkout" checkoutStep:"paying"
    // A widget mounts, restores state from the origin-wide localStorage key
    // and paints the previous order's receipt, because applySearchResult has
    // no searchId to judge it against yet. The buyer watched an old order
    // summary while their cart loaded behind it.
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "checkout",
        cartId: "gid://shopify/Cart/paid",
        quantities: { v1: 1 },
        lastSearchId: "search-1",
        checkout: { step: "paying", orderId: "order_4303293" },
      },
      setWidgetState: vi.fn(),
      openExternal,
    });

    render(<App toolMeta={null} toolInput={null} />);

    expect(screen.queryByText(/payment received/i)).toBeNull();
    expect(screen.queryByText(/order_4303293/)).toBeNull();
    expect(screen.getByText(/searching/i)).toBeInTheDocument();
  });

  it("still restores an unfinished checkout before the tool result arrives", async () => {
    // The whole point of persisting state: a host re-render mid-checkout must
    // not strand a buyer whose Cashfree order already exists. Only a finished
    // payment is withheld.
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "checkout",
        cartId: "gid://shopify/Cart/abc",
        quantities: { v1: 1 },
        lastSearchId: "search-1",
        checkout: { step: "otp", phone: "8433719326" },
      },
      setWidgetState: vi.fn(),
      openExternal,
    });

    render(<App toolMeta={null} toolInput={null} />);

    // Grouped 5+5 on the OTP screen so a buyer can check it against their
    // handset; still the same number this checkout was restored with.
    expect(await screen.findByText(/84337 19326/)).toBeInTheDocument();
  });

  it("does not add to the cart that was already paid for", async () => {
    // Measured live. The reset cleared widget state correctly:
    //   screen:"results" lastSearchId:6b70 checkoutStep:null cartId:null
    // and one render later the old id was back:
    //   screen:"results" lastSearchId:6b70 checkoutStep:null cartId:"gid://…hWNFeW8h"
    // useCart seeds cartId into a ref at mount and never re-reads it, so
    // clearing widget state left the real owner untouched and the next write
    // pushed the paid cart's id back. The buyer's new item landed in the paid
    // cart — a ₹1,00,000 watch they had already bought reappeared beside it.
    const PAID_CART = "gid://shopify/Cart/already-paid";
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => CART });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "checkout",
        cartId: PAID_CART,
        quantities: { v1: 1 },
        lastSearchId: "search-1",
        checkout: { step: "paying", orderId: "order_4303293" },
      },
      setWidgetState: vi.fn(),
      openExternal,
    });

    render(
      <App
        toolMeta={{ products: PRODUCTS, searchId: "search-2" }}
        toolInput={{ query: "shirt" }}
      />,
    );

    // Adding now happens on the detail screen, so the guard follows the buyer
    // there rather than clicking a grid button that no longer exists.
    await userEvent.click(
      await screen.findByRole("button", { name: /short sleeve t-shirt/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /add to cart/i }),
    );

    const cartCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/shop/cart"),
    );
    expect(cartCalls.length).toBeGreaterThan(0);
    for (const [, init] of cartCalls) {
      expect(String((init as RequestInit).body)).not.toContain(PAID_CART);
    }
  });

  it("keeps a buyer mid-checkout where they are when the widget repaints", async () => {
    // The same search id means no new tool result — only a repaint. Resetting
    // on those would throw away an OTP round trip every time the host redraws.
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "checkout",
        cartId: CART.cartId,
        quantities: { v1: 1 },
        lastSearchId: "search-1",
        checkout: {
          step: "method",
          paymentSessionId: "s1",
          orderId: "o1",
          phone: "8433719326",
          checkoutUrl: "https://payments.cashfree.com/order/#s1",
        },
      },
      setWidgetState: vi.fn(),
      openExternal,
    });

    render(
      <App
        toolMeta={{ products: PRODUCTS, searchId: "search-1" }}
        toolInput={{ query: "shirt" }}
      />,
    );

    expect(
      // The method screen is now the hosted-checkout filter picker.
      await screen.findByRole("button", { name: /on Cashfree/i }),
    ).toBeInTheDocument();
  });

  it("goes back to the address list from the payment screen, not out to the cart", async () => {
    // The wiring, not the hook: onBack on MethodSelector was setScreen("cart"),
    // which dropped the buyer out of checkout entirely. Changing a delivery
    // address then meant starting the whole flow again.
    vi.stubGlobal("openai", {
      widgetState: {
        screen: "checkout",
        cartId: CART.cartId,
        quantities: { v1: 1 },
        checkout: {
          step: "method",
          paymentSessionId: "s1",
          orderId: "o1",
          phone: "8433719326",
          checkoutUrl: "https://payments.cashfree.com/order/#s1",
        },
      },
      setWidgetState: vi.fn(),
      openExternal,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ addresses: [{ ...ADDRESS }] }),
      }),
    );

    render(
      <App toolMeta={{ products: PRODUCTS }} toolInput={{ query: "shirt" }} />,
    );
    expect(
      await screen.findByRole("button", { name: /on Cashfree/i }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^back$/i }));

    // The address step, not the cart.
    expect(await screen.findByText(/Delivery address/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^checkout$/i })).toBeNull();
  });

  it("shows a waiting state when no products have arrived yet", () => {
    render(<App toolMeta={null} toolInput={null} />);

    expect(screen.getByText(/searching|no products/i)).toBeInTheDocument();
  });
});
