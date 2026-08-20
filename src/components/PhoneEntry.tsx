import { useState } from "react";
import {
  BRAND_MARK,
  BackLink,
  CTA_BG,
  LoginWithCashfree,
  SecuredByCashfree,
} from "./checkoutChrome";

interface PhoneEntryProps {
  busy: boolean;
  error: string | null;
  onSubmit: (phone: string) => void;
  onBack: () => void;
}

export function PhoneEntry({ busy, error, onSubmit, onBack }: PhoneEntryProps) {
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);

  const valid = /^\d{10}$/.test(phone);
  const showError = touched && !valid;

  return (
    <div className="flex flex-col p-5">
      <BackLink label="Back to cart" onClick={onBack} />
      <LoginWithCashfree />

      <h2 className="mt-2 text-2xl font-bold tracking-tight">
        Sign in to check out
      </h2>
      <p className="mt-1 text-sm text-secondary">
        We&rsquo;ll text you a one-time code.
      </p>

      <label className="mt-6 text-sm font-medium" htmlFor="phone">
        Phone number
      </label>

      {/* The country code sits outside the input rather than inside its value:
          the field holds ten digits and nothing else, so the submitted string
          never has to be parsed back apart. */}
      <div
        className={`mt-2 flex items-center gap-3 rounded-xl bg-white px-4 py-3 ring-2 transition-colors ${
          showError ? "ring-red-500" : "ring-[var(--brand)] focus-within:ring-[var(--brand)]"
        }`}
        style={{ ["--brand" as string]: BRAND_MARK }}
      >
        <span className="text-base text-black/60">+91</span>
        <span aria-hidden="true" className="h-5 w-px bg-black/15" />
        <input
          id="phone"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="10-digit mobile number"
          value={phone}
          // Stripped as typed rather than validated afterwards: a field that
          // quietly refuses characters is clearer than one that scolds later.
          onChange={(e) =>
            setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          className="w-full bg-transparent text-base text-black outline-none placeholder:text-black/40"
        />
      </div>

      {showError && (
        <p className="mt-2 text-sm text-red-600">
          Enter a 10-digit phone number.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setTouched(true);
          if (valid) onSubmit(phone);
        }}
        className="mt-5 w-full rounded-xl px-4 py-3.5 text-base font-semibold text-white disabled:opacity-40"
        style={{ backgroundColor: CTA_BG }}
      >
        {busy ? "Please wait…" : "Continue"}
      </button>

      <SecuredByCashfree />
    </div>
  );
}
