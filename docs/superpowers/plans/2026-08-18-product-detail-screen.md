# Product Detail Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the widget a product detail screen with a variant picker and an add-to-cart stepper, and collapse the catalog grid from one card per variant to one card per product.

**Architecture:** Everything renders from the `search_catalog` payload the widget already holds. `normalise.ts` stops discarding description and variant options; a new `ProductDetail` screen reads a product out of that catalog by id. No new call leaves for Shopify — this widget remounts as the buyer scrolls, and a fetch per product view is the pattern that already produced a Shopify `429` here.

**Tech Stack:** TypeScript, React 18, vitest + @testing-library/react, Tailwind v4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-product-detail-screen-design.md`

## Global Constraints

- TDD is mandatory: write the failing test, **run it and see it fail**, then implement. The repo treats an unseen-failing test as no test.
- Comments explain *why*, carrying the measured evidence — a symptom, a timestamp, a log line. Match that density; it is the house style.
- Commit messages: 1–2 lines, imperative, no co-author trailer.
- No new dependencies for anything the standard library covers.
- Money is always `Money { amountMinor, currency }` internally. Never divide by 100 — use `formatMoney`.
- `npm run type-check` and `npm run test:run` are the only gates. There is no lint step.
- Fixtures in `src/lib/ucp/__fixtures__/` are real captured Shopify responses. Do not edit them to make a test pass.
- Run `npx prettier --write` on every `.ts`/`.tsx` file you touch. Do **not** prettier the `.md` files — the existing docs do not conform and reformatting buries the diff.
- Baseline before you start: 346 tests across 33 files, all passing.

---

### Task 1: Carry description and variant options through normalisation

**Files:**
- Modify: `src/lib/ucp/types.ts`
- Modify: `src/lib/ucp/normalise.ts`
- Test: `src/lib/ucp/normalise.test.ts`

**Interfaces:**
- Consumes: nothing — this is the base of the stack.
- Produces:
  - `interface VariantOption { name: string; label: string }`
  - `Variant.options: VariantOption[]`
  - `Product.description: string`
  - `Product.priceRange: { min: Money; max: Money }`
  - `stripHtml(html: string | undefined): string` — exported from `normalise.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ucp/normalise.test.ts`, inside the existing `describe("normaliseProducts", ...)` block:

```ts
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
```

And a new top-level block at the end of the file:

```ts
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
```

Update the import at the top of the file:

```ts
import {
  normaliseProducts,
  normaliseCart,
  formatMoney,
  stripHtml,
} from "./normalise";
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lib/ucp/normalise.test.ts`
Expected: FAIL — `stripHtml` is not exported, and `options` / `description` / `priceRange` do not exist on the normalised objects.

- [ ] **Step 3: Add the types**

In `src/lib/ucp/types.ts`, add above `interface Variant`:

```ts
/** One axis of a variant, as Shopify names it: `{ name: "Color", label: "Red" }`. */
export interface VariantOption {
  name: string;
  label: string;
}
```

Add to `interface Variant`:

```ts
  /**
   * The axes this variant sits on. The detail screen's picker is derived from
   * these rather than declared, so a store that sells by Size or by Scent
   * needs no code change.
   */
  options: VariantOption[];
```

Add to `interface Product`:

```ts
  /**
   * Tags stripped. Store-controlled markup rendered in the same document as
   * the buyer's cart and OTP entry is script injection, and the widget CSP
   * governs external origins only — it does nothing about markup we inject
   * ourselves. Empty string when the store supplied none.
   */
  description: string;
  /**
   * Lowest and highest variant price, for the grid card. `min` equals `max`
   * when the variants agree. Derived from the variants rather than read from
   * `price_range`, so a card can never advertise a price no variant on it can
   * actually be bought at.
   */
  priceRange: { min: Money; max: Money };
```

`RawVariant.options` and `RawProduct.description` already exist in this file. Leave them alone.

- [ ] **Step 4: Implement in `normalise.ts`**

Add near the top, after `formatMoney`:

```ts
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Reduces a store's description HTML to plain text.
 *
 * Script and style bodies are removed rather than unwrapped: leaving the text
 * of a `<script>` behind renders an attack as prose, which is visible but
 * still puts attacker-authored content on a screen that also collects an OTP.
 *
 * Written by hand rather than pulled in as a sanitiser, because the output is
 * text — there is no markup to keep safe, so there is no allowlist to get
 * wrong. A sanitiser would be a dependency and a standing security surface for
 * formatting this widget has decided not to render.
 */
