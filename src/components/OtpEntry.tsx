import { useState } from "react";

interface OtpEntryProps {
  phone: string;
  busy: boolean;
  error: string | null;
  onSubmit: (otp: string) => void;
  onResend: () => void;
  onBack: () => void;
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

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Change number
      </button>

      <h2 className="text-base font-semibold">Enter the code</h2>
      <p className="text-sm text-secondary">Sent to +91 {phone}</p>

      <label className="text-sm" htmlFor="otp">
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
        className="rounded-lg border border-black/15 px-3 py-2 text-sm tracking-widest"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => onSubmit(otp)}
        className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Verifying…" : "Verify"}
      </button>

      <button
        type="button"
        onClick={onResend}
        className="text-sm text-secondary underline"
      >
        Resend code
      </button>
    </div>
  );
}
