import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MethodSelector } from "./MethodSelector";

/**
 * The Claude opener, in its own file on purpose.
 *
 * `getClientPlatform()` owns a single client for the life of the module — one
 * host bridge, ever, because the MCP Apps transport is a single postMessage
 * channel. So whichever host a test builds first is the host every later test
 * in that file gets. Vitest isolates per file, which is the cheapest way to
 * assert the other branch.
 */
const BASE = {
  baseUrl: "http://localhost:8787",
  paymentSessionId: "session_x",
  orderId: "order_1",
  customerId: "mcp_8433719326",
  amountLabel: "\u20b92,526.00",
  onDispatched: vi.fn(),
  onBack: vi.fn(),
};

describe("MethodSelector — Claude opener", () => {
  it("does not rely on window.open, which opens nothing in Claude's iframe", async () => {
    // Measured: inside Claude's widget iframe a plain anchor click or
    // window.open produces no tab at all, leaving the buyer on a dead control
    // with a payment they cannot complete. openLink is the sanctioned route.
    // No window.openai stub here, so the MCP Apps client is the one built.
    vi.stubGlobal("open", vi.fn());
    const onDispatched = vi.fn();

    render(
      <MethodSelector
        {...BASE}
        onPayWithMethod={vi.fn().mockReturnValue("https://pay.test/claude")}
        onDispatched={onDispatched}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "UPI" }));
    await userEvent.click(
      screen.getByRole("button", { name: /on Cashfree/i }),
    );

    expect(window.open).not.toHaveBeenCalled();
    // And it does not claim the payment started. There is no host bridge in a
    // test, so openExternal never settles — the screen stays in its opening
    // state rather than advancing a buyer whose checkout page never opened to
    // a screen that waits for its result.
    expect(onDispatched).not.toHaveBeenCalled();
    expect(await screen.findByText(/opening cashfree/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
