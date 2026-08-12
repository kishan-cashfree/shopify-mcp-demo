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
});
