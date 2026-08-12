import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatCustomerPhone,
  initiateOtp,
  verifyOtp,
  getAddresses,
  createAddress,
} from "./occ";

const CONFIG = {
  clientId: "x",
  clientSecret: "y",
  environment: "sandbox" as const,
  baseUrl: "https://sandbox.cashfree.com",
};

const CTX = {
  paymentSessionId: "session_abc",
  authToken: "tok._.ch_x",
  phone: "8433719326",
};

const ADDRESS = {
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

const NEW_ADDRESS = {
  customer_name: "kishan",
  address_line_one: "Koramangala",
  address_line_two: "",
  city: "Bangalore",
  zip_code: "560034",
  state: "Karnataka",
  state_code: "KA",
  country: "India",
  country_code: "IN",
  email: "buyer@example.test",
  phone: "+91 8433719326",
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("formatCustomerPhone", () => {
  it("renders the header format Cashfree expects", () => {
    // Verified live: "+91 8433719326" — country code, space, ten digits.
    expect(formatCustomerPhone("8433719326")).toBe("+91 8433719326");
  });

  it("is idempotent when already formatted", () => {
    expect(formatCustomerPhone("+91 8433719326")).toBe("+91 8433719326");
  });

  it("normalises a +91 with no space", () => {
    expect(formatCustomerPhone("+918433719326")).toBe("+91 8433719326");
  });
});

describe("initiateOtp", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts to auth/initiate with the session as x-chxs-id", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ status: true }) as never);

    await initiateOtp(CONFIG, {
      paymentSessionId: "session_abc",
      phone: "8433719326",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://sandbox.cashfree.com/checkout/api/auth/initiate");
    expect((init?.headers as Record<string, string>)["x-chxs-id"]).toBe(
      "session_abc",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      authentication_type: "OTP",
      cf_customer_phone: "8433719326",
      source: "ch_x",
    });
  });

  it("throws when the session is rejected", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: "payment_session_id is not present or is invalid",
        code: "payment_session_id_invalid",
      }),
    } as never);

    await expect(
      initiateOtp(CONFIG, { paymentSessionId: "bad", phone: "8433719326" }),
    ).rejects.toThrow(/payment_session_id/);
  });
});

describe("verifyOtp", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns the auth token and customer uid", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({
        status: true,
        authentication_token: "tok._.ch_x",
        customer_uid: "uid-1",
      }) as never,
    );

    const result = await verifyOtp(CONFIG, {
      paymentSessionId: "session_abc",
      phone: "8433719326",
      otp: "111000",
    });

    expect(result).toEqual({ authToken: "tok._.ch_x", customerUid: "uid-1" });
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string).otp,
    ).toBe("111000");
  });

  it("throws when the OTP is wrong", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Invalid OTP" }),
    } as never);

    await expect(
      verifyOtp(CONFIG, {
        paymentSessionId: "session_abc",
        phone: "8433719326",
        otp: "000000",
      }),
    ).rejects.toThrow("Invalid OTP");
  });

  it("throws when the body reports failure without an http error", async () => {
    // Observed success shape is { status: true }. A 200 with status:false must
    // not be read as success — the rest of the flow would get no token.
    vi.mocked(fetch).mockResolvedValue(ok({ status: false }) as never);

    await expect(
      verifyOtp(CONFIG, {
        paymentSessionId: "session_abc",
        phone: "8433719326",
        otp: "000000",
      }),
    ).rejects.toThrow();
  });

  it("throws when the token is missing despite status true", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ status: true }) as never);

    await expect(
      verifyOtp(CONFIG, {
        paymentSessionId: "session_abc",
        phone: "8433719326",
        otp: "111000",
      }),
    ).rejects.toThrow();
  });
});

describe("getAddresses", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("sends exactly the three required headers", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [ADDRESS] }) as never);

    await getAddresses(CONFIG, CTX);

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers["x-authentication-token"]).toBe("tok._.ch_x");
    expect(headers["x-chxs-id"]).toBe("session_abc");
    expect(headers["x-customer-phone"]).toBe("+91 8433719326");
  });

  it("returns the address list", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [ADDRESS] }) as never);

    const addresses = await getAddresses(CONFIG, CTX);

    expect(addresses).toHaveLength(1);
    expect(addresses[0].id).toBe("1054210");
  });

  it("returns an empty array for a customer with none", async () => {
    // Not an error — it is the path to the capture form.
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [] }) as never);

    expect(await getAddresses(CONFIG, CTX)).toEqual([]);
  });

  it("tolerates a missing addresses key", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({}) as never);

    expect(await getAddresses(CONFIG, CTX)).toEqual([]);
  });

  it("surfaces a rejection", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "session expired" }),
    } as never);

    await expect(getAddresses(CONFIG, CTX)).rejects.toThrow("session expired");
  });
});

describe("createAddress", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts shipping and billing as the same address", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ addresses: [ADDRESS] }) as never);

    await createAddress(CONFIG, CTX, NEW_ADDRESS);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.shipping_address.city).toBe("Bangalore");
    expect(body.billing_address).toEqual(body.shipping_address);
    expect(body.is_guest).toBe(false);
    expect(body.shipping_address.type).toBe("SHIPPING_ADDRESS");
  });

  it("re-reads the list rather than parsing the create response", async () => {
    vi.mocked(fetch)
      // Create returns { shipping_address, billing_address } — not a list.
      .mockResolvedValueOnce(
        ok({ shipping_address: ADDRESS, billing_address: ADDRESS }) as never,
      )
      .mockResolvedValueOnce(ok({ addresses: [ADDRESS, ADDRESS] }) as never);

    const result = await createAddress(CONFIG, CTX, NEW_ADDRESS);

    // Parsing the create response as a list would silently return [], leaving
    // the buyer with an empty address picker straight after adding one.
    expect(result).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBeUndefined();
  });

  it("surfaces a rejection message", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "zip_code is invalid" }),
    } as never);

    await expect(createAddress(CONFIG, CTX, NEW_ADDRESS)).rejects.toThrow(
      "zip_code is invalid",
    );
  });
});
