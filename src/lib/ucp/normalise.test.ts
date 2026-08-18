import { describe, it, expect } from "vitest";
import {
  normaliseProducts,
  normaliseCart,
  formatMoney,
  stripHtml,
} from "./normalise";
import searchFixture from "./__fixtures__/search-catalog.json";
import cartFixture from "./__fixtures__/cart.json";
import discountedCartFixture from "./__fixtures__/cart-discounted.json";

describe("formatMoney", () => {
  it("renders INR minor units as major units", () => {
    expect(formatMoney({ amountMinor: 120000, currency: "INR" })).toContain(
      "1,200.00",
    );
  });

  it("does not divide zero-decimal currencies", () => {
    // 5000 JPY is ¥5,000 — not ¥50. Dividing by 100 unconditionally is the
    // classic money bug and this test is the guard against it.
    expect(formatMoney({ amountMinor: 5000, currency: "JPY" })).toContain(
      "5,000",
    );
    expect(formatMoney({ amountMinor: 5000, currency: "JPY" })).not.toContain(
      "50.00",
    );
  });

  it("renders zero", () => {
    expect(formatMoney({ amountMinor: 0, currency: "INR" })).toContain("0.00");
  });
});

describe("normaliseProducts", () => {
  it("maps the live fixture into internal products", () => {
    const products = normaliseProducts(searchFixture);

    expect(products.length).toBeGreaterThan(0);
    const first = products[0];
    expect(first.id).toMatch(/^gid:\/\/shopify\/Product\//);
    expect(typeof first.title).toBe("string");
    expect(first.variants.length).toBeGreaterThan(0);
  });

  it("carries variant id, price and availability", () => {
    const variant = normaliseProducts(searchFixture)[0].variants[0];

    expect(variant.id).toMatch(/^gid:\/\/shopify\/ProductVariant\//);
    expect(variant.price.amountMinor).toBeGreaterThan(0);
    expect(variant.price.currency).toBe("INR");
    expect(typeof variant.available).toBe("boolean");
  });

  it("falls back to product-level media when a variant has none", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          media: [{ type: "image", url: "https://cdn.test/p.jpg" }],
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 100, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    const [product] = normaliseProducts(raw);

    expect(product.imageUrl).toBe("https://cdn.test/p.jpg");
    expect(product.variants[0].imageUrl).toBe("https://cdn.test/p.jpg");
  });

  it("marks unavailable variants rather than dropping them", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          variants: [
            {
              id: "v1",
              title: "Sold out",
              price: { amount: 100, currency: "INR" },
              availability: { available: false },
            },
          ],
        },
      ],
    };

    const [product] = normaliseProducts(raw);

    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].available).toBe(false);
  });

  it("returns an empty array when the store matched nothing", () => {
    expect(normaliseProducts({ products: [] })).toEqual([]);
  });

  it("throws when the payload has no products key", () => {
    expect(() => normaliseProducts({ nope: true })).toThrow(
      /unexpected search payload/i,
    );
  });

  it("carries each variant's options through", () => {
    // The detail screen builds its picker from these. Dropped in milestone 1
    // because a grid card showed one variant and never needed to know the
    // axis it sat on.
    const products = normaliseProducts(searchFixture);
    const tee = products.find((p) => p.variants.length > 1)!;

    expect(tee.variants[0].options).toEqual([{ name: "Color", label: "Red" }]);
  });

  it("carries the product description through, as text", () => {
    const products = normaliseProducts(searchFixture);

    expect(typeof products[0].description).toBe("string");
    expect(products[0].description).not.toContain("<");
  });

  it("spans the variants with a price range", () => {
    const products = normaliseProducts(searchFixture);
    const tee = products.find((p) => p.variants.length > 1)!;
    const prices = tee.variants.map((v) => v.price.amountMinor);

    expect(tee.priceRange.min.amountMinor).toBe(Math.min(...prices));
    expect(tee.priceRange.max.amountMinor).toBe(Math.max(...prices));
  });

  it("collapses the range when one variant is the only one", () => {
    const products = normaliseProducts(searchFixture);
    const single = products.find((p) => p.variants.length === 1)!;

    expect(single.priceRange.min).toEqual(single.priceRange.max);
  });

  it("prices the range off available variants when any are available", () => {
    // A sold-out cheap colour must not set the headline price on a card the
    // buyer cannot actually buy at that figure.
    const products = normaliseProducts({
      products: [
        {
          id: "gid://shopify/Product/9",
          title: "Tee",
          variants: [
            {
              id: "v-cheap",
              title: "Cheap",
              price: { amount: 10000, currency: "INR" },
              availability: { available: false },
            },
            {
              id: "v-real",
              title: "Real",
              price: { amount: 50000, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    });

    expect(products[0].priceRange.min.amountMinor).toBe(50000);
  });

  it("falls back to every variant when none are available", () => {
    // Otherwise a fully sold-out product renders a range over an empty set.
    const products = normaliseProducts({
      products: [
        {
          id: "gid://shopify/Product/8",
          title: "Gone",
          variants: [
            {
              id: "v1",
              title: "One",
              price: { amount: 30000, currency: "INR" },
              availability: { available: false },
            },
          ],
        },
      ],
    });

    expect(products[0].priceRange.min.amountMinor).toBe(30000);
  });

  it("handles a product with no variants without throwing", () => {
    // Defensive: normaliseProducts already tolerates a missing variants array,
    // and a price range must not be the thing that starts throwing on it.
    const products = normaliseProducts({
      products: [{ id: "p", title: "Empty", variants: [] }],
    });

    expect(products[0].priceRange.min.amountMinor).toBe(0);
    expect(products[0].description).toBe("");
  });
});

describe("normaliseCart", () => {
  it("maps the live fixture into an internal cart", () => {
    const cart = normaliseCart(cartFixture);

    expect(cart.cartId).toMatch(/^gid:\/\/shopify\/Cart\//);
    expect(cart.continueUrl).toMatch(/^https:\/\//);
    expect(cart.currency).toBe("INR");
    expect(cart.lines.length).toBeGreaterThan(0);
  });

  it("applies cart-level currency to bare line-item prices", () => {
    const cart = normaliseCart(cartFixture);
    const line = cart.lines[0];

    expect(line.unitPrice.currency).toBe("INR");
    expect(line.unitPrice.amountMinor).toBeGreaterThan(0);
    expect(line.variantId).toMatch(/^gid:\/\/shopify\/ProductVariant\//);
  });

  it("reads the total from the totals array entry typed 'total'", () => {
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [],
      totals: [
        { type: "subtotal", amount: 100, display_text: "Subtotal" },
        { type: "total", amount: 150, display_text: "Total" },
      ],
    };

    expect(normaliseCart(raw).total.amountMinor).toBe(150);
  });

  it("falls back to zero when no total entry is present", () => {
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [],
      totals: [],
    };

    expect(normaliseCart(raw).total).toEqual({
      amountMinor: 0,
      currency: "INR",
    });
  });

  it("throws when continue_url is missing", () => {
    // Without it the Checkout button has no target, and a cart we cannot check
    // out of is worse than an error.
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      line_items: [],
      totals: [],
    };

    expect(() => normaliseCart(raw)).toThrow(/continue_url/i);
  });
});

describe("normaliseCart — discounts", () => {
  // Live capture from belvish.myshopify.com, which runs an automatic 5% offer.
  // A ₹24,500 item totalled ₹23,275 and the widget showed no reason why, so
  // the arithmetic on screen looked broken.
  it("surfaces the subtotal the discount was taken from", () => {
    const cart = normaliseCart(discountedCartFixture);

    expect(cart.subtotal).toEqual({ amountMinor: 2450000, currency: "INR" });
    expect(cart.total).toEqual({ amountMinor: 2327500, currency: "INR" });
  });

  it("exposes the discount as a positive amount with the store's own label", () => {
    // Positive here, negative in the payload. The view renders the minus sign,
    // so carrying a negative would print "-−₹1,225.00".
    const cart = normaliseCart(discountedCartFixture);

    expect(cart.discount).toEqual({
      label: "NOCHAINS",
      amount: { amountMinor: 122500, currency: "INR" },
    });
  });

  it("reconciles: subtotal minus discount equals total", () => {
    // The invariant the buyer checks by eye. If it ever fails, the widget is
    // showing three numbers that cannot all be true.
    const cart = normaliseCart(discountedCartFixture);

    expect(cart.subtotal.amountMinor - cart.discount!.amount.amountMinor).toBe(
      cart.total.amountMinor,
    );
  });

  it("leaves discount undefined on an undiscounted cart", () => {
    // The row must not render as "−₹0.00" on a normal cart.
    const cart = normaliseCart(cartFixture);

    expect(cart.discount).toBeUndefined();
    expect(cart.subtotal.amountMinor).toBe(cart.total.amountMinor);
  });

  it("falls back to the total when no subtotal row is present", () => {
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [],
      totals: [{ type: "total", amount: 150, display_text: "Total" }],
    };

    expect(normaliseCart(raw).subtotal.amountMinor).toBe(150);
  });

  it("sums multiple discounts under a generic label", () => {
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [],
      totals: [
        { type: "subtotal", amount: 1000, display_text: "Subtotal" },
        {
          type: "items_discount",
          amount: -300,
          display_text: "Item Discounts",
        },
        { type: "total", amount: 700, display_text: "Total" },
      ],
      discounts: {
        applied: [
          { title: "NOCHAINS", amount: 200 },
          { title: "WELCOME", amount: 100 },
        ],
      },
    };

    // Naming one of two would credit the wrong offer for the whole reduction.
    expect(normaliseCart(raw).discount).toEqual({
      label: "Discounts",
      amount: { amountMinor: 300, currency: "INR" },
    });
  });

  it("keeps the line's pre-discount subtotal alongside its discounted total", () => {
    // Both are needed to strike one through and print the other.
    const line = normaliseCart(discountedCartFixture).lines[0];

    expect(line.lineSubtotal).toEqual({
      amountMinor: 2450000,
      currency: "INR",
    });
    expect(line.lineTotal).toEqual({ amountMinor: 2327500, currency: "INR" });
  });

  it("derives a line subtotal from unit price when the row is absent", () => {
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [
        {
          id: "gid://shopify/CartLine/1",
          quantity: 3,
          item: {
            id: "gid://shopify/ProductVariant/1",
            title: "Tee",
            price: 500,
          },
          totals: [],
        },
      ],
      totals: [{ type: "total", amount: 1500, display_text: "Total" }],
    };

    expect(normaliseCart(raw).lines[0].lineSubtotal.amountMinor).toBe(1500);
  });

  it("still reports a discount when the payload names none", () => {
    // The totals row is the source of truth for the money; the title is only a
    // nicety. A missing title must not swallow a real reduction.
    const raw = {
      id: "gid://shopify/Cart/abc",
      currency: "INR",
      continue_url: "https://store.test/cart/c/abc",
      line_items: [],
      totals: [
        { type: "subtotal", amount: 1000, display_text: "Subtotal" },
        {
          type: "items_discount",
          amount: -250,
          display_text: "Item Discounts",
        },
        { type: "total", amount: 750, display_text: "Total" },
      ],
    };

    expect(normaliseCart(raw).discount).toEqual({
      label: "Discount",
      amount: { amountMinor: 250, currency: "INR" },
    });
  });
});

