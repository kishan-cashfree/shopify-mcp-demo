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
});
