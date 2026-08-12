import { useState } from "react";

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

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back to cart
      </button>

      <h2 className="text-base font-semibold">Sign in to check out</h2>
      <p className="text-sm text-secondary">
        We&rsquo;ll text you a one-time code.
      </p>

      <label className="text-sm" htmlFor="phone">
        Phone number
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-secondary">+91</span>
        <input
          id="phone"
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          // Stripped as typed rather than validated afterwards: a field that
          // quietly refuses characters is clearer than one that scolds later.
          onChange={(e) =>
            setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
          }
          className="flex-1 rounded-lg border border-black/15 px-3 py-2 text-sm"
        />
      </div>

      {touched && !valid && (
        <p className="text-sm text-red-600">Enter a 10-digit phone number.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setTouched(true);
          if (valid) onSubmit(phone);
        }}
        className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Please wait…" : "Continue"}
      </button>
    </div>
  );
}
