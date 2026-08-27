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
  /**
   * Whether Shopify emails the buyer its own order confirmation.
   *
   * On by default, matching pgcheckoutsvc, which passes sendReceipt: true
   * unconditionally. The buyer gets a Shopify confirmation as well as the
   * Cashfree one — two emails for one purchase, which is what the merchant's
   * own plugin already does.
   *
   * Verified on order #1617 that the flag really is what decides: Shopify logs
   * an event whenever it emails a customer, and that order — created with the
   * receipt suppressed — has none.
   */
  sendReceipt: boolean;
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
    // An exact opt-out. Anything else leaves it on, because a half-set
    // variable must not silently stop a merchant's customers being confirmed.
    sendReceipt: env.SHOPIFY_SEND_RECEIPT !== "false",
  };
}

export interface PaidOrderInput {
  cart: Cart;
  /** The address the buyer picked in the widget, as Cashfree returned it. */
  address: OccAddress;
  phone: string;
  /** Cashfree's order id, carried onto the order so the two reconcile. */
  cashfreeOrderId: string;
  /**
   * Whether the money was taken in Cashfree's sandbox.
   *
   * Shopify has no sandbox of its own — a development store is real data — and
   * OrderCreateOrderTransactionInput defaults `test` to false. Leaving it out
   * therefore records a sandbox payment as a genuine sale and corrupts the
   * store's reporting. Shopify's own guidance: "If you're using the Admin API
   * to test orders, then you need to set the test property or field to true."
   *
   * Note it does NOT make the order deletable. Shopify only treats orders paid
   * through Shopify Payments or its Test gateway as deletable test orders;
   * anything on a third-party gateway name — "Cashfree" here — can be
   * cancelled and archived but never removed.
   */
  testPayment: boolean;
}

export interface PlacedOrder {
  id: string;
  name: string;
  statusPageUrl?: string;
}

/**
 * Which of the cart's variants actually need shipping.
 *
 * Asked because OrderCreateLineItemInput defaults `requiresShipping` to false
 * and does NOT inherit it from the variant. Measured on order #1617: the
 * variant's inventoryItem.requiresShipping was true, the resulting line item's
 * was false, and the admin showed "Shipping not required" on an order that had
 * just collected a shipping address.
 *
 * One batched call for the whole cart, not one per line.
 */
const VARIANT_SHIPPING = `
query variantShipping($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant { id inventoryItem { requiresShipping } }
  }
}`;

/**
 * Finding and creating the buyer's customer record BEFORE the order, so the
 * order only ever has to associate an id.
 *
 * This is pgcheckoutsvc's shape, and the reason for it is measured: setting a
 * phone through orderCreate's own customer upsert refused the entire mutation
 * when that number already belonged to another record — "Customer phone number
 * has already been taken", 2026-08-27, after Cashfree had taken the money.
 * Associating an existing id sets no unique field, so it cannot clash.
 */
const GET_CUSTOMERS = `
query getCustomers($first: Int!, $query: String!) {
  customers(first: $first, query: $query) {
    edges {
      node {
        id
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
      }
    }
  }
}`;

const CUSTOMER_CREATE = `
mutation customerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

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
 * Cashfree stores one `customer_name`; Shopify wants the halves separately,
 * and refuses a blank surname: measured live 2026-08-27, a buyer whose address
 * said simply "kishan" produced "Customer last name can't be blank" and lost
 * the order after the payment had gone through.
 *
 * So the LAST token is the surname and everything before it is the given name.
 * A one-word name lands in lastName, which is never blank. An earlier version
 * put the first token in firstName and left lastName empty, on the argument
 * that it beat the production plugin's "Kishan Kishan" duplication — right
 * about the duplication, wrong about what Shopify accepts.
 */
export function splitName(customerName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = customerName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? "",
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

/**
 * Shopify rejects a discount code longer than 255 characters, and this one is
 * merchant text — pgcheckoutsvc joins several stacked offer titles into it.
 */
const DISCOUNT_CODE_MAX_LENGTH = 254;

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
async function graphql(
  config: ShopifyAdminConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  return fetch(
    `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": config.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
  );
}

/**
 * "+91 8433719326" → "+918433719326". Shopify stores and matches E.164 with no
 * spaces, so a search for the spaced form finds nothing.
 */
function e164(phone: string): string {
  const trimmed = phone.trim();
  return trimmed.startsWith("+") ? trimmed.replace(/\s+/g, "") : "";
}

