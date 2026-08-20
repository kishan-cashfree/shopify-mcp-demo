import { z } from "zod";
import type { CashfreeConfig } from "../cashfree/config";
import type { CreatedOrder, CreateOrderInput } from "../cashfree/orders";
import type { NewAddress, OccAddress, OccContext } from "../cashfree/occ";
import { buildHostedCheckoutUrl } from "../cashfree/checkoutUrl";
import type { SessionStore } from "../cashfree/session";
import type { Cart } from "../ucp/types";

export interface LoadedCart {
  cart: Cart;
  /** variantId → product handle */
  handles: Record<string, string>;
  /** variantId → pre-discount unit price, minor units */
  listPrices: Record<string, number>;
}

export interface PayDeps {
  config: CashfreeConfig;
  store: SessionStore;
  shopDomain: string;
  returnUrl: string;
  loadCart(cartId: string): Promise<LoadedCart>;
  createOrder(
    config: CashfreeConfig,
    input: CreateOrderInput,
  ): Promise<CreatedOrder>;
  initiateOtp(
    config: CashfreeConfig,
    input: { paymentSessionId: string; phone: string },
  ): Promise<void>;
  verifyOtp(
    config: CashfreeConfig,
    input: { paymentSessionId: string; phone: string; otp: string },
  ): Promise<{ authToken: string; customerUid: string }>;
  getAddresses(config: CashfreeConfig, ctx: OccContext): Promise<OccAddress[]>;
  createAddress(
    config: CashfreeConfig,
    ctx: OccContext,
    address: NewAddress,
  ): Promise<OccAddress[]>;
  getOrderStatus(
    config: CashfreeConfig,
    orderId: string,
  ): Promise<{ orderId: string; orderStatus: string }>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

const phoneSchema = z
  .string()
  .regex(/^\d{10}$/, "Enter a 10-digit phone number");

/** The four codes Cashfree's order_meta.payment_methods accepts here. */
const PAYMENT_METHOD_CODES = ["cc", "dc", "upi", "nb"] as const;

const createOrderSchema = z
  .object({
    cartId: z.string().min(1),
    phone: phoneSchema,
    // Validated against a fixed set rather than passed through: this string
    // lands in a payment order, and an unrecognised code silently widens or
    // empties what the hosted page offers.
    paymentMethods: z
      .array(z.enum(PAYMENT_METHOD_CODES))
      .min(1)
      .optional(),
  })
  .passthrough();

const sessionSchema = z
  .object({ paymentSessionId: z.string().min(1) })
  .passthrough();

const verifySchema = z
  .object({ paymentSessionId: z.string().min(1), otp: z.string().min(4) })
  .passthrough();

const addressSchema = z.object({
  customer_name: z.string().min(1),
  address_line_one: z.string().min(1),
  address_line_two: z.string(),
  city: z.string().min(1),
  zip_code: z.string().min(1),
  state: z.string().min(1),
  state_code: z.string().min(1),
  country: z.string().min(1),
  country_code: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
});

const createAddressSchema = z
  .object({ paymentSessionId: z.string().min(1), address: addressSchema })
  .passthrough();

function bad(message: string, details?: unknown): HandlerResult {
  return { status: 400, body: { error: message, details } };
}

export function createPayHandlers(deps: PayDeps) {
  const { config } = deps;

  function context(
    paymentSessionId: string,
  ): { ok: true; ctx: OccContext } | { ok: false; result: HandlerResult } {
    const session = deps.store.get(paymentSessionId);
    if (!session) {
      return { ok: false, result: bad("Unknown or expired checkout session") };
    }
    if (!session.authToken) {
      return {
        ok: false,
        result: { status: 401, body: { error: "Not signed in" } },
      };
    }
    return {
      ok: true,
      ctx: {
        paymentSessionId,
        authToken: session.authToken,
        phone: session.phone,
      },
    };
  }

  return {
    async handleCreateOrder(body: unknown): Promise<HandlerResult> {
      const parsed = createOrderSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid request", parsed.error.issues);

      try {
        // Priced from Shopify, never from the request. A client-supplied
        // amount is a client-supplied amount.
        const { cart, handles, listPrices } = await deps.loadCart(
          parsed.data.cartId,
        );

        const created = await deps.createOrder(config, {
          cart,
          phone: parsed.data.phone,
          shopDomain: deps.shopDomain,
          handles,
          listPrices,
          returnUrl: deps.returnUrl,
          paymentMethods: parsed.data.paymentMethods?.join(","),
        });

        deps.store.put({
          paymentSessionId: created.paymentSessionId,
          orderId: created.orderId,
          phone: parsed.data.phone,
        });

        return {
          status: 200,
          body: {
            ...created,
            // Fallback target for when the host suppresses a payment tool
            // dispatch. Built server-side: only the server knows the
            // environment, and the widget has no business assembling payment
            // URLs.
            checkoutUrl: buildHostedCheckoutUrl(
              config.environment,
              created.paymentSessionId,
            ),
          },
        };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    async handleSendOtp(body: unknown): Promise<HandlerResult> {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid request", parsed.error.issues);

      const session = deps.store.get(parsed.data.paymentSessionId);
      if (!session) return bad("Unknown or expired checkout session");

      try {
        await deps.initiateOtp(config, {
          paymentSessionId: parsed.data.paymentSessionId,
          phone: session.phone,
        });
        return { status: 200, body: { sent: true } };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    async handleVerifyOtp(body: unknown): Promise<HandlerResult> {
      const parsed = verifySchema.safeParse(body);
      if (!parsed.success) return bad("Invalid request", parsed.error.issues);

      const session = deps.store.get(parsed.data.paymentSessionId);
      if (!session) return bad("Unknown or expired checkout session");

      try {
        const { authToken } = await deps.verifyOtp(config, {
          paymentSessionId: parsed.data.paymentSessionId,
          phone: session.phone,
          otp: parsed.data.otp,
        });

        deps.store.setAuth(parsed.data.paymentSessionId, authToken);

        // Deliberately returns no token.
        return { status: 200, body: { ok: true } };
      } catch (error) {
        return { status: 400, body: { error: (error as Error).message } };
      }
    },

    async handleGetAddresses(paymentSessionId: string): Promise<HandlerResult> {
      const resolved = context(paymentSessionId);
      if (!resolved.ok) return resolved.result;

      try {
        const addresses = await deps.getAddresses(config, resolved.ctx);
        return { status: 200, body: { addresses } };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    async handleCreateAddress(body: unknown): Promise<HandlerResult> {
      const parsed = createAddressSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid address", parsed.error.issues);

      const resolved = context(parsed.data.paymentSessionId);
      if (!resolved.ok) return resolved.result;

      try {
        const addresses = await deps.createAddress(
          config,
          resolved.ctx,
          parsed.data.address as NewAddress,
        );
        return { status: 200, body: { addresses } };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },

    /**
     * Whether a payment tool handler actually ran for this session.
     *
     * The widget cannot tell a dispatched tool from a suppressed one — asking
     * the model to call a tool resolves either way — so it asks the server,
     * which only knows because the handler ran.
     */
    async handleDispatchStatus(body: unknown): Promise<HandlerResult> {
      const parsed = sessionSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid request", parsed.error.issues);

      const session = deps.store.get(parsed.data.paymentSessionId);
      return {
        status: 200,
        body: { dispatchedTool: session?.dispatchedTool ?? null },
      };
    },

    async handleOrderStatus(orderId: string): Promise<HandlerResult> {
      try {
        return {
          status: 200,
          body: await deps.getOrderStatus(config, orderId),
        };
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }
    },
  };
}
