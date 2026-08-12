import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MethodSelector } from "./MethodSelector";

const sendFollowUpMessage = vi.fn();
const callTool = vi.fn();

// Mocked at the bridge, because that is what the component talks to. The two
// hosts expose different globals; ClientPlatform is the seam.
vi.mock("../utils/platform", () => ({
  getClientPlatform: () => ({ sendFollowUpMessage, callTool }),
}));

const BASE = {
  baseUrl: "http://x",
  checkoutUrl: "https://sandbox.cashfree.com/checkout?pt=session_x",
  paymentSessionId: "session_x",
  orderId: "o1",
  customerId: "mcp_8433719326",
  amountLabel: "₹1,200.00",
  onDispatched: vi.fn(),
  onBack: vi.fn(),
};

/** The server either confirms a handler ran, or reports that none did. */
function dispatchConfirms(tool: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ dispatchedTool: tool }),
    }),
  );
}

describe("MethodSelector", () => {
  beforeEach(() => {
    sendFollowUpMessage.mockReset().mockResolvedValue(undefined);
    callTool.mockReset().mockResolvedValue(undefined);
    dispatchConfirms("UpiTool");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers every cashfree-here payment method", () => {
    render(<MethodSelector {...BASE} />);

    for (const label of [
      /^upi$/i,
      /saved card/i,
      /new card/i,
      /netbanking/i,
      /all payment methods/i,
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("retries the handoff before giving up on it", async () => {
    // The widget-to-model handoff drops silently about half the time, and a
    // dropped message looks exactly like the host suppressing the tool. One
    // measured session had the same UPI request dispatch on one attempt and
    // produce nothing on another.
    dispatchConfirms(null);
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /^upi$/i }));
    await screen.findByText(/blocked/i, {}, { timeout: 40_000 });

    expect(sendFollowUpMessage.mock.calls.length).toBeGreaterThan(1);
  }, 45_000);

  it("dispatches through the model, the only path that renders the widget", async () => {
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /^upi$/i }));

    const prompt = sendFollowUpMessage.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("UpiTool");
    expect(prompt).toContain("session_x");
    // callTool runs the handler but the host never fetches the tool's
    // outputTemplate, so no payment UI appears.
    expect(callTool).not.toHaveBeenCalled();
  });

  it("sends each tool exactly the arguments its schema requires", async () => {
    render(<MethodSelector {...BASE} />);
    const promptFor = (i: number) =>
      sendFollowUpMessage.mock.calls[i][0].prompt as string;

    await userEvent.click(screen.getByRole("button", { name: /^upi$/i }));
    await waitFor(() => expect(sendFollowUpMessage).toHaveBeenCalledTimes(1));
    expect(promptFor(0)).not.toContain("orderId");

    // A missing argument is a silent schema rejection, not a useful error.
    await userEvent.click(screen.getByRole("button", { name: /saved card/i }));
    await waitFor(() => expect(sendFollowUpMessage).toHaveBeenCalledTimes(2));
    expect(promptFor(1)).toContain("CardPaymentTool");
    expect(promptFor(1)).toContain("mcp_8433719326");

    await userEvent.click(screen.getByRole("button", { name: /new card/i }));
    await waitFor(() => expect(sendFollowUpMessage).toHaveBeenCalledTimes(3));
    expect(promptFor(2)).toContain("NewCardPaymentTool");
    expect(promptFor(2)).toContain("o1");
  });

  it("advances only once the server confirms a handler ran", async () => {
    const onDispatched = vi.fn();
    render(<MethodSelector {...BASE} onDispatched={onDispatched} />);

    await userEvent.click(screen.getByRole("button", { name: /^upi$/i }));

    await waitFor(() => expect(onDispatched).toHaveBeenCalled());
  });

  it(
    "says the chat blocked it, and offers a link, when no handler runs",
    async () => {
      // The host accepts the request and then declines to run the tool.
      // Advancing here parked the buyer on a waiting screen for a payment that
      // had never started — a silent failure with no way forward.
      dispatchConfirms(null);
      const onDispatched = vi.fn();
      render(<MethodSelector {...BASE} onDispatched={onDispatched} />);

      await userEvent.click(screen.getByRole("button", { name: /^upi$/i }));

      expect(
        await screen.findByText(/blocked/i, {}, { timeout: 40_000 }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /pay/i })).toHaveAttribute(
        "href",
        BASE.checkoutUrl,
      );
      expect(onDispatched).not.toHaveBeenCalled();
    },
    45_000,
  );

  it("falls back to callTool when the host has no follow-up channel", async () => {
    sendFollowUpMessage.mockRejectedValue(new Error("refused"));
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /^upi$/i }));

    expect(callTool).toHaveBeenCalledWith("UpiTool", {
      paymentSessionId: "session_x",
    });
  });

  it("surfaces an error only when both paths fail", async () => {
    sendFollowUpMessage.mockRejectedValue(new Error("refused"));
    callTool.mockRejectedValue(new Error("also refused"));
    render(<MethodSelector {...BASE} />);

    await userEvent.click(screen.getByRole("button", { name: /^upi$/i }));

    expect(await screen.findByText(/also refused/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^upi$/i })).not.toBeDisabled();
  });

  it("goes back", async () => {
    const onBack = vi.fn();
    render(<MethodSelector {...BASE} onBack={onBack} />);

    await userEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