describe("normaliseProducts — Cashfree cart_items support", () => {
  it("carries the product handle", () => {
    const products = normaliseProducts(searchFixture);
    expect(products[0].handle).toBeTruthy();
    expect(typeof products[0].handle).toBe("string");
  });

  it("carries list_price as the variant's original price", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          handle: "thing",
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 900, currency: "INR" },
              list_price: { amount: 1200, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    const [product] = normaliseProducts(raw);

    expect(product.variants[0].price.amountMinor).toBe(900);
    expect(product.variants[0].listPrice.amountMinor).toBe(1200);
  });

  it("falls back to price when list_price is absent", () => {
    // Not every product is discounted, and Cashfree wants both fields.
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          handle: "thing",
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 900, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    expect(normaliseProducts(raw)[0].variants[0].listPrice.amountMinor).toBe(
      900,
    );
  });

  it("defaults handle to an empty string when absent", () => {
    const raw = {
      products: [
        {
          id: "p1",
          title: "Thing",
          variants: [
            {
              id: "v1",
              title: "Default",
              price: { amount: 900, currency: "INR" },
              availability: { available: true },
            },
          ],
        },
      ],
    };

    expect(normaliseProducts(raw)[0].handle).toBe("");
  });
});

describe("stripHtml", () => {
  it("returns the text inside markup", () => {
    expect(stripHtml("<p>A soft cotton <b>tee</b>.</p>")).toBe(
      "A soft cotton tee.",
    );
  });

  it("drops a script body rather than leaving it as text", () => {
    // The description is store-controlled and lands in the same document as
    // the buyer's OTP and cart. Leaving the body behind would render the
    // source of an attack as prose — visible, but still exfiltrated content.
    expect(stripHtml("<script>alert(1)</script>Hello")).toBe("Hello");
  });

  it("decodes the entities Shopify sends", () => {
    expect(stripHtml("Ben &amp; Jerry&#39;s &lt;3")).toBe("Ben & Jerry's <3");
  });

  it("collapses whitespace left by block tags", () => {
    expect(stripHtml("<p>One</p>\n\n<p>Two</p>")).toBe("One Two");
  });

  it("returns an empty string for nothing", () => {
    expect(stripHtml(undefined)).toBe("");
  });
});
