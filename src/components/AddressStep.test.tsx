import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddressStep } from "./AddressStep";
import type { OccAddress } from "../lib/cashfree/occ";

const ADDRESS: OccAddress = {
  id: "1054210",
  customer_name: "kishan",
  address_line_one: "Koramangala",
  address_line_two: "",
  city: "Bangalore",
  country: "India",
  country_code: "IN",
  zip_code: "560034",
  state: "Karnataka",
  state_code: "KA",
  phone: "+91 8433719326",
  email: "buyer@example.test",
};

const BASE = {
  busy: false,
  error: null,
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onBack: vi.fn(),
};

async function fillForm() {
  await userEvent.type(screen.getByLabelText(/full name/i), "Kishan");
  await userEvent.type(screen.getByLabelText(/^address$/i), "Koramangala");
  await userEvent.type(screen.getByLabelText(/city/i), "Bangalore");
  await userEvent.type(screen.getByLabelText(/state/i), "Karnataka");
  await userEvent.type(screen.getByLabelText(/pin/i), "560034");
  await userEvent.type(screen.getByLabelText(/email/i), "b@e.test");
}

/** Five saved addresses, the shape a real account accumulates. */
const MANY: OccAddress[] = [
  { ...ADDRESS, id: "1", customer_name: "K", state: "Telangana" },
  { ...ADDRESS, id: "2", customer_name: "K", state: "Maharashtra" },
  { ...ADDRESS, id: "3", customer_name: "K", state: "Karnataka" },
  { ...ADDRESS, id: "4", customer_name: "Kishan", address_line_one: "MG Road" },
  { ...ADDRESS, id: "5", customer_name: "kishan", address_line_one: "Indiranagar" },
];

function addressCards() {
  return screen
    .getAllByRole("button")
    .filter((b) => /deliver here/i.test(b.textContent ?? ""));
}

describe("AddressStep — choosing from many", () => {
  it("makes the whole card the target, not a button beside it", () => {
    // A card-sized tap target beats a small button on a phone, and it stops
    // the page repeating a button once per address.
    render(<AddressStep {...BASE} addresses={[ADDRESS]} />);

    const card = addressCards()[0];
    expect(card).toHaveAccessibleName(/Koramangala/);
    expect(card).toHaveAccessibleName(/deliver here/i);
  });

  it("shows every address when there are three or fewer", () => {
    render(<AddressStep {...BASE} addresses={MANY.slice(0, 3)} />);

    expect(addressCards()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /show \d+ more/i })).toBeNull();
  });

  it("collapses the rest behind a toggle that names the count", () => {
    // Five near-identical cards is a wall to scroll past. "Show 2 more" says
    // how much is hidden, so nothing feels lost.
    render(<AddressStep {...BASE} addresses={MANY} />);

    expect(addressCards()).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: /show 2 more/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Indiranagar/)).toBeNull();
  });

  it("reveals the remaining addresses when the toggle is tapped", async () => {
    render(<AddressStep {...BASE} addresses={MANY} />);

    await userEvent.click(screen.getByRole("button", { name: /show 2 more/i }));

    expect(addressCards()).toHaveLength(5);
    expect(screen.getByText(/Indiranagar/)).toBeInTheDocument();
  });

  it("still selects an address that was revealed by the toggle", async () => {
    // The collapse must not make a hidden address unreachable.
    const onSelect = vi.fn();
    render(<AddressStep {...BASE} addresses={MANY} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: /show 2 more/i }));
    await userEvent.click(addressCards()[4]);

    expect(onSelect).toHaveBeenCalledWith(MANY[4]);
  });

  it("keeps the add-address action reachable while collapsed", () => {
    render(<AddressStep {...BASE} addresses={MANY} />);

    expect(
      screen.getByRole("button", { name: /add.*address/i }),
    ).toBeInTheDocument();
  });
});

