import { useState } from "react";
import type { NewAddress, OccAddress } from "../lib/cashfree/occ";

interface AddressStepProps {
  addresses: OccAddress[];
  busy: boolean;
  error: string | null;
  onSelect: (address: OccAddress) => void;
  onCreate: (address: NewAddress) => void;
  onBack: () => void;
}

const EMPTY = {
  customer_name: "",
  address_line_one: "",
  address_line_two: "",
  city: "",
  state: "",
  zip_code: "",
  email: "",
};

type FormField = keyof typeof EMPTY;

export function AddressStep({
  addresses,
  busy,
  error,
  onSelect,
  onCreate,
  onBack,
}: AddressStepProps) {
  // Derived, not latched. useState(addresses.length === 0) evaluates once at
  // mount, so a component that mounts before the list arrives — or is
  // remounted by the host mid-flow — shows the add form forever, even for a
  // customer whose saved addresses turn up a moment later.
  //
  // null means "follow the list"; a boolean means the buyer chose explicitly.
  const [addingOverride, setAddingOverride] = useState<boolean | null>(null);
  const adding = addingOverride ?? addresses.length === 0;
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState(false);

  const complete = (
    [
      "customer_name",
      "address_line_one",
      "city",
      "state",
      "zip_code",
      "email",
    ] as FormField[]
  ).every((key) => form[key].trim().length > 0);

  // Cashfree rejects a combined address shorter than 10 or longer than 185
  // characters: "combined length of address line one and address line two
  // should be between 10 to 185 characters". Catching it here turns a 502 on
  // save into a message the buyer can act on before submitting.
  const addressLength = (
    form.address_line_one + form.address_line_two
  ).trim().length;
  const addressLengthOk = addressLength >= 10 && addressLength <= 185;

  function field(id: FormField, label: string, type = "text") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-secondary" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          type={type}
          value={form[id]}
          onChange={(e) => setForm({ ...form, [id]: e.target.value })}
          className="rounded-lg border border-black/15 px-3 py-2 text-sm"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-secondary underline"
      >
        Back
      </button>

      <h2 className="text-base font-semibold">Delivery address</h2>

      {!adding && (
        <>
          <ul className="flex flex-col gap-2">
            {addresses.map((address) => (
              <li
                key={address.id}
                className="rounded-xl border border-black/10 p-3"
              >
                <p className="text-sm font-medium">{address.customer_name}</p>
                <p className="text-sm text-secondary">
                  {address.address_line_one}
                  {address.address_line_two
                    ? `, ${address.address_line_two}`
                    : ""}
                </p>
                <p className="text-sm text-secondary">
                  {address.city}, {address.state} {address.zip_code}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(address)}
                  className="mt-2 rounded-lg bg-black/90 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Deliver here
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setAddingOverride(true)}
            className="text-sm underline"
          >
            Add a new address
          </button>
        </>
      )}

      {adding && (
        <div className="flex flex-col gap-2">
          {field("customer_name", "Full name")}
          {field("address_line_one", "Address")}
          {field("address_line_two", "Apartment, suite (optional)")}
          {field("city", "City")}
          {field("state", "State")}
          {field("zip_code", "PIN code")}
          {field("email", "Email", "email")}

          {touched && !complete && (
            <p className="text-sm text-red-600">All fields are required.</p>
          )}
          {touched && complete && !addressLengthOk && (
            <p className="text-sm text-red-600">
              {addressLength < 10
                ? "Address is too short — Cashfree needs at least 10 characters across both address lines."
                : "Address is too long — keep both address lines under 185 characters."}
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (!complete || !addressLengthOk) return;
              onCreate({
                ...form,
                // India-only, matching the demo store's currency. Cashfree
                // wants both a country name and a code.
                country: "India",
                country_code: "IN",
                state_code: form.state.slice(0, 2).toUpperCase(),
                // Filled in by the flow hook, which holds the verified number.
                // Asking again here would be rude and error-prone.
                phone: "",
              });
            }}
            className="rounded-xl bg-black/90 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save address"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
