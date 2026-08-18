# Product detail screen, and a catalog grid that shows products

**Date:** 2026-08-18
**Status:** Designed, not built.
**Repo:** `/Users/kishankumarmaurya/Development/AI/shopify-mcp-demo`
**Builds on:** `2026-08-12-milestone-a-occ-design.md`

## What this changes

The widget gains a fourth screen: one product, its description, a picker for
its variant options, and the quantity stepper that today lives on the grid.

The grid changes with it. It renders one card per **product** instead of one
per **variant**, because those are the same change seen from two sides: once a
detail screen owns variant selection, a grid that already lists every variant
separately has nothing left for the detail screen to do.

Measured on the demo store, `short sleeve t-shirt` is three grid cards — Red,
Blue, Black — for one product a buyer thinks of as one thing.

## Where the data comes from

**From the search payload we already hold. No new call to Shopify.**

`search_catalog` returns each product's description, every variant, and each
variant's options. `normalise.ts` discards all three today. The detail screen
needs no fetch of its own — the catalog is already in the browser, in `_meta`
and in persisted widget state.

The alternative was `lookup_catalog`, which the UCP client already exposes, for
fresher per-product data. It is rejected on evidence rather than taste: this
widget is destroyed and recreated as the buyer scrolls, which is recorded with
timestamps in `useCart`'s load effect. A Shopify call per product view on a
surface that remounts unpredictably is the pattern that already produced
`429 Rate limit exceeded` here and cost a full session to undo with the
cart-body cache. A detail screen is a hotter path than a cart load, not a
cooler one.

A refresh-in-background hybrid was also rejected: same rate-limit exposure,
plus a staleness state machine, for a store whose prices do not move inside a
session.

## Data layer

`Variant` gains the options Shopify already sends:

```ts
export interface VariantOption {
  /** e.g. "Color". Shopify's own name for the axis. */
  name: string;
  /** e.g. "Red". The value on this variant. */
  label: string;
}
```

`Product` gains the two fields the collapsed card and the detail screen need:

```ts
/** Tags stripped. Empty string when the store supplied none. */
description: string;
/** Lowest and highest variant price. `min` equals `max` when they agree. */
priceRange: { min: Money; max: Money };
```

The range is derived from the normalised variants rather than read from
`price_range`, so a card can never advertise a price no variant on it can
actually be bought at. Derived from *available* variants where any exist, so a
sold-out cheap colour does not set the headline price.

`normaliseProducts` stops dropping `description`, `list_price`-aware variant
prices are unchanged, and `options` are carried through per variant.

**The fixtures already contain all of it.** `search-catalog.json` has
descriptions on both products and `{name: "Color", label: "Red"}` on each
t-shirt variant, so the existing fixture tests prove the shape without new
captures.

### Description is HTML, and ships as text

`RawProduct.description.html` is store-controlled markup. Rendering it into a
widget that also renders a payment flow is script injection into the same
document as the buyer's cart and OTP entry; a CSP that governs external origins
does not help against markup we inject ourselves.

`normalise.ts` strips tags and returns plain text. Formatting is lost. That is
the intended trade: a demo storefront does not need bold text badly enough to
host arbitrary store HTML next to a payment screen.

This is the section most worth arguing with. Preserving formatting is possible
with a sanitiser and an allowlist, but it is a dependency and an ongoing
security surface, and this repo does not add dependencies for things it can
avoid needing.

## Screens and navigation

`Screen` gains `"product"`. `WidgetState` gains:

```ts
/** The product the detail screen is showing. */
selectedProductId?: string;
/** The variant chosen there. Seeded to the first available one. */
selectedVariantId?: string;
```

`applySearchResult` must clear both alongside `screen: "results"`. That
function exists because host state outlives any one widget — a second search
otherwise renders a widget still holding `screen: "checkout"` and shows the
previous receipt. A new screen inherits that trap exactly: without the reset, a
buyer who searches again lands on the detail page for a product the new search
never returned.

Back from the detail screen returns to `"results"`. There is no history stack;
the widget has never had one and one screen does not justify inventing it.

## The grid

`Results.tsx` renders one card per product:

- product image, title
- price range across variants, or a single price when they agree
- an option summary when there is more than one variant: the count and the
  lowercased option name, e.g. "3 colors". Multi-axis products name only the
  first axis, because a card is not the place to enumerate a matrix
- a badge carrying the total quantity of that product's variants in the cart,
  hidden at zero
- a control that opens the detail screen

The per-variant steppers move to the detail screen. This is a real loss for the
single-variant case — a Hoody now takes two taps to add instead of one — and it
is accepted so that both screens agree on what a product is. Splitting the
behaviour by variant count would make the grid's affordance depend on data the
buyer cannot see.

## Cart count

Extracted from `Results.tsx` into `cartItemCount(cart)` and called by both
screens.

It cannot drift, and the reason is structural rather than careful: the count is
derived from `cart.lines` on every render, and `useCart.setQuantity` is the
only path that mutates a cart. There is no counter to keep in step. The helper
exists to stop the same reduce being written twice, not to hold state.

The known trap does not apply here. `useCart` and `useCheckoutFlow` seed at
mount and never re-read their props; anything the detail screen adds to that
pattern would inherit it. This adds no hook — the detail screen is a pure
function of the catalog, the cart, and two ids in `WidgetState`.

## Variant picker

One row per option name, buttons per distinct label, derived from the variants
rather than declared.

Shopify sends `{name: "Title", label: "Default Title"}` for products with no
real options — `Hoody` in the fixture. That is a placeholder, not an axis, and
rendering it produces a picker with one button called "Default Title". It is
suppressed: an option row is shown only when the product has more than one
variant.

Unavailable variants render disabled rather than hidden, so a buyer can see
that Black exists and is sold out instead of wondering why the store's three
colours are two.

## Testing

Written first, failing first, per the repo's convention.

| Area | Test |
|---|---|
| `normalise.ts` | Description and options survive, against `search-catalog.json` |
| `normalise.ts` | Description HTML is stripped to text |
| `normalise.ts` | Price range spans the variants, and collapses when they agree |
| `cartItemCount` | Sums line quantities; zero for a null cart |
| `ProductDetail` | Renders description, picker, stepper for the selected variant |
| `ProductDetail` | `"Default Title"` renders no picker |
| `ProductDetail` | Unavailable variant is disabled, not absent |
| `Results` | One card per product, not per variant |
| `Results` | Price range shown when variants differ |
| `session.ts` | A new `searchId` clears `selectedProductId` and `selectedVariantId` |

## What this does not do

- No `lookup_catalog`. Nothing new leaves for Shopify.
- No history stack. Back goes to the grid.
- No image gallery. The store sends one image per product and one per variant;
  there is no second image to show.
- No rich-text description.
- No change to the cart, checkout, or payment screens.
