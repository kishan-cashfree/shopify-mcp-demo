import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProducts } from "./useProducts";
import type { Product } from "../lib/ucp/types";

const HOST_PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    title: "from the host",
    handle: "host",
    imageUrl: "https://cdn.shopify.com/a.jpg",
    description: "",
    priceRange: {
      min: { amountMinor: 0, currency: "INR" },
      max: { amountMinor: 0, currency: "INR" },
    },
    variants: [],
  },
];

const SERVER_PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/2",
    title: "from the server",
    handle: "server",
    imageUrl: "https://cdn.shopify.com/b.jpg",
    description: "",
    priceRange: {
      min: { amountMinor: 0, currency: "INR" },
      max: { amountMinor: 0, currency: "INR" },
    },
    variants: [],
  },
];

describe("useProducts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ products: SERVER_PRODUCTS }),
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses what the host delivered, without asking the server", async () => {
    const { result } = renderHook(() =>
      useProducts("http://localhost:8787", HOST_PRODUCTS, "shirt", true),
    );

    expect(result.current).toEqual(HOST_PRODUCTS);
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("re-applies the buyer's price ceiling when it recovers", async () => {
    // The silent half of the "perfumes under 5k" bug. Recovery re-searches
    // through our own endpoint, so a ceiling left behind here hands back the
    // whole catalog — and nothing on screen says the filter was lost. Measured
    // against belvish on 2026-08-31: unfiltered, six of twenty perfumes were
    // over the limit, the dearest at Rs 20,900.
    renderHook(() =>
      useProducts("http://localhost:8787", [], "perfume", true, {
        max: 5000,
      }),
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 3_000 });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      query: "perfume",
      priceMin: undefined,
      priceMax: 5000,
    });
  });

  it("recovers the catalog when the host forgot it", async () => {
    // Measured in ChatGPT: a reload remounts the widget but never re-runs the
    // tool — four resources/read after the last SearchProducts — and
    // toolResponseMetadata comes back empty. The grid sat on "Searching the
    // store…" with nothing able to clear it.
    const { result } = renderHook(() =>
      useProducts("http://localhost:8787", [], "shirt", true),
    );

    // Longer than the grace the hook gives the host to answer first.
    await waitFor(() => expect(result.current).toEqual(SERVER_PRODUCTS), {
      timeout: 3_000,
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/shop/search");
    expect(String((init as RequestInit).body)).toContain("shirt");
  });

  it("lets the host deliver before asking the store itself", async () => {
    // On a reload the widget remounts with a stored query and no products, so
    // the fallback used to fire immediately and lose the race — Claude hands
    // the cached result back milliseconds later and the fetch was wasted.
    // Every live widget did this on every remount: 35 catalog fetches in one
    // session, and Shopify answered 429 Rate limit exceeded.
    const { rerender } = renderHook(
      ({ hosted }) =>
        useProducts("http://localhost:8787", hosted, "shirt", true),
      { initialProps: { hosted: [] as Product[] } },
    );

    // The host answers first, as it does on Claude.
    rerender({ hosted: HOST_PRODUCTS });

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fetch a catalog for a screen that shows no grid", async () => {
    // Every earlier widget in a conversation stays live and recovers on its
    // own. Measured: 35 catalog fetches in one session, most for widgets
    // parked mid-checkout, and Shopify answered with 429 Rate limit exceeded
    // on update_cart — the buyer's cart rendered empty as a result.
    const { result } = renderHook(() =>
      useProducts("http://localhost:8787", [], "shirt", false),
    );

    expect(result.current).toEqual([]);
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("stays quiet when there is no search to repeat", async () => {
    // A widget that has never searched has nothing to recover, and guessing a
    // query would put products in front of a buyer who never asked.
    const { result } = renderHook(() =>
      useProducts("http://localhost:8787", [], undefined, true),
    );

    expect(result.current).toEqual([]);
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("prefers the host once it delivers, even after a recovery", async () => {
    // The host's copy is the one the model is talking about.
    const { result, rerender } = renderHook(
      ({ hosted }) =>
        useProducts("http://localhost:8787", hosted, "shirt", true),
      { initialProps: { hosted: [] as Product[] } },
    );

    await waitFor(() => expect(result.current).toEqual(SERVER_PRODUCTS), {
      timeout: 3_000,
    });
    rerender({ hosted: HOST_PRODUCTS });

    expect(result.current).toEqual(HOST_PRODUCTS);
  });

  it("gives up quietly when the store cannot be reached", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() =>
      useProducts("http://localhost:8787", [], "shirt", true),
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 3_000 });
    expect(result.current).toEqual([]);
  });
});
