import type { Cart } from "../ucp/types";
import type { OccAddress } from "../cashfree/occ";
import { toMajorString } from "../money";

/**
 * The Shopify Admin GraphQL API, which is a different surface from the UCP
 * MCP endpoint the rest of this repo talks to.
 *
 * `/api/ucp/mcp` is unauthenticated and can browse and hold a cart; it cannot
 * place an order. Placing one needs `write_orders` on the Admin API, and
 * `orderCreate` is served only to apps authenticated with an offline token —
 * which is what a custom app's `shpat_…` access token is.
 *
 * The token is the entire authentication: no signature, no second factor. It
 * therefore never reaches the widget, and is read from the environment on the
 * server only.
 */
export interface ShopifyAdminConfig {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

/**
 * `orderCreate` did not exist before this version. Pinned rather than
 * `latest`, so a Shopify release cannot change the mutation under a demo.
 */
const API_VERSION = "2026-07";

/**
 * Null when no token is configured, rather than a thrown error.
 *
 * Everything the demo does up to and including taking the money — catalog,
 * cart, OTP, address, Cashfree payment — works without an Admin token. Only
 * the Shopify order sync needs one. Refusing to boot without it would take the
 * whole store down to add a step that runs after the money has already moved.
 */
export function loadShopifyAdminConfig(
  env: NodeJS.ProcessEnv = process.env,
): ShopifyAdminConfig | null {
  const accessToken = env.SHOPIFY_ADMIN_TOKEN;
  const shopDomain = env.SHOPIFY_ADMIN_DOMAIN || env.SHOP_DOMAIN;
  if (!accessToken || !shopDomain) return null;

  return {
    shopDomain,
    accessToken,
    apiVersion: env.SHOPIFY_ADMIN_API_VERSION || API_VERSION,
  };
}

export interface PaidOrderInput {
  cart: Cart;
  /** The address the buyer picked in the widget, as Cashfree returned it. */
  address: OccAddress;
  phone: string;
  /** Cashfree's order id, carried onto the order so the two reconcile. */
  cashfreeOrderId: string;
}

export interface PlacedOrder {
  id: string;
  name: string;
  statusPageUrl?: string;
}

/**
 * Only the fields the widget can show. Asking for more makes the response
 * larger and the failure modes wider for no gain.
 */
const ORDER_CREATE = `
mutation orderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id name statusPageUrl }
    userErrors { field message }
  }
}`;

/**
 * "Kishan Maurya" → { firstName: "Kishan", lastName: "Maurya" }.
 *
 * Cashfree stores one `customer_name`; Shopify wants the halves separately. A
 * one-word name leaves lastName empty rather than repeating the first — the
 * Shopify plugin's own mapper duplicates it there and puts "Kishan Kishan" on
 * the order, which is worse than a blank field.
 */
export function splitName(customerName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = customerName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function mailingAddress(address: OccAddress) {
  return {
    ...splitName(address.customer_name),
    address1: address.address_line_one,
    address2: address.address_line_two,
    city: address.city,
    provinceCode: address.state_code,
    countryCode: address.country_code,
    zip: address.zip_code,
    phone: address.phone,
  };
}

function money(amountMinor: number, currency: string) {
  return {
    shopMoney: { amount: toMajorString(amountMinor, currency), currencyCode: currency },
  };
}

/**
 * Places the order Cashfree has already been paid for.
 *
 * Rate limit worth knowing before a demo: development and trial stores accept
 * five new orders a minute. A rehearsal that places six will see the sixth
 * rejected, and the rejection reads like a scope problem rather than a quota.
 */
export async function createPaidOrder(
  config: ShopifyAdminConfig,
  input: PaidOrderInput,
): Promise<PlacedOrder> {
  const { cart, address } = input;
  const shipping = mailingAddress(address);

  const order = {
    lineItems: cart.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      // Sent, not left to Shopify. The buyer was quoted and charged the cart's
      // price; a variant repriced between the cart and the payment would
      // otherwise place an order for an amount Cashfree never captured.
      priceSet: money(line.unitPrice.amountMinor, cart.currency),
    })),
    currency: cart.currency,
    email: address.email,
    phone: input.phone,
    shippingAddress: shipping,
    // Cashfree collects one address. Sending it as both is honest about that;
    // omitting billing leaves the order looking half filled-in in the admin.
    billingAddress: shipping,
    financialStatus: "PAID",
    // Shopify has no record of the money — Cashfree took it. The transaction
    // exists so the order reconciles rather than showing as an unpaid order
    // that somebody marked paid by hand.
    transactions: [
      {
        kind: "SALE",
        status: "SUCCESS",
        gateway: "Cashfree",
        amountSet: money(cart.total.amountMinor, cart.currency),
      },
    ],
    // The same tag the production Shopify plugin writes, so an order placed by
    // this demo is filterable alongside the real ones.
    tags: ["CASHFREE_PG", "MCP_DEMO"],
    note: `Paid via Cashfree. Cashfree order id: ${input.cashfreeOrderId}`,
  };

  const response = await fetch(
    `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": config.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: ORDER_CREATE,
        variables: {
          order,
          // The buyer has already seen a confirmation from Cashfree. A second
          // email from Shopify for the same purchase reads as a double charge.
          options: { sendReceipt: false },
        },
      }),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      orderCreate?: {
        order?: PlacedOrder | null;
        userErrors?: { message: string }[];
      };
    };
    errors?: { message: string }[] | string;
  };

  if (!response.ok) {
    throw new Error(
      `Shopify orderCreate failed (${response.status}): ${JSON.stringify(payload.errors ?? payload)}`,
    );
  }

  // A scope or version failure comes back as a top-level `errors` array with
  // no `data.orderCreate` at all, so the userErrors check below never sees it.
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  const result = payload.data?.orderCreate;
  // userErrors sit beside a 200 and a null order. Reading only the HTTP status
  // would report a placed order that does not exist.
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e) => e.message).join("; "));
  }

  if (!result?.order) {
    throw new Error("Shopify orderCreate returned no order");
  }

  return result.order;
}
