import { useEffect, useState } from "react";
import {
  CTA_BG,
  BRAND_MARK,
  BackLink,
  LoginWithCashfree,
  SecuredByCashfree,
} from "./checkoutChrome";

interface OtpEntryProps {
  phone: string;
  busy: boolean;
  error: string | null;
  onSubmit: (otp: string) => void;
  onResend: () => void;
  onBack: () => void;
}

/** How long a buyer must wait before a second SMS can be sent. */
const RESEND_SECONDS = 30;

/**
 * "8433719326" → "84337 19326".
 *
 * The buyer reads this off the screen and compares it to their handset. An
 * unbroken ten-digit run is the hardest form to scan, and getting it wrong
 * means waiting out a code that will never arrive.
 */
function groupPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10
    ? `${digits.slice(0, 5)} ${digits.slice(5)}`
    : phone;
}

function mmss(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function OtpEntry({
  phone,
  busy,
  error,
  onSubmit,
  onResend,
  onBack,
}: OtpEntryProps) {
  const [otp, setOtp] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  // One interval for the whole countdown, cleared on unmount. The widget is
  // remounted as the buyer scrolls, so a timer that outlived its component
  // would accumulate — the same defect that made cashfree-here post "Payment
  // completed successfully" every few seconds, forever.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(
      () => setSecondsLeft((s) => (s <= 1 ? 0 : s - 1)),
      1_000,
    );
    return () => clearInterval(id);
  }, [secondsLeft > 0]);

  return (
    <div className="flex flex-col p-5">
      <BackLink label="Change number" onClick={onBack} />
      <LoginWithCashfree />

      <h2 className="mt-2 text-2xl font-bold tracking-tight">Enter the code</h2>
      <p className="mt-1 text-sm text-secondary">
        Sent to +91 {groupPhone(phone)}
      </p>

      <label className="mt-6 text-sm font-medium" htmlFor="otp">
        One-time code
      </label>

      {/* The value is deliberately kept on error — the code is still sitting in
          the user's messages, and clearing it makes them retype it. */}
      <input
        id="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
        className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-lg font-semibold tracking-wider text-black outline-none ring-2 placeholder:text-black/40"
        style={{
          boxShadow: `0 0 0 2px ${error ? "#dc2626" : BRAND_MARK}`,
        }}
      />

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit(otp)}
        className="mt-5 w-full rounded-xl px-4 py-3.5 text-base font-semibold text-white disabled:opacity-40"
        style={{ backgroundColor: CTA_BG }}
      >
        {busy ? "Verifying…" : "Verify"}
      </button>

      {/* Text while it counts, a button only once it can actually do something.
          A live resend at mount invites a second SMS before the first arrives,
          and Cashfree rate-limits OTP sends per number. */}
      {secondsLeft > 0 ? (
        <p className="mt-4 text-center text-sm font-semibold text-secondary">
          Resend code in {mmss(secondsLeft)}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSecondsLeft(RESEND_SECONDS);
            onResend();
          }}
          className="mt-4 text-center text-sm font-semibold underline"
        >
          Resend code
        </button>
      )}

      <SecuredByCashfree />
    </div>
  );
}
