import { useState } from "react";
import {
  BRAND_MARK,
  BackLink,
  CTA_BG,
  CTA_CLASS,
  FIELD_BASE,
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

  const valid = /^\d{10}$/.test(phone);
  // Driven off the field, not off a click: Continue is shut until the number
  // is valid, so the click that used to reveal this can no longer happen. A
  // half-typed number still gets told why nothing is going to happen.
  const showError = phone.length > 0 && !valid;

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

      {/* Field and button share one row at equal width — `flex-1` on both is
          `1 1 0%`, so they split the row rather than sizing to their contents.
          The country code sits outside the input rather than inside its value:
          the field holds ten digits and nothing else, so the submitted string
          never has to be parsed back apart. */}
      <div className="mt-2 flex items-center gap-3">
        <div
          // ring-inset, not a plain ring: Tailwind draws a ring as a box-shadow
          // outside the border box, so the field sat 2px proud on each side and
          // stood taller and wider than the button beside it.
          className={`min-w-0 flex-1 ring-2 ring-inset transition-colors ${FIELD_BASE} ${
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
            // Shortened when the field gave up half its width to the button.
            // "10-digit mobile number" no longer fits and an input clips rather
            // than ellipsises, so it would have read "10-digit mobil".
            placeholder="10 digits"
            value={phone}
            // Stripped as typed rather than validated afterwards: a field that
            // quietly refuses characters is clearer than one that scolds later.
            onChange={(e) =>
              setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            className="w-full min-w-0 bg-transparent text-base text-black outline-none placeholder:text-black/40"
          />
        </div>

        <button
          type="button"
          disabled={busy || !valid}
          onClick={() => onSubmit(phone)}
          className={`flex-1 ${CTA_CLASS}`}
          style={{ backgroundColor: CTA_BG }}
        >
          {busy ? "Please wait…" : "Continue"}
        </button>
      </div>

      {showError && (
        <p className="mt-2 text-sm text-red-600">
          Enter a 10-digit phone number.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <SecuredByCashfree />
    </div>
  );
}
