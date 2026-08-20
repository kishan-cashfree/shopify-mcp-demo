import { useState } from "react";
import type { NewAddress, OccAddress } from "../lib/cashfree/occ";
import { CTA_BG, SecuredByCashfree } from "./checkoutChrome";

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

/** Enough to recognise the one you want without scrolling. */
const VISIBLE_LIMIT = 3;

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

  // Accounts accumulate near-duplicate addresses, and five of them is a wall
  // to scroll past. Nothing is dropped — the toggle says how many are folded.
  // Order is whatever Cashfree returned: OccAddress carries no timestamp, so
  // "most recent" is not something this component can honestly claim.
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? addresses : addresses.slice(0, VISIBLE_LIMIT);
  const hiddenCount = addresses.length - visible.length;

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
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visible.map((address) => (
              <li key={address.id} className="contents">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(address)}
                  className="group flex h-full flex-col items-start gap-0.5 rounded-xl border border-black/10 p-3 text-left transition hover:border-black/30 hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
                >
                  <span className="text-sm font-medium">
                    {address.customer_name}
                  </span>
                  <span className="text-sm text-secondary">
                    {address.address_line_one}
                    {address.address_line_two
                      ? `, ${address.address_line_two}`
                      : ""}
                  </span>
                  <span className="text-sm text-secondary">
                    {address.city}, {address.state} {address.zip_code}
                  </span>
                  <span className="mt-2 text-xs font-medium opacity-60 transition group-hover:opacity-100">
                    Deliver here →
                  </span>
                </button>
              </li>
            ))}

            {/* In the grid rather than below it, so the last row never ends on
                a gap and the action stays where the eye already is. */}
            <li className="contents">
              <button
                type="button"
                onClick={() => setAddingOverride(true)}
                className="flex h-full min-h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-black/20 p-3 text-sm text-secondary transition hover:border-black/40 hover:text-current"
              >
                <span className="text-lg leading-none">+</span>
                Add a new address
              </button>
            </li>
          </ul>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="self-center text-sm underline"
            >
              Show {hiddenCount} more
            </button>
          )}
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
            className="rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: CTA_BG }}
          >
            {busy ? "Saving…" : "Save address"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <SecuredByCashfree />
    </div>
  );
}
