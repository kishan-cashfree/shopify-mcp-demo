import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpEntry } from "./OtpEntry";

const BASE = {
  phone: "8433719326",
  busy: false,
  error: null,
  onSubmit: vi.fn(),
  onResend: vi.fn(),
  onBack: vi.fn(),
};

describe("OtpEntry", () => {
  it("shows which number the code went to", () => {
    render(<OtpEntry {...BASE} />);
    expect(screen.getByText(/8433719326/)).toBeInTheDocument();
  });

  it("submits the entered code", async () => {
    const onSubmit = vi.fn();
    render(<OtpEntry {...BASE} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/code/i), "111000");
    await userEvent.click(screen.getByRole("button", { name: /verify/i }));

    expect(onSubmit).toHaveBeenCalledWith("111000");
  });

  it("keeps the entered code after an error", async () => {
    // Clearing the field on failure makes the user retype a code that is still
    // visible in their messages. Keep it.
    const { rerender } = render(<OtpEntry {...BASE} />);

    await userEvent.type(screen.getByLabelText(/code/i), "000000");
    rerender(<OtpEntry {...BASE} error="Invalid OTP" />);

    expect(screen.getByLabelText(/code/i)).toHaveValue("000000");
    expect(screen.getByText(/Invalid OTP/)).toBeInTheDocument();
  });

  it("offers resend", async () => {
    const onResend = vi.fn();
    render(<OtpEntry {...BASE} onResend={onResend} />);

    await userEvent.click(screen.getByRole("button", { name: /resend/i }));

    expect(onResend).toHaveBeenCalled();
  });

  it("disables verify while busy", () => {
    render(<OtpEntry {...BASE} busy />);
    expect(screen.getByRole("button", { name: /verifying/i })).toBeDisabled();
  });

  it("ignores non-digits in the code", async () => {
    render(<OtpEntry {...BASE} />);

    const input = screen.getByLabelText(/code/i);
    await userEvent.type(input, "11a1b000");

    expect(input).toHaveValue("111000");
  });

  it("lets the user change their number", async () => {
    const onBack = vi.fn();
    render(<OtpEntry {...BASE} onBack={onBack} />);

    await userEvent.click(screen.getByRole("button", { name: /change number/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
