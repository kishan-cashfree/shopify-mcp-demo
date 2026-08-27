import type { SessionStore } from "../cashfree/session";
import type { LoadedCart } from "../ucp/shop";
import type { PlacedOrder, ShopifyAdminConfig } from "../shopify/admin";
import type { PaidOrderInput } from "../shopify/admin";

/**
 * Placing the Shopify order for a Cashfree payment that has already gone
 * through.
 *
 * Driven by the order-status poll the widget was already making, rather than
 * by a Cashfree webhook. A webhook needs a public URL that survives a restart,
 * and this repo's tunnel does not — a buyer mid-payment has already come back
 * to ERR_CONNECTION_CLOSED once. The poll is running anyway and carries the
 * one id the sync needs.
 *
 * Its own module, and not a branch inside `payHandlers`, because every rule
 * here is a decision about whether to place a real order and each one needs a
 * test that names the condition it refuses.
 */
export interface OrderSyncDeps {
  /** Null when no Admin token is configured — the sync is then simply off. */
  admin: ShopifyAdminConfig | null;
  /**
   * True while Cashfree is in sandbox, so the Shopify transaction is marked as
   * a test rather than counted as a real sale. Shopify has no sandbox of its
   * own; a development store is real data.
   */
  testPayment: boolean;
  store: SessionStore;
  loadCart(cartId: string): Promise<LoadedCart>;
  createPaidOrder(
    config: ShopifyAdminConfig,
    input: PaidOrderInput,
  ): Promise<PlacedOrder>;
}

export type SyncOutcome =
  | { status: "placed"; order: PlacedOrder }
  | { status: "skipped"; reason: SkipReason }
  | { status: "failed"; error: string };

/**
 * Named rather than boolean, because these are not all the same thing: two are
 * configuration, one is a lost session, one is an incomplete checkout. A log
 * line saying which is the difference between a five-minute fix and an
 * afternoon.
 */
export type SkipReason =
  | "no-admin-token"
  | "not-paid"
  | "no-session"
  | "no-cart"
  | "no-address";

const skip = (reason: SkipReason): SyncOutcome => ({
  status: "skipped",
  reason,
});

export async function syncShopifyOrder(
  deps: OrderSyncDeps,
  cashfreeOrderId: string,
  orderStatus: string,
): Promise<SyncOutcome> {
  if (!deps.admin) return skip("no-admin-token");

  // Cashfree's own word, read from Cashfree by the caller. The widget claiming
  // it paid is the widget's opinion, and this is the step that turns money
  // into stock leaving a warehouse.
  if (orderStatus !== "PAID") return skip("not-paid");

  const session = deps.store.getByOrderId(cashfreeOrderId);
  // Sessions are in-memory, so a restart mid-payment loses the cart and the
  // address. Skipping is the honest outcome; inventing a line item is not.
  if (!session) return skip("no-session");

  // Already placed. The poll fires every couple of seconds and does not stop
  // at the first success, so this branch is the normal case, not the edge one.
  if (session.shopifyOrder) {
    return { status: "placed", order: session.shopifyOrder };
  }

  if (!session.cartId) return skip("no-cart");
  if (!session.address) return skip("no-address");

  try {
    // Re-priced from Shopify at sync time rather than from anything the poll
    // carried, for the same reason handleCreateOrder prices from Shopify: a
    // client-supplied amount is a client-supplied amount.
    const { cart } = await deps.loadCart(session.cartId);

    const order = await deps.createPaidOrder(deps.admin, {
      cart,
      address: session.address,
      phone: session.phone,
      cashfreeOrderId,
      testPayment: deps.testPayment,
    });

    deps.store.setShopifyOrder(session.paymentSessionId, order);
    return { status: "placed", order };
  } catch (error) {
    // Deliberately not recorded on the session: the poll is still running, and
    // leaving it unmarked is what lets the next tick retry. The money is
    // already taken, so giving up on the first 502 strands a paid order with
    // nothing on Shopify.
    return { status: "failed", error: (error as Error).message };
  }
}