/**
 * The buyer's Shopify customer id, or null.
 *
 * Null is an ordinary outcome, not an error: the money is already taken, and a
 * customer that cannot be resolved must cost the order its customer link and
 * nothing else. Shopify still builds one from the email and shipping address —
 * order #1617 was created with no customer block at all and still produced a
 * properly named customer.
 */
interface ResolvedCustomer {
  id: string;
  /** What Shopify holds for them, which may differ from the OCC address. */
  email?: string;
}

async function resolveCustomer(
  config: ShopifyAdminConfig,
  address: OccAddress,
): Promise<ResolvedCustomer | null> {
  const phone = e164(address.phone);
  const email = address.email.trim();
  // Nothing to search on, and nothing worth creating.
  if (!phone && !email) return null;

  try {
    const terms = [
      phone ? `phone:"${phone}"` : "",
      email ? `email:"${email}"` : "",
    ].filter(Boolean);

    const search = await graphql(config, GET_CUSTOMERS, {
      first: 50,
      query: terms.join(" OR "),
    });
    const found = (await search.json()) as {
      data?: {
        customers?: {
          edges?: {
            node?: {
              id?: string;
              defaultEmailAddress?: { emailAddress?: string };
              defaultPhoneNumber?: { phoneNumber?: string };
            };
          }[];
        };
      };
    };

    const nodes = (found.data?.customers?.edges ?? [])
      .map((edge) => edge.node)
      .filter((node): node is NonNullable<typeof node> => !!node?.id);

    // An OR search returns everything matching EITHER term, so the first row
    // is not necessarily the buyer. Taking it blindly associated a customer
    // whose email differed from the order's, and Shopify refused the whole
    // mutation trying to reconcile them: "Customer email address has already
    // been taken", measured 2026-08-27.
    const byEmail = email
      ? nodes.find(
          (node) =>
            node.defaultEmailAddress?.emailAddress?.toLowerCase() ===
            email.toLowerCase(),
        )
      : undefined;
    const byPhone = phone
      ? nodes.find((node) => node.defaultPhoneNumber?.phoneNumber === phone)
      : undefined;

    const existing = byEmail ?? byPhone;
    if (existing?.id) {
      return {
        id: existing.id,
        email: existing.defaultEmailAddress?.emailAddress,
      };
    }

    const created = await graphql(config, CUSTOMER_CREATE, {
      input: {
        ...splitName(address.customer_name),
        ...(email ? { email } : {}),
        // Safe here in a way it is not on orderCreate: a uniqueness clash
        // fails only this call, and the order proceeds without a customer.
        ...(phone ? { phone } : {}),
      },
    });
    const payload = (await created.json()) as {
      data?: { customerCreate?: { customer?: { id?: string } | null } };
    };
    const id = payload.data?.customerCreate?.customer?.id;
    return id ? { id, email: email || undefined } : null;
  } catch {
    return null;
  }
}

/**
 * variantId → whether it needs shipping, defaulting to true.
 *
 * True on any doubt, and never fatal. The money has already been taken, so a
 * lookup failure must not cost the order — and of the two ways to be wrong, a
 * gift card marked shippable is one a merchant notices, while a snowboard
 * marked otherwise quietly loses its address and nobody ships it.
 */
async function shippingFlags(
  config: ShopifyAdminConfig,
  variantIds: string[],
): Promise<Record<string, boolean>> {
  const flags: Record<string, boolean> = {};
  try {
    const response = await graphql(config, VARIANT_SHIPPING, {
      ids: variantIds,
    });
    const payload = (await response.json()) as {
      data?: {
        nodes?: ({ id: string; inventoryItem?: { requiresShipping?: boolean } } | null)[];
      };
    };
    for (const node of payload.data?.nodes ?? []) {
      if (node?.id) flags[node.id] = node.inventoryItem?.requiresShipping !== false;
    }
  } catch {
    // Falls through to the default below.
  }
  return flags;
}

