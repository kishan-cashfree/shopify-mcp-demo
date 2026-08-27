import { describe, it, expect } from "vitest";
import { PAYMENT_METHOD_ICONS } from "./paymentIcons";

describe("PAYMENT_METHOD_ICONS", () => {
  it("has a cluster for every filter code the selector offers", () => {
    // Three, because Cashfree serves one card page: /payment-method/card,
    // with /credit-card and /debit-card both 404. Splitting the picker into
    // credit and debit gave two rows that opened the same screen.
    expect(Object.keys(PAYMENT_METHOD_ICONS).sort()).toEqual([
      "card",
      "nb",
      "upi",
    ]);
  });

  it("serves every icon from the domain the widget CSP declares", () => {
    // src/lib/server/app.ts lists https://cashfreelogo.cashfree.com as a
    // resource domain. An icon from anywhere else is blocked by the host and
    // renders as a broken image — silently, since a failed <img> logs nothing
    // the server can see.
    for (const icons of Object.values(PAYMENT_METHOD_ICONS)) {
      for (const icon of icons) {
        expect(icon.url).toMatch(
          /^https:\/\/cashfreelogo\.cashfree\.com\/assets_images\//,
        );
      }
    }
  });

  it("never falls back to the library's generic bank glyph", () => {
    // payments-icons-library@1.1.9 fuzzy-matches and never returns null:
    // getIcon("credit"), getIcon("card") and getIcon("netbanking") all resolve
    // to pg/nb/svg/default.svg — the constant its utility.js calls DEFAULT_URL,
    // i.e. the not-found placeholder, not a netbanking mark. getModesIcons
    // offers no mode logo either; it lists a category's members. Reaching for a
    // mode-level icon therefore produces a wrong picture rather than no
    // picture, so the clusters name real brands and this pins that.
    for (const icons of Object.values(PAYMENT_METHOD_ICONS)) {
      for (const icon of icons) {
        expect(icon.url).not.toContain("/default.svg");
      }
    }
  });

  it("names each brand, so a blocked icon still leaves a title", () => {
    for (const icons of Object.values(PAYMENT_METHOD_ICONS)) {
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) expect(icon.name).not.toBe("");
    }
  });
});
