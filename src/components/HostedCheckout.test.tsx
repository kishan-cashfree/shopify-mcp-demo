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

  it("offers the three methods Cashfree has a route for", () => {
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    for (const label of ["UPI", "Card", "Netbanking"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  // Credit and debit were separate rows while order_meta could tell them
  // apart. The hosted page cannot: /payment-method/credit-card and
  // /debit-card are 404s, so both rows opened the same screen.
  it("no longer splits credit from debit", () => {
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Credit card" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Debit card" }),
    ).not.toBeInTheDocument();
  });

  it("shows the brand marks beside each filter", () => {
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    const upi = screen.getByRole("button", { name: "UPI" });
    expect(upi.querySelectorAll("img")).toHaveLength(3);
    expect(upi.querySelector("img")).toHaveAttribute(
      "src",
      "https://cashfreelogo.cashfree.com/assets_images/pg/upi/svg/gpay.svg",
    );
  });

  it("keeps the brand marks out of every filter's accessible name", () => {
    // Accessible names concatenate adjacent nodes with no separator — the
    // defect that produced "Red1 in cart" in the catalog. A Visa mark that
    // announces itself turns this button into "Visa Mastercard Card",
    // which is neither what the buyer chose nor findable by name. The label
    // carries the meaning; the marks illustrate it.
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    const card = screen.getByRole("button", { name: "Card" });
    for (const img of card.querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("puts the brand marks after the label, at the row's far end", () => {
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    const row = screen.getByRole("button", { name: "Netbanking" });
    const label = [...row.children].findIndex((el) =>
      el.textContent?.includes("Netbanking"),
    );
    const marks = [...row.children].findIndex((el) => el.querySelector("img"));

    expect(label).toBeGreaterThanOrEqual(0);
    expect(marks).toBeGreaterThan(label);
  });

  it("shows the choice on the border, and moves nothing when it changes", async () => {
    // There was a dot after the marks. With it gone the border carries the
    // whole signal, so it is border-2 in both states and only recoloured —
    // going from border to border-2 on selection nudges every row's contents
    // by a pixel at the moment it is pressed.
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    const row = screen.getByRole("button", { name: "UPI" });
    const before = row.querySelector("span:has(img)")!.childElementCount;
    expect(row.className).toContain("border-2");

    await userEvent.click(row);

    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row.className).toContain("border-2");
    expect(row.querySelector("span:has(img)")!.childElementCount).toBe(before);
  });

  it("fans the marks so each covers half the one before it", () => {
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    const row = screen.getByRole("button", { name: "Card" });
    const marks = [...row.querySelectorAll("img")].map((img) => img.parentElement!);

    expect(marks).toHaveLength(3);
    // -ml-4 against a w-8 disc is exactly half. The first sits flush.
    expect(marks[0].className).not.toContain("-ml-4");
    for (const mark of marks.slice(1)) {
      expect(mark.className).toContain("-ml-4");
      // Opaque, or the mark behind shows through the transparent SVG.
      expect(mark.className).toContain("bg-white");
    }
  });

  it("will not pay until a method is chosen", () => {
    // There is no route to open without a method, and opening the whole page
    // would ignore a choice the screen just asked the buyer to make.
    render(<MethodSelector {...BASE} onPayWithMethod={vi.fn()} />);

    expect(screen.getByRole("button", { name: /on Cashfree/i })).toBeDisabled();
  });

  it("sends the chosen code and opens the method\u2019s deep link", async () => {
    // window.openai present => the legacy OpenAI client, where a plain
    // window.open is what works. Claude's path is asserted separately below.
    vi.stubGlobal("openai", { widgetState: null, setWidgetState: vi.fn(), openExternal });
    // The URL comes back from the callback rather than from a prop: it is
    // Cashfree's deep link for the chosen method, built server-side off the
    // one order this checkout has had since login.
    const onPayWithMethod = vi
      .fn()
      .mockReturnValue(
        "https://sandbox.cashfree.com/checkout/payment-method/card?pt=session_x",
      );
    const onDispatched = vi.fn();
    render(
      <MethodSelector
        {...BASE}
        onPayWithMethod={onPayWithMethod}
        onDispatched={onDispatched}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Card" }));
    await userEvent.click(
      screen.getByRole("button", { name: /on Cashfree/i }),
    );

    expect(onPayWithMethod).toHaveBeenCalledWith("card");
    expect(window.open).toHaveBeenCalledWith(
      "https://sandbox.cashfree.com/checkout/payment-method/card?pt=session_x",
      "_blank",
      "noreferrer",
    );
    expect(onDispatched).toHaveBeenCalled();
  });

  it("maps each label to its Cashfree code", async () => {
    vi.stubGlobal("openai", { widgetState: null, setWidgetState: vi.fn(), openExternal });
    const onPayWithMethod = vi.fn().mockReturnValue("https://pay.test/x");
    const pay = /on Cashfree/i;

    for (const [label, code] of [
      ["UPI", "upi"],
      ["Card", "card"],
      ["Netbanking", "nb"],
    ] as const) {
      onPayWithMethod.mockClear();
      const { unmount } = render(
        <MethodSelector {...BASE} onPayWithMethod={onPayWithMethod} />,
      );
      await userEvent.click(screen.getByRole("button", { name: label }));
      await userEvent.click(screen.getByRole("button", { name: pay }));
      expect(onPayWithMethod).toHaveBeenCalledWith(code);
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
        onPayWithMethod={vi.fn().mockReturnValue(null)}
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
