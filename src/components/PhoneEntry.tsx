import { useState } from "react";
import {
  BRAND_MARK,
  BackLink,
  CTA_BG,
  ArrowRightIcon,
  FIELD_BASE,
  FIELD_SUBMIT_CLASS,
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

      {/* The submit control lives inside the field, so there is no separate
          Continue button. One target, at the end of the thing being filled in.

          Capped in rem, not as a fraction of the row. What goes in here has a
          fixed size — px-4, "+91", a divider, ten digits and a 36px arrow is
          about 230px — so a fraction of a container the widget does not
          control clips it. w-1/4 was tried and cut the placeholder to
          "10 digit". max-w still lets the field shrink on a narrow host, where
          a fraction would have been the only thing that fits. */}
      <div
        // ring-inset, not a plain ring: Tailwind draws a ring as a box-shadow
        // outside the border box, so the field would sit 2px proud on each side.
        className={`mt-2 w-full max-w-[18rem] ring-2 ring-inset transition-colors ${FIELD_BASE} ${
          showError ? "ring-red-500" : "ring-[var(--brand)] focus-within:ring-[var(--brand)]"
        }`}
        style={{ ["--brand" as string]: BRAND_MARK }}
      >
        {/* The country code sits outside the input rather than inside its
            value: the field holds ten digits and nothing else, so the
            submitted string never has to be parsed back apart. */}
        <span className="text-base text-black/60">+91</span>
        <span aria-hidden="true" className="h-5 w-px bg-black/15" />
        <input
          id="phone"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="10 digits"
          value={phone}
          // Stripped as typed rather than validated afterwards: a field that
          // quietly refuses characters is clearer than one that scolds later.
          onChange={(e) =>
            setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          // Enter submits. With the arrow being the only control and no button
          // in the tab order after the field, a keyboard user filling in ten
          // digits and pressing Enter would otherwise get nothing.
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && !busy) onSubmit(phone);
          }}
          className="w-full min-w-0 bg-transparent text-base text-black outline-none placeholder:text-black/40"
        />

        <button
          type="button"
          // Named, because an arrow has no accessible name of its own and this
          // is now the only way forward on the screen.
          aria-label="Continue"
          disabled={busy || !valid}
          onClick={() => onSubmit(phone)}
          className={FIELD_SUBMIT_CLASS}
          style={{ backgroundColor: CTA_BG }}
        >
          <ArrowRightIcon />
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
