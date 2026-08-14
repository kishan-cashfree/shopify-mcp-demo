import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCart } from "./useCart";
import type { Cart } from "../lib/ucp/types";

const CART: Cart = {
  cartId: "gid://shopify/Cart/abc",
  currency: "INR",
  continueUrl: "https://store.test/cart/c/abc",
  lines: [
    {
      lineId: "l1",
      variantId: "v1",
      title: "Tee - Red",
      quantity: 2,
      unitPrice: { amountMinor: 120000, currency: "INR" },
      lineSubtotal: { amountMinor: 240000, currency: "INR" },
      lineTotal: { amountMinor: 240000, currency: "INR" },
    },
  ],
  subtotal: { amountMinor: 240000, currency: "INR" },
  total: { amountMinor: 240000, currency: "INR" },
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const EMPTY = { quantities: {} };
let onPersist: ReturnType<typeof vi.fn>;

describe("useCart", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    onPersist = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("loads a cart it was handed, without waiting for the buyer to touch it", async () => {
    // The cart body lives only in this hook's state, and a new search now
    // remounts it. Without this the buyer opened their cart and saw it empty
    // until they changed a quantity — items they had definitely added,
    // flickering in a moment later.
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);

    const { result } = renderHook(() =>
      useCart(
        "http://localhost:8787",
        { cartId: CART.cartId, quantities: { v1: 2 } },
        onPersist,
      ),
    );

    await waitFor(() => expect(result.current.cart).toEqual(CART));
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(String((init as RequestInit).body)).toContain(CART.cartId);
  });

  it("does not call the store when there is no cart yet", async () => {
    // A first-time buyer has nothing to load, and creating an empty cart on
    // arrival would leave abandoned carts behind for every search.
    renderHook(() => useCart("http://localhost:8787", EMPTY, onPersist));

    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("creates a cart on the first add, with no cartId", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.cartId).toBeUndefined();
    expect(body.lines).toEqual([{ variantId: "v1", quantity: 1 }]);
    expect(result.current.cart?.cartId).toBe("gid://shopify/Cart/abc");
  });

  it("sends the cartId and the full line set on later changes", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v2", 4);
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect(body.cartId).toBe("gid://shopify/Cart/abc");
    // Declarative: the whole desired set, not a delta.
    expect(body.lines).toHaveLength(2);
  });

  it("renders from the server response, not from the requested quantity", async () => {
    // Requested 9, server says 2 — the server wins.
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 9);
    });

    expect(result.current.cart?.lines[0].quantity).toBe(2);
  });

  it("keeps the previous cart and reports the error when a mutation fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(CART) as never)
      .mockResolvedValueOnce(
        jsonResponse({ error: "Variant unavailable" }, 502) as never,
      );
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v1", 5);
    });

    expect(result.current.error).toBe("Variant unavailable");
    expect(result.current.cart).toEqual(CART);
  });

  it("reports a network failure without discarding the cart", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(CART) as never)
      .mockRejectedValueOnce(new Error("Failed to fetch"));
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v1", 5);
    });

    await waitFor(() => expect(result.current.error).toMatch(/Failed to fetch/));
    expect(result.current.cart).toEqual(CART);
  });

  it("clears a previous error on the next successful mutation", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 502) as never)
      .mockResolvedValueOnce(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });
    await act(async () => {
      await result.current.setQuantity("v1", 2);
    });

    expect(result.current.error).toBeNull();
  });

  it("persists the cart id and quantities after a successful mutation", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart("http://localhost:8787", EMPTY, onPersist),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });

    expect(onPersist).toHaveBeenCalledWith({
      cartId: "gid://shopify/Cart/abc",
      // Re-seeded from the server response, not from what was requested.
      quantities: { v1: 2 },
    });
  });

  it("resumes from a persisted snapshot after a host re-render", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(CART) as never);
    const { result } = renderHook(() =>
      useCart(
        "http://localhost:8787",
        { cartId: "gid://shopify/Cart/existing", quantities: { v9: 3 } },
        onPersist,
      ),
    );

    await act(async () => {
      await result.current.setQuantity("v1", 1);
    });

    // The last call, not the first: mounting with a cart id now loads the
    // cart before the buyer touches anything.
    const calls = vi.mocked(fetch).mock.calls;
    const body = JSON.parse(calls[calls.length - 1][1]?.body as string);
    expect(body.cartId).toBe("gid://shopify/Cart/existing");
    // The pre-existing line survives, because the call replaces the whole set.
    expect(body.lines).toContainEqual({ variantId: "v9", quantity: 3 });
    expect(body.lines).toContainEqual({ variantId: "v1", quantity: 1 });
  });
});
