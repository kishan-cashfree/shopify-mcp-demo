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

  it("shows the brand marks beside each filter", () => {
    render(<MethodSelector {...BASE} onPayWithMethods={vi.fn()} />);

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
    // announces itself turns this button into "Visa Mastercard Credit card",
    // which is neither what the buyer chose nor findable by name. The label
    // carries the meaning; the marks illustrate it.
    render(<MethodSelector {...BASE} onPayWithMethods={vi.fn()} />);

    const cc = screen.getByRole("button", { name: "Credit card" });
    for (const img of cc.querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("puts the brand marks after the label, at the row's far end", () => {
    render(<MethodSelector {...BASE} onPayWithMethods={vi.fn()} />);

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
    render(<MethodSelector {...BASE} onPayWithMethods={vi.fn()} />);

    const row = screen.getByRole("button", { name: "UPI" });
    const before = row.querySelector("span:has(img)")!.childElementCount;
    expect(row.className).toContain("border-2");

    await userEvent.click(row);

    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row.className).toContain("border-2");
    expect(row.querySelector("span:has(img)")!.childElementCount).toBe(before);
  });

  it("fans the marks so each covers half the one before it", () => {
    render(<MethodSelector {...BASE} onPayWithMethods={vi.fn()} />);

    const row = screen.getByRole("button", { name: "Credit card" });
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
