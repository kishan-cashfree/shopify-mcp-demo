import { z } from "zod";
import type { CashfreeConfig } from "../cashfree/config";
import type { CreatedOrder, CreateOrderInput } from "../cashfree/orders";
import type { NewAddress, OccAddress, OccContext } from "../cashfree/occ";
import { buildHostedCheckoutUrl } from "../cashfree/checkoutUrl";
import { toMajor } from "../money";
import type { CheckoutSession, SessionStore } from "../cashfree/session";
import type { Cart } from "../ucp/types";
import type { PlacedOrder } from "../shopify/admin";

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
  /**
   * Places the Shopify order once Cashfree reports the payment PAID.
   *
   * Injected, and optional, so this module never imports Shopify: without it
   * the checkout behaves exactly as it did before the sync existed, which is
   * also what happens when no Admin token is configured.
   */
  syncOrder?(
    orderId: string,
    orderStatus: string,
  ): Promise<{ status: string; order?: PlacedOrder }>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

const phoneSchema = z
  .string()
  .regex(/^\d{10}$/, "Enter a 10-digit phone number");

/**
 * The methods the payment screen offers, and the keys of the per-method
 * checkout URLs handed back with a created order.
 */
const PAYMENT_METHOD_CODES = ["upi", "card", "nb"] as const;

