import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WidgetState } from "../types";

/**
 * Widget state must not leak between the live widgets in one conversation.
 *
 * Claude gives a widget no host-side state, so it falls back to localStorage —
 * shared by every widget on the origin — and it keeps every earlier widget in
 * the conversation alive. Measured: after paying, searching "pants" and
 * reloading, the pants widget woke up rendering the belts widget's checkout
 * with its phone number already filled in.
 */
let onToolResult: ((params: unknown) => void) | undefined;

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: class {
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    updateModelContext = vi.fn().mockResolvedValue(undefined);
    sendMessage = vi.fn().mockResolvedValue({});
    getHostContext = vi.fn().mockReturnValue({});
    set ontoolresult(cb: (params: unknown) => void) {
      onToolResult = cb;
    }
    get ontoolresult() {
      return onToolResult as (params: unknown) => void;
    }
    ontoolinput = null;
    onhostcontextchanged = null;
    onerror = null;
  },
}));

const BELTS: WidgetState = {
  screen: "checkout",
  quantities: {},
  checkout: { step: "otp", phone: "8433719326" },
  revision: 9,
};

async function freshClient() {
  vi.resetModules();
  onToolResult = undefined;
  const mod = await import("./platform");
  return { mod, host: mod.getClientPlatform() };
}

/** Delivers a tool result, which is what names the widget. */
function deliver(searchId: string) {
  onToolResult?.({ _meta: { searchId, products: [] } });
}

describe("widget state storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keys each widget's slot by the search that produced it", async () => {
    const { mod } = await freshClient();

    expect(mod.widgetStateKey("belts-1")).not.toBe(mod.widgetStateKey("pants-2"));
    expect(mod.widgetStateKey("belts-1")).toContain("belts-1");
  });

  it("does not hand one widget the state another widget saved", async () => {
    // The exact failure: the belts widget is mid-checkout, the buyer searches
    // pants, and the pants widget reloads. It must start clean, not inherit a
    // stranger's phone number and OTP step.
    const { mod } = await freshClient();
    localStorage.setItem(
      mod.widgetStateKey("belts-1"),
      JSON.stringify(BELTS),
    );

    const { host } = await freshClient();
    deliver("pants-2");

    expect(host.widgetState).toBeNull();
  });

  it("gives a widget its own state back after a reload", async () => {
    // Reload survival is the reason any of this is persisted. Claude
    // re-delivers the same search result to the remounted widget, so its slot
    // is findable again.
    const { mod } = await freshClient();
    localStorage.setItem(
      mod.widgetStateKey("belts-1"),
      JSON.stringify(BELTS),
    );

    const { host } = await freshClient();
    deliver("belts-1");

    expect(host.widgetState).toEqual(BELTS);
  });

  it("writes to its own slot, leaving the other widget's untouched", async () => {
    const { mod, host } = await freshClient();
    const otherSlot = mod.widgetStateKey("belts-1");
    localStorage.setItem(otherSlot, JSON.stringify(BELTS));

    deliver("pants-2");
    host.setWidgetState({ screen: "cart", quantities: {}, revision: 1 });

    expect(JSON.parse(localStorage.getItem(otherSlot)!)).toEqual(BELTS);
    expect(localStorage.getItem(mod.widgetStateKey("pants-2"))).toContain(
      "cart",
    );
  });
});
