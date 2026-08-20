import type { Cart } from "../ucp/types";
import type { CashfreeConfig } from "./config";

const API_VERSION = "2023-08-01";

export interface CartItem {
  item_id: string;
  item_name: string;
  item_image_url?: string;
  item_details_url?: string;
  item_original_unit_price: number;
  item_discounted_unit_price: number;
  item_quantity: number;
  item_currency: string;
}

export interface CreateOrderInput {
  cart: Cart;
  phone: string;
  shopDomain: string;
  /** variantId → product handle, for building item_details_url. */
  handles: Record<string, string>;
  /** variantId → pre-discount unit price, in minor units. */
  listPrices: Record<string, number>;
  returnUrl: string;
  /**
   * Cashfree's `order_meta.payment_methods` filter — a comma-separated subset
   * of cc, dc, upi, nb. Omitted entirely when absent, which leaves the hosted
   * page offering everything the merchant has enabled.
   *
   * Only settable at Create Order: there is no endpoint to change order_meta
   * afterwards. That is why the buyer's choice produces a second order rather
   * than amending the login order — see payHandlers.
   */
  paymentMethods?: string;
}

export interface CreatedOrder {
  orderId: string;
  paymentSessionId: string;
  orderAmount: number;
}

/**
 * Minor units → major units, using the currency's own decimal count rather
 * than a hardcoded 100. JPY has none, and dividing it would bill a hundredth
 * of the real amount.
 */
function toMajor(amountMinor: number, currency: string): number {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return amountMinor / 10 ** digits;
}

export function toCartItems(
  cart: Cart,
  shopDomain: string,
  handles: Record<string, string>,
  listPrices: Record<string, number>,
): CartItem[] {
  return cart.lines.map((line) => {
    const handle = handles[line.variantId];
    const listMinor = listPrices[line.variantId] ?? line.unitPrice.amountMinor;

    return {
      item_id: line.variantId,
      item_name: line.title,
      item_image_url: line.imageUrl,
      // A link to a product page that does not exist is worse than no link.
      item_details_url: handle
        ? `https://${shopDomain}/products/${handle}`
        : undefined,
      item_original_unit_price: toMajor(listMinor, cart.currency),
      item_discounted_unit_price: toMajor(
        line.unitPrice.amountMinor,
        cart.currency,
      ),
      item_quantity: line.quantity,
      item_currency: cart.currency,
    };
  });
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function createOrder(
  config: CashfreeConfig,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  const body = {
    order_amount: toMajor(input.cart.total.amountMinor, input.cart.currency),
    order_currency: input.cart.currency,
    customer_details: {
      customer_id: `mcp_${input.phone}`,
      customer_phone: input.phone,
    },
    order_meta: {
      return_url: input.returnUrl,
      // Spread so the key is absent, not null, when no filter was chosen.
      ...(input.paymentMethods
        ? { payment_methods: input.paymentMethods }
        : {}),
    },
    // No products.one_click_checkout block, deliberately.
    //
    // The widget already collects the phone, verifies the OTP and picks the
    // address. Enabling OCC on the order makes Cashfree's hosted page offer to
    // do all three again, so the buyer logs in twice — once in the
    // conversation and once on the payment page.
    //
    // The OCC endpoints we call (auth/initiate, auth/sessions, addresses) do
    // not require the flags: measured on two otherwise-identical orders, see
    // docs/spikes/2026-08-12-occ-spike.md. Dropping them turns the hosted page
    // into a plain payment page, which is all we still need from it.
    cart_details: {
      cart_items: toCartItems(
        input.cart,
        input.shopDomain,
        input.handles,
        input.listPrices,
      ),
    },
  };

  const response = await fetch(`${config.baseUrl}/pg/orders`, {
    method: "POST",
    headers: {
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      await readError(response, `Create order failed (${response.status})`),
    );
  }

  const created = (await response.json()) as {
    order_id: string;
    payment_session_id: string;
    order_amount: number;
  };

  return {
    orderId: created.order_id,
    paymentSessionId: created.payment_session_id,
    orderAmount: created.order_amount,
  };
}

/**
 * Cashfree's order response, passed through untouched.
 *
 * cashfree-here's widgets poll `${serverUrl}/api/orders/:id` and parse the
 * raw Cashfree shape. Normalising it there — as an earlier version did — means
 * their reconciliation reads a body it does not understand and never reaches a
 * terminal state. demo/server.ts proxies the raw body for exactly this reason.
 */
export async function getOrderRaw(
  config: CashfreeConfig,
  orderId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `${config.baseUrl}/pg/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        "x-client-id": config.clientId,
        "x-client-secret": config.clientSecret,
        "x-api-version": API_VERSION,
      },
    },
  );

  return { status: response.status, body: await response.json() };
}

export async function getOrderStatus(
  config: CashfreeConfig,
  orderId: string,
): Promise<{ orderId: string; orderStatus: string }> {
  const response = await fetch(
    `${config.baseUrl}/pg/orders/${encodeURIComponent(orderId)}`,
    {
      headers: {
        "x-client-id": config.clientId,
        "x-client-secret": config.clientSecret,
        "x-api-version": API_VERSION,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      await readError(response, `Order lookup failed (${response.status})`),
    );
  }

  const order = (await response.json()) as {
    order_id: string;
    order_status: string;
  };

  return { orderId: order.order_id, orderStatus: order.order_status };
}
