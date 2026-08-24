import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneEntry } from "./PhoneEntry";

const BASE = { busy: false, error: null, onSubmit: vi.fn(), onBack: vi.fn() };

describe("PhoneEntry", () => {
  it("submits a valid ten-digit number", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry {...BASE} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/phone/i), "8433719326");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith("8433719326");
  });

  it("rejects a short number without calling onSubmit", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry {...BASE} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/phone/i), "12345");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/10-digit/i)).toBeInTheDocument();
  });

  it("holds Continue shut until ten digits are in", async () => {
    render(<PhoneEntry {...BASE} />);

    const cta = screen.getByRole("button", { name: /continue/i });
    expect(cta).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/phone/i), "843371932");
    expect(cta).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/phone/i), "6");
    expect(cta).toBeEnabled();
  });

  it("flags a short number as it is typed, not on submit", async () => {
    // The error used to appear only on a click that is now impossible: the
    // button is shut until the number is valid. Driven off what is in the
    // field instead, so a half-typed number still says why nothing happens.
    render(<PhoneEntry {...BASE} />);

    await userEvent.type(screen.getByLabelText(/phone/i), "12345");

    expect(screen.getByText(/10-digit/i)).toBeInTheDocument();
  });

  it("ignores non-digits as they are typed", async () => {
    render(<PhoneEntry {...BASE} />);

    const input = screen.getByLabelText(/phone/i);
    await userEvent.type(input, "84ab33-71 9326");

    expect(input).toHaveValue("8433719326");
  });

  it("caps input at ten digits", async () => {
    render(<PhoneEntry {...BASE} />);

    const input = screen.getByLabelText(/phone/i);
    await userEvent.type(input, "84337193269999");

    expect(input).toHaveValue("8433719326");
  });

  it("disables the button while busy", () => {
    render(<PhoneEntry {...BASE} busy />);
    expect(screen.getByRole("button", { name: /please wait/i })).toBeDisabled();
  });

  it("shows a server error", () => {
    render(<PhoneEntry {...BASE} error="order_amount is invalid" />);
    expect(screen.getByText(/order_amount is invalid/)).toBeInTheDocument();
  });

  it("goes back to the cart", async () => {
    const onBack = vi.fn();
    render(<PhoneEntry {...BASE} onBack={onBack} />);

    await userEvent.click(screen.getByRole("button", { name: /back to cart/i }));

    expect(onBack).toHaveBeenCalled();
  });

  it("keeps the +91 prefix out of the submitted value", async () => {
    // The country code is chrome beside the field, not part of it. If it ever
    // moves inside the input, this submits "+918433719326" and Cashfree
    // rejects the number — so the split is worth pinning.
    const onSubmit = vi.fn();
    render(<PhoneEntry {...BASE} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/phone/i), "8433719326");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith("8433719326");
    expect(screen.getByText("+91")).toBeInTheDocument();
  });

  it("keeps the back button reachable by name despite the chevron", async () => {
    // Accessible names concatenate adjacent nodes with no separator, which has
    // already produced "Red1 in cart" once in this widget. A decorative
    // chevron must not make this button unfindable.
    const onBack = vi.fn();
    render(<PhoneEntry {...BASE} onBack={onBack} />);

    await userEvent.click(screen.getByRole("button", { name: /back to cart/i }));

    expect(onBack).toHaveBeenCalled();
  });

  it("tells the buyer how many digits are expected before they type", () => {
    // Shortened from "10-digit mobile number" when the field gave up half its
    // width to the Continue button beside it. An <input> clips its placeholder
    // rather than ellipsising, so the long one read "10-digit mobil". The
    // count is the part that has to survive — the label above already says
    // "Phone number".
    render(<PhoneEntry {...BASE} />);

    expect(screen.getByPlaceholderText(/10/)).toBeInTheDocument();
  });

});
