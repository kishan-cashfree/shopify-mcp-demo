import type { OccAddress } from "./occ";
import type { PlacedOrder } from "../shopify/admin";

export interface CheckoutSession {
  paymentSessionId: string;
  orderId: string;
  phone: string;
  /**
   * The Shopify cart the Cashfree order was priced from.
   *
   * Kept because the Shopify order sync runs from the order-status poll, long
   * after the widget that knew the cart id has moved on, and the sync re-prices
   * from Shopify rather than trusting anything the poll carries.
   *
   * Optional because `markDispatched` can create a session this process never
   * saw the cart for.
   */
  cartId?: string;
  /**
   * What the order was created for, in minor units.
   *
   * Kept so a retry after a failed OTP send can tell whether the existing
   * order still matches the cart. Compared as integers rather than converted:
   * an amount check is the only thing standing between a resumed order and
   * charging the buyer a total they no longer have.
   */
  orderAmountMinor?: number;
  /** The address the buyer picked, kept for the same reason as `cartId`. */
  address?: OccAddress;
  /**
   * Set once the order exists on Shopify. This is the idempotency record: the
   * poll fires every couple of seconds and does not stop at the first success,
   * so without it every tick would place another order.
   */
  shopifyOrder?: PlacedOrder;
  /** Set once OTP verification succeeds. Never sent to the widget. */
  authToken?: string;
  /**
   * The payment tool whose handler actually ran for this session.
   *
   * The widget cannot tell a dispatched tool from a suppressed one: asking the
   * model to call a tool resolves either way, and the host silently drops
   * payment tools it does not like. Recording the handler run server-side is
   * the only honest signal that a payment really started.
   */
  dispatchedTool?: string;
}

export interface SessionStore {
  put(session: CheckoutSession): void;
  get(paymentSessionId: string): CheckoutSession | undefined;
  /**
   * The only id the order-status poll carries is Cashfree's order id, and the
   * store is keyed on the payment session id. A scan is fine at demo volume;
   * a real deployment indexes it.
   */
  getByOrderId(orderId: string): CheckoutSession | undefined;
  setAuth(paymentSessionId: string, authToken: string): void;
  setAddress(paymentSessionId: string, address: OccAddress): void;
  setShopifyOrder(paymentSessionId: string, order: PlacedOrder): void;
  /** Called from a payment tool handler, proving the dispatch reached us. */
  markDispatched(paymentSessionId: string, toolName: string): void;
}

/**
 * In-memory and process-local. A checkout cannot survive a server restart,
 * which is acceptable for a demo and is stated in the spec rather than
 * discovered in front of an audience. A real deployment needs shared storage
 * with a TTL.
 *
 * This exists so the OCC auth token stays server-side. The widget runs in a
 * browser inside a third-party host and only ever holds a paymentSessionId.
 */
export function createSessionStore(): SessionStore {
  const sessions = new Map<string, CheckoutSession>();

  /**
   * Creating a session from a setter would let a forged id seed the store, so
   * every setter refuses an id it has not already issued.
   */
  function mustGet(paymentSessionId: string): CheckoutSession {
    const existing = sessions.get(paymentSessionId);
    if (!existing) {
      throw new Error(`Unknown checkout session: ${paymentSessionId}`);
    }
    return existing;
  }

  return {
    put(session) {
      sessions.set(session.paymentSessionId, session);
    },

    get(paymentSessionId) {
      return sessions.get(paymentSessionId);
    },

    getByOrderId(orderId) {
      for (const session of sessions.values()) {
        if (session.orderId === orderId) return session;
      }
      return undefined;
    },

    markDispatched(paymentSessionId, toolName) {
      const existing = sessions.get(paymentSessionId);
      // A tool can be dispatched for a session this process never created —
      // after a restart, say. Recording it anyway keeps the widget honest;
      // there is no auth decision resting on this value.
      sessions.set(paymentSessionId, {
        ...(existing ?? {
          paymentSessionId,
          orderId: "",
          phone: "",
        }),
        dispatchedTool: toolName,
      });
    },

    setAuth(paymentSessionId, authToken) {
      sessions.set(paymentSessionId, {
        ...mustGet(paymentSessionId),
        authToken,
      });
    },

    setAddress(paymentSessionId, address) {
      sessions.set(paymentSessionId, {
        ...mustGet(paymentSessionId),
        address,
      });
    },

    setShopifyOrder(paymentSessionId, shopifyOrder) {
      sessions.set(paymentSessionId, {
        ...mustGet(paymentSessionId),
        shopifyOrder,
      });
    },
  };
}
