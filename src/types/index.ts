import type { Cart, Product } from "../lib/ucp/types";

/**
 * Only three values. The checkout sub-steps belong to useCheckoutFlow and are
 * deliberately not duplicated here — two state machines advancing the same
 * journey drift, and the bug shows up as a screen that will not move.
 */
export type Screen = "results" | "cart" | "checkout";

export type CheckoutStep = "phone" | "otp" | "address" | "method" | "paying";

/**
 * Persisted so a host re-render mid-checkout does not strand a buyer whose
 * Cashfree order already exists. The flow hook is its only writer.
 */
export interface CheckoutSnapshot {
  step: CheckoutStep;
  paymentSessionId?: string;
  orderId?: string;
  phone?: string;
  /** Cashfree hosted checkout, built server-side. Fallback when a dispatch is
   *  suppressed by the host. */
  checkoutUrl?: string;
}

export interface WidgetState {
  screen: Screen;
  cartId?: string;
  /** Desired quantities keyed by variant id. The server holds the real cart. */
  quantities: Record<string, number>;
  /**
   * The cart body as the store last returned it, cached so a remount can paint
   * without a round trip. See useCart for why a remount is routine here.
   */
  cart?: Cart;
  /** When {@link cart} was fetched. Older than the TTL and useCart refetches. */
  cartFetchedAt?: number;
  checkout?: CheckoutSnapshot;
  /**
   * The last SearchProducts result this widget rendered. Host state outlives
   * any one widget, so without it a new search cannot be told from a repaint.
   */
  lastSearchId?: string;
  /**
   * The search that produced the current grid.
   *
   * A host reload remounts the widget without re-running the tool, and ChatGPT
   * does not hand the catalog back, so this is the only way the widget can
   * find its own products again.
   */
  query?: string;
  /**
   * Counts writes, so a stale snapshot cannot overwrite a fresher one.
   *
   * Earlier widgets in a conversation stay live and share one localStorage
   * key with no ordering between them. Measured: a reset landed, the previous
   * widget's whole state replaced it a render later, and the reset ran again
   * — the buyer saw the old receipt flash before the new products.
   */
  revision?: number;
}

/** Delivered by the host as _meta on the SearchProducts response. */
export interface ToolResponseMetadata {
  products?: Product[];
  /** Unique per tool call, so the widget can spot a search it has not shown. */
  searchId?: string;
}

/** structuredContent — minimal, and the only part the model sees. */
export interface ToolOutput {
  count?: number;
  error?: string;
}

export interface ToolResponse {
  structuredContent?: ToolOutput;
  content?: Array<{ type: string; text: string }>;
  _meta?: ToolResponseMetadata;
}

// ─── OpenAI Apps SDK host contract ───────────────────────────────────────────
// The shape the host injects as window.openai. Copied from the reference demo
// alongside the bridge files in src/utils/platform.ts and src/hooks/, which are
// typed against it — the two must stay in step.

export interface OpenAiGlobals {
  toolInput: Record<string, unknown>;
  toolOutput: ToolOutput | null;
  toolResponseMetadata: ToolResponseMetadata | null;
  widgetState: WidgetState | null;
  theme: "light" | "dark";
  displayMode: "inline" | "fullscreen" | "pip";
  maxHeight: number;
  safeArea: { top: number; bottom: number; left: number; right: number };
  view: string;
  userAgent: string;
  locale: string;
  setWidgetState: (state: WidgetState) => void;
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
  sendFollowUpMessage: (options: {
    prompt: string;
    scrollToBottom?: boolean;
  }) => Promise<void>;
  requestDisplayMode: (options: {
    mode: "inline" | "fullscreen" | "pip";
  }) => Promise<void>;
  requestModal: (options: {
    template?: string;
    params?: Record<string, unknown>;
  }) => Promise<void>;
  requestClose: () => void;
  openExternal: (options: { href: string }) => void;
}

export type SetGlobalsEvent = CustomEvent<{
  globals: Partial<OpenAiGlobals>;
}>;

declare global {
  interface Window {
    openai: OpenAiGlobals;
  }
  interface WindowEventMap {
    "openai:set_globals": SetGlobalsEvent;
  }
}

export type { Cart, Product };