export async function createPaidOrder(
  config: ShopifyAdminConfig,
  input: PaidOrderInput,
): Promise<PlacedOrder> {
  const { cart, address } = input;
  const shipping = mailingAddress(address);
  const needsShipping = await shippingFlags(
    config,
    cart.lines.map((line) => line.variantId),
  );
  const customer = await resolveCustomer(config, address);

  const order = {
    lineItems: cart.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      // Explicit, because the input defaults it to false and Shopify does not
      // take it from the variant — see VARIANT_SHIPPING.
      requiresShipping: needsShipping[line.variantId] ?? true,
      // Sent, not left to Shopify. The buyer was quoted and charged the cart's
      // price; a variant repriced between the cart and the payment would
      // otherwise place an order for an amount Cashfree never captured.
      priceSet: money(line.unitPrice.amountMinor, cart.currency),
    })),
    currency: cart.currency,
    // Only when it agrees with the customer being associated. pgcheckoutsvc
    // applies the same guard, and the reason is measured: an order email that
    // belongs to a DIFFERENT customer makes Shopify try to move it, and it
    // refuses the whole mutation rather than the field.
    ...(!customer ||
    customer.email?.toLowerCase() === address.email.trim().toLowerCase()
      ? { email: address.email }
      : {}),
    phone: input.phone,
    shippingAddress: shipping,
    // Cashfree collects one address. Sending it as both is honest about that;
    // omitting billing leaves the order looking half filled-in in the admin.
    billingAddress: shipping,
    // Associated by id, never upserted inline — see resolveCustomerId. Absent
    // rather than null when the buyer could not be resolved.
    ...(customer ? { customer: { toAssociate: { id: customer.id } } } : {}),
    // The reconciliation keys as order metadata rather than only as free text
    // in `note`. pgcheckoutsvc writes the same two, and its tooling reads them.
    customAttributes: [
      { key: "pg_order_id", value: input.cashfreeOrderId },
      // Without the "?key=" capability token that follows a Shopify cart id.
      { key: "cart_token", value: cart.cartId.split("?")[0] },
    ],
    // No inline customer upsert, deliberately.
    //
    // Shopify builds the customer from `email` and the shipping address on its
    // own — order #1617 was created without one and still produced a properly
    // named customer. Supplying it added nothing and cost two orders that had
    // already been paid for:
    //
    //   "Customer phone number has already been taken" — phone is unique
    //   across customers, and the upsert matches on email, so a number sitting
    //   on any other record refuses the whole mutation.
    //
    //   "Customer last name can't be blank" — a one-word name left the surname
    //   empty. splitName is fixed, but the field never needed to be here.
    //
    // The rule this leaves behind: nothing optional may be able to fail the
    // mutation that records the money.
    // The cart's reduction, sent as a discount rather than baked into the line
    // prices.
    //
    // Without it the order is simply short: measured on order #1623, lines
    // totalling ₹1,000 against a ₹900 transaction produced an order Shopify
    // marked PAID — it honours the asserted status — carrying
    // totalOutstanding ₹100 and totalDiscounts ₹0. The merchant's books were
    // short by the discount with nothing on screen saying so.
    //
    // Line prices stay at catalog value and this comes off the top, so
    // Shopify's own arithmetic lands on the amount Cashfree captured.
    ...(cart.discount
      ? {
          discountCode: {
            itemFixedDiscountCode: {
              amountSet: money(cart.discount.amount.amountMinor, cart.currency),
              code: cart.discount.label.slice(0, DISCOUNT_CODE_MAX_LENGTH),
            },
          },
        }
      : {}),
    financialStatus: "PAID",
    // Shopify has no record of the money — Cashfree took it. The transaction
    // exists so the order reconciles rather than showing as an unpaid order
    // that somebody marked paid by hand.
    transactions: [
      {
        kind: "SALE",
        status: "SUCCESS",
        // Verbatim from pgcheckoutsvc, so an order placed here is
        // indistinguishable from a production plugin order in reports.
        gateway: "Cashfree Payments",
        test: input.testPayment,
        amountSet: money(cart.total.amountMinor, cart.currency),
        // The same id as the note and pg_order_id, attached to the payment
        // rather than the order. This is the field production tooling reads.
        receiptJson: { pgOrderId: input.cashfreeOrderId },
      },
    ],
    // CASHFREE_PG is the tag the production Shopify plugin writes, so an order
    // placed here filters alongside the real ones. The second names this
    // integration specifically, so they can also be told apart.
    tags: ["CASHFREE_PG", "cashfree-here"],
    note: `Paid via Cashfree. Cashfree order id: ${input.cashfreeOrderId}`,
  };

  const response = await graphql(config, ORDER_CREATE, {
    order,
    options: { sendReceipt: config.sendReceipt },
  });

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
