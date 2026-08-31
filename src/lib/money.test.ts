import { describe, it, expect } from "vitest";
import { toMajor, toMinor, toMajorString, decimalDigits } from "./money";

describe("money", () => {
  it("divides two-decimal currencies by 100", () => {
    expect(toMajor(360000, "INR")).toBe(3600);
    expect(toMajor(2525, "USD")).toBe(25.25);
  });

  // JPY has no minor unit. Dividing it would bill a hundredth of the real
  // amount, which is the whole reason this is not a hardcoded 100.
  it("leaves zero-decimal currencies alone", () => {
    expect(decimalDigits("JPY")).toBe(0);
    expect(toMajor(2500, "JPY")).toBe(2500);
    expect(toMajorString(2500, "JPY")).toBe("2500");
  });

  it("renders a decimal string at the currency's own precision", () => {
    expect(toMajorString(360000, "INR")).toBe("3600.00");
    expect(toMajorString(1, "USD")).toBe("0.01");
  });
});

describe("toMinor", () => {
  // The mirror of toMajor, and the reason the search price filter needs it:
  // a buyer says "under 5k" and Shopify's filters.price.max is documented as
  // "Minimum/Maximum price in minor currency units". Sending 5000 there caps
  // the search at fifty rupees and returns almost nothing, which reads as an
  // empty store rather than a unit bug.
  it("converts major units to minor for a two-decimal currency", () => {
    expect(toMinor(5000, "INR")).toBe(500000);
  });

  it("does not multiply a zero-decimal currency", () => {
    // Yen has no minor unit. toMajor already takes the digit count from Intl
    // rather than assuming 100; this has to agree with it or a round trip
    // through the pair changes the number.
    expect(toMinor(5000, "JPY")).toBe(5000);
    expect(toMajor(toMinor(5000, "JPY"), "JPY")).toBe(5000);
  });

  it("rounds rather than truncating a fractional major amount", () => {
    // 24.99 * 100 is 2498.9999999999995 in binary floating point. Truncating
    // sends 2498 — a ceiling one paisa below what the buyer asked for, which
    // silently drops an item priced exactly at the limit.
    expect(toMinor(24.99, "USD")).toBe(2499);
  });
});