const createOrderSchema = z
  .object({
    cartId: z.string().min(1),
    phone: phoneSchema,
    /**
     * An order this checkout already created, offered back for reuse.
     *
     * The order is created before the OTP is sent — it has to be, its
     * payment_session_id is the `x-chxs-id` /auth/initiate needs — so a failed
     * send leaves a perfectly good order behind and the buyer retries from the
     * phone screen. Measured 2026-08-27: three OTP 502s in a row, four orders
     * for one checkout.
     *
     * Only a hint. The server decides, and refuses on any mismatch.
     */
    resumeSessionId: z.string().min(1).optional(),
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

/**
 * The address the buyer picked, as opposed to one they typed.
 *
 * Carries the OCC id, which is the only part that proves it came from the list
 * Cashfree returned for this session rather than from the request body.
 */
const selectAddressSchema = z
  .object({
    paymentSessionId: z.string().min(1),
    address: addressSchema.extend({ id: z.string().min(1) }),
  })
  .passthrough();

function bad(message: string, details?: unknown): HandlerResult {
  return { status: 400, body: { error: message, details } };
}

export function createPayHandlers(deps: PayDeps) {
  const { config } = deps;

  /**
   * Everything the widget needs to pay an order, fresh or resumed.
   *
   * Shared so a resumed order is answered identically to a new one — the pay
   * screen has no way to tell them apart and must not need one.
   */
  function orderBody(
    paymentSessionId: string,
    orderId: string,
    orderAmountMinor: number,
    currency: string,
  ) {
    return {
      orderId,
      paymentSessionId,
      orderAmount: toMajor(orderAmountMinor, currency),
      // The whole hosted page, for when no method has been chosen. Built
      // server-side: only the server knows the environment, and the widget has
      // no business assembling payment URLs.
      checkoutUrl: buildHostedCheckoutUrl(config.environment, paymentSessionId),
      // One deep link per method, all off this same session. Sent with the
      // order rather than fetched when the buyer taps, because the tap is the
      // moment they are trying to pay and a round trip there buys nothing —
      // every URL is derivable the instant the session exists.
      checkoutUrls: Object.fromEntries(
        PAYMENT_METHOD_CODES.map((code) => [
          code,
          buildHostedCheckoutUrl(config.environment, paymentSessionId, code),
        ]),
      ),
    };
  }

  /**
   * Whether an order this checkout already has can be paid instead of a new
   * one. Every branch here is a reason it cannot.
   */
  async function resumable(
    resumeSessionId: string | undefined,
    cartId: string,
    phone: string,
    amountMinor: number,
  ): Promise<CheckoutSession | null> {
    if (!resumeSessionId) return null;

    const session = deps.store.get(resumeSessionId);
    // A session id this process never issued, or one from before a restart.
    if (!session) return null;
    if (session.phone !== phone) return null;
    if (session.cartId !== cartId) return null;
    // The cart id survives a quantity change — Shopify keeps one cart and
    // replaces its lines — so the id alone proves nothing. The amount is what
    // actually protects the buyer.
    if (session.orderAmountMinor !== amountMinor) return null;

    try {
      const { orderStatus } = await deps.getOrderStatus(
        config,
        session.orderId,
      );
      // Anything but ACTIVE has already been paid, expired or terminated.
      return orderStatus === "ACTIVE" ? session : null;
    } catch {
      // A status lookup that fails says nothing about the order. A fresh order
      // costs an abandoned one; resuming on a guess could charge the wrong
      // amount or re-open a paid order.
      return null;
    }
  }

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

        const resumed = await resumable(
          parsed.data.resumeSessionId,
          parsed.data.cartId,
          parsed.data.phone,
          cart.total.amountMinor,
        );
        if (resumed) {
          return {
            status: 200,
            body: orderBody(
              resumed.paymentSessionId,
              resumed.orderId,
              cart.total.amountMinor,
              cart.currency,
            ),
          };
        }

        const created = await deps.createOrder(config, {
          cart,
          phone: parsed.data.phone,
          shopDomain: deps.shopDomain,
          handles,
          listPrices,
          returnUrl: deps.returnUrl,
        });

        deps.store.put({
          paymentSessionId: created.paymentSessionId,
          orderId: created.orderId,
          phone: parsed.data.phone,
          // Kept for the Shopify order sync, which runs from the order-status
          // poll long after the widget that knew this has moved on.
          cartId: parsed.data.cartId,
          orderAmountMinor: cart.total.amountMinor,
        });

        return {
          status: 200,
          body: orderBody(
            created.paymentSessionId,
            created.orderId,
            cart.total.amountMinor,
            cart.currency,
          ),
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
     * Records which of the buyer's addresses the checkout is shipping to.
     *
     * The selection used to live only in `useCheckoutFlow`, so the server had
     * a list of addresses and no idea which one was chosen — and an order with
     * no shipping address is not an order.
     */
    async handleSelectAddress(body: unknown): Promise<HandlerResult> {
      const parsed = selectAddressSchema.safeParse(body);
      if (!parsed.success) return bad("Invalid address", parsed.error.issues);

      // Behind the same gate as reading addresses: an address is the buyer's
      // and belongs to a session that has proved it is theirs.
      const resolved = context(parsed.data.paymentSessionId);
      if (!resolved.ok) return resolved.result;

      deps.store.setAddress(
        parsed.data.paymentSessionId,
        parsed.data.address as OccAddress,
      );
      return { status: 200, body: { ok: true } };
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
      let status: { orderId: string; orderStatus: string };
      try {
        status = await deps.getOrderStatus(config, orderId);
      } catch (error) {
        return { status: 502, body: { error: (error as Error).message } };
      }

      if (!deps.syncOrder) return { status: 200, body: status };

      // Wrapped, and never allowed to change the response. This poll is how
      // the widget learns the payment succeeded; the money has moved either
      // way, and a buyer who paid must not be told otherwise because an order
      // sync failed. The failure is the server's problem, and is logged there.
      try {
        const outcome = await deps.syncOrder(orderId, status.orderStatus);
        if (outcome.status === "placed" && outcome.order) {
          return {
            status: 200,
            body: { ...status, shopifyOrder: outcome.order },
          };
        }

        // The poll stops at the first PAID, so without this the sync gets
        // exactly one attempt and a transient Shopify failure strands an order
        // that has already been paid for. A skip is deliberately not flagged:
        // no token, no session and no address do not fix themselves.
        if (outcome.status === "failed") {
          return { status: 200, body: { ...status, shopifySyncPending: true } };
        }
      } catch {
        // Deliberately swallowed — see above.
      }

      return { status: 200, body: status };
    },
  };
}