describe("AddressStep", () => {
  it("lists saved addresses", () => {
    render(<AddressStep {...BASE} addresses={[ADDRESS]} />);

    expect(screen.getByText(/Koramangala/)).toBeInTheDocument();
    expect(screen.getByText(/560034/)).toBeInTheDocument();
  });

  it("selects a saved address", async () => {
    const onSelect = vi.fn();
    render(<AddressStep {...BASE} addresses={[ADDRESS]} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: /deliver here/i }));

    expect(onSelect).toHaveBeenCalledWith(ADDRESS);
  });

  it("shows the capture form when there are no saved addresses", () => {
    // Not an error state — it is the expected path for a new customer.
    render(<AddressStep {...BASE} addresses={[]} />);

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save address/i }),
    ).toBeInTheDocument();
  });

  it("lets the user add another address when some already exist", async () => {
    render(<AddressStep {...BASE} addresses={[ADDRESS]} />);

    await userEvent.click(
      screen.getByRole("button", { name: /add a new address/i }),
    );

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
  });

  it("submits a complete new address with country defaults", async () => {
    const onCreate = vi.fn();
    render(<AddressStep {...BASE} addresses={[]} onCreate={onCreate} />);

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: /save address/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_name: "Kishan",
        address_line_one: "Koramangala",
        city: "Bangalore",
        state: "Karnataka",
        zip_code: "560034",
        email: "b@e.test",
        country: "India",
        country_code: "IN",
      }),
    );
  });

  it("does not submit an incomplete address", async () => {
    const onCreate = vi.fn();
    render(<AddressStep {...BASE} addresses={[]} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/full name/i), "Kishan");
    await userEvent.click(screen.getByRole("button", { name: /save address/i }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/required/i)).toBeInTheDocument();
  });

  it("shows a server rejection without clearing the form", async () => {
    const { rerender } = render(<AddressStep {...BASE} addresses={[]} />);

    await fillForm();
    rerender(
      <AddressStep {...BASE} addresses={[]} error="zip_code is invalid" />,
    );

    expect(screen.getByText(/zip_code is invalid/)).toBeInTheDocument();
    expect(screen.getByLabelText(/city/i)).toHaveValue("Bangalore");
  });

  it("disables saving while busy", () => {
    render(<AddressStep {...BASE} addresses={[]} busy />);

    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });
});

describe("AddressStep — Cashfree address length rule", () => {
  it("blocks an address shorter than 10 characters", async () => {
    const onCreate = vi.fn();
    render(<AddressStep {...BASE} addresses={[]} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/full name/i), "Kishan");
    await userEvent.type(screen.getByLabelText(/^address$/i), "Short");
    await userEvent.type(screen.getByLabelText(/city/i), "Bangalore");
    await userEvent.type(screen.getByLabelText(/state/i), "Karnataka");
    await userEvent.type(screen.getByLabelText(/pin/i), "560034");
    await userEvent.type(screen.getByLabelText(/email/i), "b@e.test");
    await userEvent.click(screen.getByRole("button", { name: /save address/i }));

    // Cashfree answers 400 for this. Catching it here means a message the
    // buyer can act on instead of a failed save.
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/too short/i)).toBeInTheDocument();
  });

  it("accepts an address of at least 10 characters", async () => {
    const onCreate = vi.fn();
    render(<AddressStep {...BASE} addresses={[]} onCreate={onCreate} />);

    await userEvent.type(screen.getByLabelText(/full name/i), "Kishan");
    await userEvent.type(
      screen.getByLabelText(/^address$/i),
      "80 Feet Road Koramangala",
    );
    await userEvent.type(screen.getByLabelText(/city/i), "Bangalore");
    await userEvent.type(screen.getByLabelText(/state/i), "Karnataka");
    await userEvent.type(screen.getByLabelText(/pin/i), "560034");
    await userEvent.type(screen.getByLabelText(/email/i), "b@e.test");
    await userEvent.click(screen.getByRole("button", { name: /save address/i }));

    expect(onCreate).toHaveBeenCalled();
  });
});

describe("AddressStep — saved addresses win over the add form", () => {
  it("switches to the list when addresses arrive after mount", () => {
    // The list is fetched asynchronously, so the component can mount before it
    // lands. Latching the form at mount meant a customer with saved addresses
    // was made to retype one.
    const { rerender } = render(<AddressStep {...BASE} addresses={[]} />);
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();

    rerender(<AddressStep {...BASE} addresses={[ADDRESS]} />);

    expect(screen.queryByLabelText(/full name/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /deliver here/i }),
    ).toBeInTheDocument();
  });

  it("keeps the form open when the buyer asked for it", async () => {
    render(<AddressStep {...BASE} addresses={[ADDRESS]} />);

    await userEvent.click(
      screen.getByRole("button", { name: /add a new address/i }),
    );

    // An explicit choice outranks the list.
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
  });

  it("selecting a saved address does not create one", async () => {
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    render(
      <AddressStep
        {...BASE}
        addresses={[ADDRESS]}
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /deliver here/i }));

    expect(onSelect).toHaveBeenCalledWith(ADDRESS);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("carries the Cashfree assurance the earlier steps show", () => {
    // Phone entry and OTP both footer this. A checkout that drops it partway
    // reads as having handed the buyer somewhere else mid-payment.
    render(<AddressStep {...BASE} addresses={[]} />);

    expect(screen.getByText(/secured by/i)).toBeInTheDocument();
    expect(screen.getByText("Cashfree")).toBeInTheDocument();
  });

});
