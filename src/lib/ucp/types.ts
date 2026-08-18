// ─── Raw UCP wire types ──────────────────────────────────────────────────────
// Hand-written from captured fixtures, not from shopify.dev. The published
// docs were wrong about the endpoint split, the tool locations, and the cart
// line-item field name, so the live payloads are the only source of truth.
//
// Note the asymmetry: catalog prices are { amount, currency } objects, while
// cart line-item prices are bare integers with currency held once on the cart.
// That is not a transcription slip — it is what the server sends.

export interface RawMoney {
  amount: number;
  currency: string;
}

export interface RawMedia {
  type: string;
  url: string;
}

export interface RawVariant {
  id: string;
  title: string;
  price: RawMoney;
  /** Pre-discount price. Present only on discounted variants. */
  list_price?: RawMoney;
  availability: { available: boolean };
  options?: { name: string; label: string }[];
  media?: RawMedia[];
}

export interface RawProduct {
  id: string;
  title: string;
  /** URL slug, used to build a product link for Cashfree's cart summary. */
  handle?: string;
  description?: { html?: string };
  price_range?: { min: RawMoney; max: RawMoney };
  variants: RawVariant[];
  media?: RawMedia[];
}

export interface RawSearchResponse {
  products: RawProduct[];
}

export interface RawTotal {
  type: string;
  amount: number;
  display_text: string;
}

export interface RawCartLine {
  id: string;
  quantity: number;
  item: {
    id: string;
    title: string;
    price: number;
    image_url?: string;
  };
  totals: RawTotal[];
}

/** Shopify's own name for an offer, e.g. an automatic "NOCHAINS". */
export interface RawAppliedDiscount {
  title?: string;
  amount: number;
}

export interface RawCart {
  id: string;
  currency: string;
  line_items: RawCartLine[];
  totals: RawTotal[];
  discounts?: { applied?: RawAppliedDiscount[] };
  continue_url: string;
}

// ─── Internal types ──────────────────────────────────────────────────────────
// What the server hands the widget. Money is always one shape here.

export interface Money {
  amountMinor: number;
  currency: string;
}

/** One axis of a variant, as Shopify names it: `{ name: "Color", label: "Red" }`. */
export interface VariantOption {
  name: string;
  label: string;
}

export interface Variant {
  id: string;
  title: string;
  price: Money;
  /** Pre-discount price. Equals `price` when the variant is not discounted. */
  listPrice: Money;
  available: boolean;
  imageUrl?: string;
  /**
   * The axes this variant sits on. The detail screen's picker is derived from
   * these rather than declared, so a store that sells by Size or by Scent
   * needs no code change.
   */
  options: VariantOption[];
}

export interface Product {
  id: string;
  title: string;
  /** URL slug. Empty when the store did not supply one. */
  handle: string;
  imageUrl?: string;
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
  variants: Variant[];
}

export interface CartLine {
  lineId: string;
  variantId: string;
  title: string;
  imageUrl?: string;
  quantity: number;
  /** Catalog price, before any cart discount. */
  unitPrice: Money;
  /** unitPrice × quantity. Equal to `lineTotal` when nothing was discounted. */
  lineSubtotal: Money;
  /** What this line actually costs, after discounts. */
  lineTotal: Money;
}

/** A reduction the store applied, as a positive amount the view subtracts. */
export interface CartDiscount {
  label: string;
  amount: Money;
}

export interface Cart {
  cartId: string;
  currency: string;
  lines: CartLine[];
  /** Before discounts. Equal to `total` when nothing was applied. */
  subtotal: Money;
  /** Absent unless the store reduced the price. */
  discount?: CartDiscount;
  total: Money;
  continueUrl: string;
}

/** What the widget posts to /api/shop/cart. */
export interface CartRequest {
  cartId?: string;
  lines: { variantId: string; quantity: number }[];
}