export function stripHtml(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The span a grid card advertises.
 *
 * Priced off available variants wherever any exist: a sold-out cheap colour
 * setting the headline price puts a number on the card that cannot be paid.
 * Falls back to every variant when the whole product is gone, so a sold-out
 * product still renders a price instead of a range over an empty set.
 */
function priceRangeOf(variants: Variant[]): { min: Money; max: Money } {
  const sellable = variants.filter((v) => v.available);
  const pool = sellable.length > 0 ? sellable : variants;
  if (pool.length === 0) {
    // Unreachable against a real store — Shopify does not return a product
    // with no variants — but normaliseProducts already tolerates a missing
    // variants array, and a price range must not be the thing that starts
    // throwing on it. The currency is arbitrary because there is no variant
    // to read one from; nothing renders this, because a product with no
    // variants has nothing to buy.
    const zero: Money = { amountMinor: 0, currency: "INR" };
    return { min: zero, max: { ...zero } };
  }

  return pool.reduce(
    (range, variant) => ({
      min:
        variant.price.amountMinor < range.min.amountMinor
          ? variant.price
          : range.min,
      max:
        variant.price.amountMinor > range.max.amountMinor
          ? variant.price
          : range.max,
    }),
    { min: pool[0].price, max: pool[0].price },
  );
}
```

In `normaliseVariant`, add to the returned object:

```ts
    options: raw.options ?? [],
```

In `normaliseProducts`, replace the returned object with:

```ts
    const variants = (product.variants ?? []).map((v) =>
      normaliseVariant(v, productImage),
    );
    return {
      id: product.id,
      title: product.title,
      handle: product.handle ?? "",
      imageUrl: productImage,
      description: stripHtml(product.description?.html),
      priceRange: priceRangeOf(variants),
      variants,
    };
```

Add `Money` to the type import at the top of the file if it is not already there.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/lib/ucp/normalise.test.ts`
Expected: PASS.

Then `npm run type-check`. Expect failures in `Results.test.tsx` and anywhere else that builds a `Product` literal — the new required fields. Fix those by adding `description: ""` and a `priceRange` matching the fixture's variant prices to each literal, and `options: []` to each variant literal. Do not make the fields optional to dodge this: optional is a lie, since every normalised product has them.

- [ ] **Step 6: Run the full suite**

Run: `npm run test:run`
Expected: 346 + 12 = 358 passing, 33 files.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/ucp/types.ts src/lib/ucp/normalise.ts src/lib/ucp/normalise.test.ts src/components/Results.test.tsx
git add src/lib/ucp src/components/Results.test.tsx
git commit -m "feat: carry description, variant options and a price range through normalisation"
```

---

### Task 2: Share the cart item count

**Files:**
- Create: `src/lib/widget/cartCount.ts`
- Create: `src/lib/widget/cartCount.test.ts`
- Modify: `src/components/Results.tsx:44-47`

**Interfaces:**
- Consumes: `Cart` from `src/lib/ucp/types`.
- Produces: `cartItemCount(cart: Cart | null | undefined): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/widget/cartCount.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cartItemCount } from "./cartCount";
import type { Cart } from "../ucp/types";

const money = { amountMinor: 0, currency: "INR" };

function cartWith(quantities: number[]): Cart {
  return {
    cartId: "gid://shopify/Cart/abc",
    currency: "INR",
    continueUrl: "https://store.test/cart/c/abc",
    lines: quantities.map((quantity, i) => ({
      lineId: `l${i}`,
      variantId: `v${i}`,
      title: `Item ${i}`,
      quantity,
      unitPrice: money,
      lineSubtotal: money,
      lineTotal: money,
    })),
    subtotal: money,
    total: money,
  };
}

