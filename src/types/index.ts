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
  checkout?: CheckoutSnapshot;
}

/** Delivered by the host as _meta on the SearchProducts response. */
export interface ToolResponseMetadata {
  products?: Product[];
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
