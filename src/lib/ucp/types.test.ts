import { describe, it, expect } from "vitest";
import searchFixture from "./__fixtures__/search-catalog.json";
import cartFixture from "./__fixtures__/cart.json";
import type { RawSearchResponse, RawCart } from "./types";

describe("UCP fixtures match declared raw types", () => {
  it("search fixture satisfies RawSearchResponse", () => {
    const parsed = searchFixture as RawSearchResponse;
    expect(parsed.products.length).toBeGreaterThan(0);
    const variant = parsed.products[0].variants[0];
    expect(typeof variant.id).toBe("string");
    expect(typeof variant.price.amount).toBe("number");
    expect(typeof variant.price.currency).toBe("string");
    expect(typeof variant.availability.available).toBe("boolean");
  });

  it("cart fixture satisfies RawCart", () => {
    const parsed = cartFixture as RawCart;
    expect(typeof parsed.id).toBe("string");
    expect(typeof parsed.continue_url).toBe("string");
    expect(typeof parsed.currency).toBe("string");
    expect(typeof parsed.line_items[0].item.price).toBe("number");
    expect(parsed.totals.some((t) => t.type === "total")).toBe(true);
  });
});
