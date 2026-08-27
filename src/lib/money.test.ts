import { describe, it, expect } from "vitest";
import { toMajor, toMajorString, decimalDigits } from "./money";

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
