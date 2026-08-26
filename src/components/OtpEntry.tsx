import { useEffect, useState } from "react";
import {
  CTA_BG,
  ArrowRightIcon,
  FIELD_SUBMIT_CLASS,
  FIELD_BASE,
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
 * Cashfree sends a six-digit OTP.
 *
 * The field took eight, so a buyer who fat-fingered a seventh digit got a
 * silently longer code and a rejection from the API instead of a field that
 * simply would not take it.
 */
const OTP_LENGTH = 6;

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

      {/* The submit control sits inside the field, as it does on the phone
          screen, so there is no separate Verify button. The value is
          deliberately kept on error — the code is still sitting in the user's
          messages, and clearing it makes them retype it. */}
      <div
        className={`mt-2 w-full max-w-[14rem] ${FIELD_BASE}`}
        style={{
          // Inset for the same reason PhoneEntry's ring is: an outset shadow
          // would put the field 2px proud of its own box on every side.
          boxShadow: `inset 0 0 0 2px ${error ? "#dc2626" : BRAND_MARK}`,
        }}
      >
        <input
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={(e) =>
            setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))
          }
          // Enter submits. The arrow is the only control and nothing follows
          // the field in the tab order, so a keyboard user typing the code and
          // pressing Enter would otherwise get nothing.
          onKeyDown={(e) => {
            if (e.key === "Enter" && otp.length === OTP_LENGTH && !busy) {
              onSubmit(otp);
            }
          }}
          className="w-full min-w-0 bg-transparent text-lg font-semibold tracking-wider text-black outline-none placeholder:text-black/40"
        />

        <button
          type="button"
          // Named, because an arrow has no accessible name of its own and this
          // is the only way forward on the screen.
          aria-label="Verify"
          disabled={busy || otp.length !== OTP_LENGTH}
          onClick={() => onSubmit(otp)}
          className={FIELD_SUBMIT_CLASS}
          style={{ backgroundColor: CTA_BG }}
        >
          <ArrowRightIcon />
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

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
