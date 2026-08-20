import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MethodSelector } from "./MethodSelector";

const openExternal = vi.fn();

const BASE = {
  baseUrl: "http://localhost:8787",
  paymentSessionId: "session_x",
  orderId: "order_1",
  customerId: "mcp_8433719326",
  checkoutUrl: "https://sandbox.cashfree.com/checkout?pt=session_x",
  amountLabel: "₹2,526.00",
  onDispatched: vi.fn(),
  onBack: vi.fn(),
};

describe("MethodSelector — hosted checkout", () => {
  beforeEach(() => {
    openExternal.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("open", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers the four filters Cashfree accepts", () => {
    render(<MethodSelector {...BASE} onPayWithMethods={vi.fn()} />);

    for (const label of ["UPI", "Credit card", "Debit card", "Netbanking"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("will not pay until a method is chosen", () => {
    // order_meta.payment_methods must name something. Paying with nothing
    // selected would create an order with an empty filter.
    render(<MethodSelector {...BASE} onPayWithMethods={vi.fn()} />);

    expect(screen.getByRole("button", { name: /on Cashfree/i })).toBeDisabled();
  });

  it("sends the chosen code and opens the URL the new order returned", async () => {
    // window.openai present => the legacy OpenAI client, where a plain
    // window.open is what works. Claude's path is asserted separately below.
    vi.stubGlobal("openai", { widgetState: null, setWidgetState: vi.fn(), openExternal });
    // Deliberately not `checkoutUrl` from props: that belongs to the login
    // order, which carries no payment_methods. Opening it would show the
    // buyer every method despite their choice.
    const onPayWithMethods = vi
      .fn()
      .mockResolvedValue("https://sandbox.cashfree.com/checkout?pt=session_two");
    const onDispatched = vi.fn();
    render(
      <MethodSelector
        {...BASE}
        onPayWithMethods={onPayWithMethods}
        onDispatched={onDispatched}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Credit card" }));
    await userEvent.click(
      screen.getByRole("button", { name: /on Cashfree/i }),
    );

    expect(onPayWithMethods).toHaveBeenCalledWith(["cc"]);
    expect(window.open).toHaveBeenCalledWith(
      "https://sandbox.cashfree.com/checkout?pt=session_two",
      "_blank",
      "noreferrer",
    );
    expect(onDispatched).toHaveBeenCalled();
  });

  it("maps each label to its Cashfree code", async () => {
    vi.stubGlobal("openai", { widgetState: null, setWidgetState: vi.fn(), openExternal });
    const onPayWithMethods = vi.fn().mockResolvedValue("https://pay.test/x");
    const pay = /on Cashfree/i;

    for (const [label, code] of [
      ["UPI", "upi"],
      ["Debit card", "dc"],
      ["Netbanking", "nb"],
    ] as const) {
      onPayWithMethods.mockClear();
      const { unmount } = render(
        <MethodSelector {...BASE} onPayWithMethods={onPayWithMethods} />,
      );
      await userEvent.click(screen.getByRole("button", { name: label }));
      await userEvent.click(screen.getByRole("button", { name: pay }));
      expect(onPayWithMethods).toHaveBeenCalledWith([code]);
      unmount();
    }
  });

  it("does not advance when the order could not be created", async () => {
    // Advancing to the waiting screen with no order would leave recon polling
    // an id that does not exist.
    const onDispatched = vi.fn();
    render(
      <MethodSelector
        {...BASE}
        onPayWithMethods={vi.fn().mockResolvedValue(null)}
        onDispatched={onDispatched}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "UPI" }));
    await userEvent.click(
      screen.getByRole("button", { name: /on Cashfree/i }),
    );

    expect(window.open).not.toHaveBeenCalled();
    expect(onDispatched).not.toHaveBeenCalled();
  });


});
