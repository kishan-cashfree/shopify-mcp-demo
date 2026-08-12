export interface CheckoutSession {
  paymentSessionId: string;
  orderId: string;
  phone: string;
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
  setAuth(paymentSessionId: string, authToken: string): void;
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

  return {
    put(session) {
      sessions.set(session.paymentSessionId, session);
    },

    get(paymentSessionId) {
      return sessions.get(paymentSessionId);
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
      const existing = sessions.get(paymentSessionId);
      if (!existing) {
        // Creating a session here would let a forged id seed the store.
        throw new Error(`Unknown checkout session: ${paymentSessionId}`);
      }
      sessions.set(paymentSessionId, { ...existing, authToken });
    },
  };
}
