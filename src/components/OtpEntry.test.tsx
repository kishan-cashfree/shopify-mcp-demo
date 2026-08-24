import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
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
  // A test that fails mid-countdown must not leave fake timers installed for
  // the next one — that turned two unrelated failures into 5s timeouts.
  afterEach(() => vi.useRealTimers());

  it("shows which number the code went to, grouped to be checkable", () => {
    // A buyer has to compare this against their handset. An unbroken
    // ten-digit run is the hardest form to scan, so it is grouped 5+5.
    render(<OtpEntry {...BASE} />);
    expect(screen.getByText(/\+91 84337 19326/)).toBeInTheDocument();
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

  it("does not offer resend the instant the code was sent", () => {
    // The SMS is seconds old. A resend button live at mount invites a second
    // one before the first arrives — a wasted message, and Cashfree rate-limits
    // OTP sends per number.
    render(<OtpEntry {...BASE} />);

    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
    expect(screen.getByText(/resend code in 0:30/i)).toBeInTheDocument();
  });

  it("counts down and then offers resend", () => {
    vi.useFakeTimers();
    const onResend = vi.fn();
    render(<OtpEntry {...BASE} onResend={onResend} />);

    expect(screen.getByText(/0:30/)).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(9_000));
    expect(screen.getByText(/0:21/)).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(21_000));
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    expect(onResend).toHaveBeenCalled();
  });

  it("restarts the countdown after a resend", () => {
    vi.useFakeTimers();
    render(<OtpEntry {...BASE} />);

    act(() => void vi.advanceTimersByTime(30_000));
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    // Otherwise the button stays live and every click costs another SMS.
    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
    expect(screen.getByText(/resend code in 0:30/i)).toBeInTheDocument();
  });

  it("disables verify while busy", () => {
    render(<OtpEntry {...BASE} busy />);
    expect(screen.getByRole("button", { name: /verifying/i })).toBeDisabled();
  });

  it("holds Verify shut until six digits are in", async () => {
    render(<OtpEntry {...BASE} />);

    const verify = screen.getByRole("button", { name: /verify/i });
    expect(verify).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/code/i), "11100");
    expect(verify).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/code/i), "0");
    expect(verify).toBeEnabled();
  });

  it("caps the code at six digits", async () => {
    // Cashfree sends a six-digit OTP. The field accepted eight, so a buyer who
    // fat-fingered an extra digit got a silently longer code and a rejection
    // from the API rather than a field that would not take it.
    render(<OtpEntry {...BASE} />);

    const input = screen.getByLabelText(/code/i);
    await userEvent.type(input, "11100099");

    expect(input).toHaveValue("111000");
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
