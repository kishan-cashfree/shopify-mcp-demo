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
  availability: { available: boolean };
  options?: { name: string; label: string }[];
  media?: RawMedia[];
}

export interface RawProduct {
  id: string;
  title: string;
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

export interface RawCart {
  id: string;
  currency: string;
  line_items: RawCartLine[];
  totals: RawTotal[];
  continue_url: string;
}

// ─── Internal types ──────────────────────────────────────────────────────────
// What the server hands the widget. Money is always one shape here.

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Variant {
  id: string;
  title: string;
  price: Money;
  available: boolean;
  imageUrl?: string;
}

export interface Product {
  id: string;
  title: string;
  imageUrl?: string;
  variants: Variant[];
}

export interface CartLine {
  lineId: string;
  variantId: string;
  title: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface Cart {
  cartId: string;
  currency: string;
  lines: CartLine[];
  total: Money;
  continueUrl: string;
}

/** What the widget posts to /api/shop/cart. */
export interface CartRequest {
  cartId?: string;
  lines: { variantId: string; quantity: number }[];
}