describe("cartItemCount", () => {
  it("sums the quantities, not the lines", () => {
    // Two lines of three is six items. Counting lines would put "2 items"
    // under a cart holding six.
    expect(cartItemCount(cartWith([3, 3]))).toBe(6);
  });

  it("is zero for an empty cart", () => {
    expect(cartItemCount(cartWith([]))).toBe(0);
  });

  it("is zero before a cart exists", () => {
    // The grid renders before the first add, and useCart hands back null
    // until then.
    expect(cartItemCount(null)).toBe(0);
    expect(cartItemCount(undefined)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/widget/cartCount.test.ts`
Expected: FAIL — cannot resolve `./cartCount`.

- [ ] **Step 3: Implement**

Create `src/lib/widget/cartCount.ts`:

```ts
import type { Cart } from "../ucp/types";

/**
 * How many items are in the cart, for the badge both the grid and the detail
 * screen render.
 *
 * Derived on every render rather than stored. The two screens cannot disagree
 * because there is no counter to keep in step: `useCart.setQuantity` is the
 * only path that mutates a cart, and it re-seeds from the server's answer.
 */
export function cartItemCount(cart: Cart | null | undefined): number {
  return (cart?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/widget/cartCount.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Use it in `Results.tsx`**

Replace lines 44-47:

```ts
  const itemCount = (cart?.lines ?? []).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );
```

with:

```ts
  const itemCount = cartItemCount(cart);
```

and add the import:

```ts
import { cartItemCount } from "../lib/widget/cartCount";
```

- [ ] **Step 6: Run the full suite**

Run: `npm run test:run`
Expected: 361 passing. `Results.test.tsx` must still pass untouched — it is the proof the extraction changed no behaviour.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/widget/cartCount.ts src/lib/widget/cartCount.test.ts src/components/Results.tsx
git add src/lib/widget/cartCount.ts src/lib/widget/cartCount.test.ts src/components/Results.tsx
git commit -m "refactor: share the cart item count between screens"
```

---

### Task 3: Reset the detail screen on a new search

**Files:**
- Modify: `src/types/index.ts` — `Screen`, `WidgetState`
- Modify: `src/lib/widget/session.ts`
- Test: `src/lib/widget/session.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Screen` now includes `"product"`; `WidgetState.selectedProductId?: string` and `WidgetState.selectedVariantId?: string`.

Do this **before** building the screen. Host state outlives any one widget, and the reset is the part that is easy to forget once the screen already works.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/widget/session.test.ts`, inside `describe("applySearchResult", ...)`:

```ts
  it("clears the product detail selection on a new search", () => {
    // Host widget state outlives any one widget, so a second search rehydrates
    // holding whatever the last one left. Measured for `screen: "checkout"`:
    // the server answered the second search at 21:04:54 with 200 in 411ms and
    // the buyer was looking at "Payment received". A detail screen inherits
    // that exactly — without this, searching again lands on the detail page
    // for a product the new search never returned.
    const viewing: WidgetState = {
      screen: "product",
      quantities: {},
      lastSearchId: "s1",
      selectedProductId: "gid://shopify/Product/1",
      selectedVariantId: "gid://shopify/ProductVariant/1",
    };

    const next = applySearchResult(viewing, "s2", "pants");

    expect(next.screen).toBe("results");
    expect(next.selectedProductId).toBeUndefined();
    expect(next.selectedVariantId).toBeUndefined();
  });

  it("leaves the selection alone on a repaint of the same search", () => {
    // A repaint carries the same searchId. Clearing here would throw a buyer
    // off the detail screen every time the host re-rendered the widget.
    const viewing: WidgetState = {
      screen: "product",
      quantities: {},
      lastSearchId: "s1",
      selectedProductId: "gid://shopify/Product/1",
      selectedVariantId: "gid://shopify/ProductVariant/1",
    };

    expect(applySearchResult(viewing, "s1", "pants")).toBe(viewing);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/widget/session.test.ts`
Expected: FAIL — `"product"` is not assignable to `Screen`, and the two fields do not exist.

- [ ] **Step 3: Widen the types**

In `src/types/index.ts`, change:

```ts
export type Screen = "results" | "cart" | "checkout";
```

to:

```ts
export type Screen = "results" | "product" | "cart" | "checkout";
```

Update the doc comment above it — it currently opens "Only three values." Make it four.

Add to `interface WidgetState`:

```ts
  /**
   * The product the detail screen is showing, and the variant chosen there.
   *
   * Both are cleared by applySearchResult on a search this widget has not
   * seen, for the same reason `screen` is: host state outlives the widget, so
   * without it a new search renders the detail page for a product that search
   * never returned.
   */
  selectedProductId?: string;
  selectedVariantId?: string;
```

- [ ] **Step 4: Clear them in `session.ts`**

In `applySearchResult`, extend the `next` object:

```ts
  const next: WidgetState = {
    ...prev,
    lastSearchId: searchId,
    screen: "results",
    // Asking to browse means show me products, so the detail screen's
    // selection goes with the screen. Left behind, it would re-open on a
    // product the new search never returned.
    selectedProductId: undefined,
    selectedVariantId: undefined,
    query: query ?? prev.query,
  };
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/lib/widget/session.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm run test:run` — expect 363 passing.

```bash
npx prettier --write src/types/index.ts src/lib/widget/session.ts src/lib/widget/session.test.ts
git add src/types/index.ts src/lib/widget/session.ts src/lib/widget/session.test.ts
git commit -m "feat: reset the product detail selection when the buyer searches again"
```

---

### Task 4: The product detail screen

**Files:**
- Create: `src/components/ProductDetail.tsx`
- Create: `src/components/ProductDetail.test.tsx`

**Interfaces:**
- Consumes: `Cart`, `Product`, `Variant` from `src/lib/ucp/types` (options are reached through `Variant.options`, so `VariantOption` is not imported); `formatMoney` from `src/lib/ucp/normalise`; `cartItemCount` from `src/lib/widget/cartCount`.
- Produces:

```ts
interface ProductDetailProps {
  product: Product;
  selectedVariantId?: string;
  cart: Cart | null;
  busy: boolean;
  onSelectVariant: (variantId: string) => void;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onViewCart: () => void;
  onBack: () => void;
}
export function ProductDetail(props: ProductDetailProps): JSX.Element;
```

This component holds **no state**. The selected variant is a prop, because it lives in `WidgetState` and must survive the remount that happens when the buyer scrolls.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ProductDetail.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductDetail } from "./ProductDetail";
import type { Product } from "../lib/ucp/types";

const inr = (amountMinor: number) => ({ amountMinor, currency: "INR" });

const TEE: Product = {
  id: "gid://shopify/Product/1",
  title: "short sleeve t-shirt",
  handle: "short-sleeve-t-shirt",
  imageUrl: "https://cdn.shopify.com/tee.jpg",
  description: "A soft cotton tee, cut for everyday wear.",
  priceRange: { min: inr(120000), max: inr(140000) },
  variants: [
    {
      id: "v-red",
      title: "Red",
      price: inr(120000),
      listPrice: inr(150000),
      available: true,
      imageUrl: "https://cdn.shopify.com/red.jpg",
      options: [{ name: "Color", label: "Red" }],
    },
    {
      id: "v-blue",
      title: "Blue",
      price: inr(130000),
      listPrice: inr(130000),
      available: true,
      options: [{ name: "Color", label: "Blue" }],
    },
    {
      id: "v-black",
      title: "Black",
      price: inr(140000),
      listPrice: inr(140000),
      available: false,
      options: [{ name: "Color", label: "Black" }],
    },
  ],
};

/** Shopify's placeholder for a product that has no real options. */
const HOODY: Product = {
  id: "gid://shopify/Product/2",
  title: "Hoody",
  handle: "hoody",
  description: "Heavyweight fleece.",
  priceRange: { min: inr(240000), max: inr(240000) },
  variants: [
    {
      id: "v-hoody",
      title: "Default Title",
      price: inr(240000),
      listPrice: inr(240000),
      available: true,
      options: [{ name: "Title", label: "Default Title" }],
    },
  ],
};

const BASE = {
  cart: null,
  busy: false,
  onSelectVariant: vi.fn(),
  onQuantityChange: vi.fn(),
  onViewCart: vi.fn(),
  onBack: vi.fn(),
};

describe("ProductDetail", () => {
  it("shows the description the grid had no room for", () => {
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />);

    expect(
      screen.getByText("A soft cotton tee, cut for everyday wear."),
    ).toBeInTheDocument();
  });

  it("prices the selected variant, not the product", () => {
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-blue" />);

    expect(screen.getByText(/1,300\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/1,200\.00/)).not.toBeInTheDocument();
  });

  it("strikes through a real compare-at price only", () => {
    // listPrice falls back to price on undiscounted variants, so rendering it
    // unconditionally invents a saving of zero.
    const { rerender } = render(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />,
    );
    expect(screen.getByText(/1,500\.00/)).toBeInTheDocument();

    rerender(
      <ProductDetail {...BASE} product={TEE} selectedVariantId="v-blue" />,
    );
    expect(screen.queryByText(/1,300\.00/)).toBeInTheDocument();
    expect(document.querySelector("s")).toBeNull();
  });

  it("builds one picker row per option axis", () => {
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />);

    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });

  it("renders no picker for Shopify's Default Title placeholder", () => {
    // Every single-variant product carries { name: "Title", label:
    // "Default Title" }. That is a placeholder, not an axis — rendering it
    // gives the buyer one button called "Default Title".
    render(
      <ProductDetail {...BASE} product={HOODY} selectedVariantId="v-hoody" />,
    );

    expect(screen.queryByText("Title")).not.toBeInTheDocument();
    expect(screen.queryByText("Default Title")).not.toBeInTheDocument();
  });

  it("disables a sold-out option rather than hiding it", () => {
    // Hiding Black leaves a buyer wondering why three colours are two.
    render(<ProductDetail {...BASE} product={TEE} selectedVariantId="v-red" />);

    expect(screen.getByRole("button", { name: "Black" })).toBeDisabled();
  });

  it("reports the variant the buyer picked", async () => {
    const onSelectVariant = vi.fn();
    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-red"
        onSelectVariant={onSelectVariant}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Blue" }));

    expect(onSelectVariant).toHaveBeenCalledWith("v-blue");
  });

  it("adds the selected variant, at quantity one", async () => {
    const onQuantityChange = vi.fn();
    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-blue"
        onQuantityChange={onQuantityChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /add/i }));

    expect(onQuantityChange).toHaveBeenCalledWith("v-blue", 1);
  });

  it("becomes a stepper once the variant is in the cart", async () => {
    const onQuantityChange = vi.fn();
    const cart = {
      cartId: "c1",
      currency: "INR",
      continueUrl: "https://store.test/c/1",
      lines: [
        {
          lineId: "l1",
          variantId: "v-blue",
          title: "Blue",
          quantity: 2,
          unitPrice: inr(130000),
          lineSubtotal: inr(260000),
          lineTotal: inr(260000),
        },
      ],
      subtotal: inr(260000),
      total: inr(260000),
    };

    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-blue"
        cart={cart}
        onQuantityChange={onQuantityChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /increase/i }));

    expect(onQuantityChange).toHaveBeenCalledWith("v-blue", 3);
  });

  it("falls back to the first available variant when none is selected", () => {
    // A remount can arrive with selectedVariantId cleared. Rendering nothing
    // priced would be worse than picking the variant the grid would have.
    render(<ProductDetail {...BASE} product={TEE} />);

    expect(screen.getByText(/1,200\.00/)).toBeInTheDocument();
  });

  it("offers a way back to the grid", async () => {
    const onBack = vi.fn();
    render(
      <ProductDetail
        {...BASE}
        product={TEE}
        selectedVariantId="v-red"
        onBack={onBack}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/ProductDetail.test.tsx`
Expected: FAIL — cannot resolve `./ProductDetail`.

- [ ] **Step 3: Implement**

Create `src/components/ProductDetail.tsx`:

```tsx
import { formatMoney } from "../lib/ucp/normalise";
import { cartItemCount } from "../lib/widget/cartCount";
import type { Cart, Product, Variant } from "../lib/ucp/types";

interface ProductDetailProps {
  product: Product;
  /** Undefined after a remount that cleared it — see selectedVariant below. */
  selectedVariantId?: string;
  cart: Cart | null;
  busy: boolean;
  onSelectVariant: (variantId: string) => void;
  onQuantityChange: (variantId: string, quantity: number) => void;
  onViewCart: () => void;
  onBack: () => void;
}

/**
 * Shopify sends `{ name: "Title", label: "Default Title" }` for every product
 * that has no real options. Rendering it produces a picker with one button
 * called "Default Title", so an axis is only real when the product has more
 * than one variant to choose between.
 */
function optionAxes(product: Product): string[] {
  if (product.variants.length < 2) return [];
  const names: string[] = [];
  for (const variant of product.variants) {
    for (const option of variant.options) {
      if (!names.includes(option.name)) names.push(option.name);
    }
  }
  return names;
}

/** The variants offering a given label on a given axis. */
function variantsFor(product: Product, name: string, label: string): Variant[] {
  return product.variants.filter((variant) =>
    variant.options.some((o) => o.name === name && o.label === label),
  );
}

function labelsFor(product: Product, name: string): string[] {
  const labels: string[] = [];
  for (const variant of product.variants) {
    for (const option of variant.options) {
      if (option.name === name && !labels.includes(option.label)) {
        labels.push(option.label);
      }
    }
  }
  return labels;
}

export function ProductDetail({
  product,
  selectedVariantId,
  cart,
  busy,
  onSelectVariant,
  onQuantityChange,
  onViewCart,
  onBack,
}: ProductDetailProps) {
  // A remount can arrive with the selection cleared. Falling back to the first
  // available variant renders something priced and buyable rather than an
  // empty screen; it matches what the grid card would have shown.
  const selected =
    product.variants.find((v) => v.id === selectedVariantId) ??
    product.variants.find((v) => v.available) ??
    product.variants[0];

  const quantity =
    cart?.lines.find((line) => line.variantId === selected?.id)?.quantity ?? 0;
  const itemCount = cartItemCount(cart);
  const axes = optionAxes(product);

  if (!selected) return null;

  const image = selected.imageUrl ?? product.imageUrl;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-black/10 p-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium"
          aria-label="Back to results"
        >
          ← Back
        </button>
        {itemCount > 0 && (
          <span className="text-sm text-secondary">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {image ? (
          <img
            src={image}
            alt={product.title}
            className="aspect-square w-full rounded-xl object-cover"
          />
        ) : (
          <div className="aspect-square w-full rounded-xl bg-black/5" />
        )}

        <h2 className="text-base font-semibold">{product.title}</h2>

        {/* listPrice falls back to price on undiscounted variants, so only a
            strictly higher value is a real compare-at price. Rendering it
            otherwise invents a saving of zero. */}
        <p className="flex items-baseline gap-2 text-lg font-semibold">
          {formatMoney(selected.price)}
          {selected.listPrice.amountMinor > selected.price.amountMinor && (
            <s className="text-sm font-normal text-secondary">
              {formatMoney(selected.listPrice)}
            </s>
          )}
        </p>

        {product.description && (
          <p className="text-sm text-secondary">{product.description}</p>
        )}

        {axes.map((name) => (
          <div key={name} className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-secondary">{name}</p>
            <div className="flex flex-wrap gap-2">
              {labelsFor(product, name).map((label) => {
                const matches = variantsFor(product, name, label);
                const target =
                  matches.find((v) => v.available) ?? matches[0];
                const isSelected = selected.options.some(
                  (o) => o.name === name && o.label === label,
                );
                return (
                  <button
                    key={label}
                    type="button"
                    // Sold out renders disabled rather than hidden: hiding
                    // Black leaves a buyer wondering why three colours are two.
                    disabled={!matches.some((v) => v.available) || busy}
                    onClick={() => target && onSelectVariant(target.id)}
                    className={`rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSelected
                        ? "border-black/70 font-medium"
                        : "border-black/15"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {quantity > 0 ? (
          <div className="flex items-center justify-between rounded-lg border border-black/15 px-3 py-2">
            <button
              type="button"
              aria-label={`Decrease quantity of ${product.title}`}
              disabled={busy}
              onClick={() => onQuantityChange(selected.id, quantity - 1)}
              className="h-8 w-8 disabled:opacity-40"
            >
              −
            </button>
            <span className="text-sm font-medium">{quantity}</span>
            <button
              type="button"
              aria-label={`Increase quantity of ${product.title}`}
              disabled={busy}
              onClick={() => onQuantityChange(selected.id, quantity + 1)}
              className="h-8 w-8 disabled:opacity-40"
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!selected.available || busy}
            onClick={() => onQuantityChange(selected.id, 1)}
            className="rounded-xl bg-black/90 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selected.available ? "Add to cart" : "Unavailable"}
          </button>
        )}
      </div>

      {cart && itemCount > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-black/10 bg-surface p-3">
          <span className="text-sm">
            {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold">{formatMoney(cart.total)}</span>
          </span>
          <button
            type="button"
            onClick={onViewCart}
            className="rounded-xl bg-black/90 px-4 py-2 text-sm font-semibold text-white"
          >
            View cart
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/components/ProductDetail.test.tsx`
Expected: PASS, 11 tests.

If "adds the selected variant" fails on an ambiguous match, note that `Add to cart` and `View cart` both match `/add/i` only if the cart is non-null — `BASE.cart` is null, so the sticky bar does not render. Keep it that way.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/ProductDetail.tsx src/components/ProductDetail.test.tsx
git add src/components/ProductDetail.tsx src/components/ProductDetail.test.tsx
git commit -m "feat: add a product detail screen with a variant picker"
```

---

### Task 5: Collapse the grid to one card per product

**Files:**
- Modify: `src/components/Results.tsx`
- Test: `src/components/Results.test.tsx`

**Interfaces:**
- Consumes: `cartItemCount` (Task 2), `Product.priceRange` (Task 1).
- Produces: `ResultsProps` loses `onQuantityChange` and gains `onOpenProduct: (productId: string) => void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/Results.test.tsx`. The `PRODUCTS` fixture already gained `description`, `priceRange` and `options` in Task 1; extend the first product to carry three variants so a collapse is observable:

```tsx
  it("renders one card per product, not one per variant", async () => {
    // The demo store's t-shirt is three variants. Before the detail screen
    // existed the grid showed each as its own card, so one product a buyer
    // thinks of as one thing occupied three tiles.
    render(<Results {...BASE} products={MULTI_VARIANT} onOpenProduct={vi.fn()} />);

    expect(screen.getAllByText("short sleeve t-shirt")).toHaveLength(1);
  });

  it("shows a price range when the variants disagree", () => {
    render(<Results {...BASE} products={MULTI_VARIANT} onOpenProduct={vi.fn()} />);

    expect(screen.getByText(/1,200\.00\s*–\s*.*1,400\.00/)).toBeInTheDocument();
  });

  it("shows one price when the variants agree", () => {
    render(<Results {...BASE} products={MULTI_VARIANT} onOpenProduct={vi.fn()} />);

    // The Hoody in the fixture is a single variant at ₹2,500.
    expect(screen.getByText(/^₹2,500\.00$/)).toBeInTheDocument();
  });

  it("summarises the options a product offers", () => {
    render(<Results {...BASE} products={MULTI_VARIANT} onOpenProduct={vi.fn()} />);

    expect(screen.getByText("3 colors")).toBeInTheDocument();
  });

  it("opens the detail screen for the product tapped", async () => {
    const onOpenProduct = vi.fn();
    render(
      <Results {...BASE} products={MULTI_VARIANT} onOpenProduct={onOpenProduct} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /short sleeve t-shirt/i }),
    );

    expect(onOpenProduct).toHaveBeenCalledWith("gid://shopify/Product/1");
  });

  it("badges a product that has variants in the cart", () => {
    const cart = {
      cartId: "c1",
      currency: "INR",
      continueUrl: "https://store.test/c/1",
      lines: [
        {
          lineId: "l1",
          variantId: "v-red",
          title: "Red",
          quantity: 2,
          unitPrice: { amountMinor: 120000, currency: "INR" },
          lineSubtotal: { amountMinor: 240000, currency: "INR" },
          lineTotal: { amountMinor: 240000, currency: "INR" },
        },
      ],
      subtotal: { amountMinor: 240000, currency: "INR" },
      total: { amountMinor: 240000, currency: "INR" },
    };

    render(
      <Results
        {...BASE}
        products={MULTI_VARIANT}
        cart={cart}
        onOpenProduct={vi.fn()}
      />,
    );

    // The badge counts the product's variants, so two Reds read as 2 — not as
    // one line.
    expect(screen.getByText("2")).toBeInTheDocument();
  });
```

Define `MULTI_VARIANT` near the other fixtures in that file: the t-shirt with `v-red` (₹1,200, available, `{name:"Color",label:"Red"}`), `v-blue` (₹1,300, available, Blue), `v-black` (₹1,400, unavailable, Black), `priceRange: { min: 120000, max: 140000 }`; and a Hoody with a single available variant at ₹2,500, `priceRange` min equal to max, `options: [{name:"Title",label:"Default Title"}]`.

Delete the existing tests that assert per-variant stepper behaviour on the grid — `onQuantityChange` is no longer a prop of `Results`. That behaviour is now covered by `ProductDetail.test.tsx`. Do not keep them passing by keeping the prop.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/components/Results.test.tsx`
Expected: FAIL — `onOpenProduct` is not a prop, and the grid still renders a stepper.

- [ ] **Step 3: Implement**

Rewrite `Results.tsx`'s card body. Replace the `ResultsProps` interface:

```ts
interface ResultsProps {
  products: Product[];
  query: string;
  cart: Cart | null;
  busy: boolean;
  onOpenProduct: (productId: string) => void;
  onViewCart: () => void;
}
```

Delete `pickVariant` — the grid no longer represents a product by one of its variants, which is the whole point of the collapse.

Add above the component:

```ts
/**
 * How many of this product's variants are in the cart.
 *
 * Counted across variants, not lines: two Reds and one Blue is three, and a
 * badge reading "2" under a product holding three items is worse than none.
 */
function inCartCount(product: Product, cart: Cart | null): number {
  const ids = new Set(product.variants.map((v) => v.id));
  return (cart?.lines ?? [])
    .filter((line) => ids.has(line.variantId))
    .reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * "3 colors", from the first axis only.
 *
 * A multi-axis product names one axis rather than enumerating a matrix — a
 * grid card is not the place to spell out Size × Color. Shopify's "Title"
 * placeholder is not an axis, so a single-variant product summarises to
 * nothing.
 */
function optionSummary(product: Product): string | null {
  if (product.variants.length < 2) return null;
  const name = product.variants[0]?.options[0]?.name;
  if (!name) return null;
  const labels = new Set(
    product.variants.flatMap((v) =>
      v.options.filter((o) => o.name === name).map((o) => o.label),
    ),
  );
  if (labels.size < 2) return null;
  return `${labels.size} ${name.toLowerCase()}s`;
}
```

Replace the card JSX inside `products.map(...)` with a button wrapping the whole card, so the entire tile is the target:

```tsx
          const image = product.imageUrl ?? product.variants[0]?.imageUrl;
          const inCart = inCartCount(product, cart);
          const summary = optionSummary(product);
          const { min, max } = product.priceRange;

          return (
            <button
              key={product.id}
              type="button"
              disabled={busy}
              onClick={() => onOpenProduct(product.id)}
              className="relative flex flex-col overflow-hidden rounded-xl border border-black/10 text-left"
            >
              {image ? (
                <img
                  src={image}
                  alt={product.title}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="aspect-square w-full bg-black/5" />
              )}

              {inCart > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-black/90 px-2 py-0.5 text-xs font-semibold text-white">
                  {inCart}
                </span>
              )}

              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-2 text-sm font-medium">
                  {product.title}
                </p>
                {summary && (
                  <p className="text-xs text-secondary">{summary}</p>
                )}
                <p className="mt-auto text-sm font-semibold">
                  {min.amountMinor === max.amountMinor
                    ? formatMoney(min)
                    : `${formatMoney(min)} – ${formatMoney(max)}`}
                </p>
              </div>
            </button>
          );
```

Keep the empty-state block and the sticky cart bar exactly as they are.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/components/Results.test.tsx`
Expected: PASS.

The price-range assertion uses a regex because `formatMoney` emits a non-breaking space after `₹` in some Node ICU builds. If `getByText(/^₹2,500\.00$/)` fails, match on `/2,500\.00/` and assert the absence of a dash instead — do not change `formatMoney`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/Results.tsx src/components/Results.test.tsx
git add src/components/Results.tsx src/components/Results.test.tsx
git commit -m "feat: show one card per product, with a price range and a cart badge"
```

---

### Task 6: Wire the screen into the widget

**Files:**
- Modify: `src/components/App.tsx` — `StoreSession`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: nothing new. This is the last task.

- [ ] **Step 1: Add the import and the two handlers**

At the top of `src/components/App.tsx`:

```tsx
import { ProductDetail } from "./ProductDetail";
```

Inside `StoreSession`, after `setScreen`:

```tsx
  // Both ids are set together: opening a product without seeding a variant
  // would render the detail screen's fallback instead of the variant the card
  // was priced from.
  const openProduct = useCallback(
    (productId: string) =>
      setWidgetState((prev) => {
        const product = products.find((p) => p.id === productId);
        const variant =
          product?.variants.find((v) => v.available) ?? product?.variants[0];
        return {
          ...prev,
          screen: "product",
          selectedProductId: productId,
          selectedVariantId: variant?.id,
        };
      }),
    [products, setWidgetState],
  );

  const selectVariant = useCallback(
    (variantId: string) =>
      setWidgetState((prev) => ({ ...prev, selectedVariantId: variantId })),
    [setWidgetState],
  );
```

- [ ] **Step 2: Render the screen**

Add immediately **before** the `if (screen === "cart")` block:

```tsx
  if (screen === "product") {
    const product = products.find(
      (p) => p.id === widgetState.selectedProductId,
    );
    // A reload can restore `screen: "product"` before the catalog is back —
    // ChatGPT does not hand the tool result to a remounted widget, so
    // useProducts refetches from /api/shop/search and products is briefly
    // empty. Falling back to the grid beats rendering nothing.
    if (product) {
      return (
        <ProductDetail
          product={product}
          selectedVariantId={widgetState.selectedVariantId}
          cart={cart}
          busy={busy}
          onSelectVariant={selectVariant}
          onQuantityChange={(variantId, quantity) => {
            void setQuantity(variantId, quantity);
          }}
          onViewCart={() => setScreen("cart")}
          onBack={() => setScreen("results")}
        />
      );
    }
  }
```

- [ ] **Step 3: Update the `Results` render at the bottom**

Replace `onQuantityChange` with `onOpenProduct`:

```tsx
  return (
    <Results
      products={products}
      query={query}
      cart={cart}
      busy={busy}
      onOpenProduct={openProduct}
      onViewCart={() => setScreen("cart")}
    />
  );
```

- [ ] **Step 4: Type-check and run everything**

```bash
npm run type-check
npm run test:run
```

Expected: clean, and roughly 378 tests passing across 34 files.

- [ ] **Step 5: Build and verify by hand**

```bash
npm run build
lsof -ti:8787 | xargs kill -9
npm start 2>&1 | tee -a /tmp/shopify-mcp.log
```

Then **disconnect and reconnect the connector in the host** — a new chat is not enough, the widget HTML is cached per connection. Confirm `POST /mcp (resources/read ui://widget/shopify-store-<build>.html)` appears in the log; without it the browser is running old code and nothing observed means anything.

Check by hand, because no test covers these:
1. Search. The t-shirt is **one** card showing a range, not three.
2. Tap it. Description, colour picker, Add to cart.
3. Add two. Go back. The card carries a badge reading 2.
4. Scroll the conversation up and down to force a remount. The badge survives and no `POST /api/shop/cart` appears in the log.
5. Search for something else. You land on the grid, not the detail screen.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/components/App.tsx
git add src/components/App.tsx
git commit -m "feat: open a product detail screen from the catalog grid"
```

---

## Notes for whoever executes this

**Do not rebuild while someone is testing.** It changes the build id mid-session and mixes bundles inside one conversation, which makes the log unreadable exactly when you need it.

**The remount trap does not apply to this feature, and it is worth knowing why.** `useCart` and `useCheckoutFlow` seed at mount and never re-read their props; that is the trap `CLAUDE.md` documents. `ProductDetail` adds no hook — it is a pure function of the catalog, the cart, and two ids in `WidgetState`. If you find yourself reaching for `useState` in it, stop: the selection must survive a remount, and widget-local state does not.

**If a task's test count does not match the number in the step, that is information.** Say so rather than adjusting the number.
