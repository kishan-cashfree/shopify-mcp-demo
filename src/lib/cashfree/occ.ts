import type { CashfreeConfig } from "./config";

/**
 * Cashfree One Click Checkout endpoints.
 *
 * These are INTERNAL: `/checkout/api/...` is what Cashfree's own hosted
 * checkout page calls from the browser. They are unversioned, absent from the
 * published documentation, and may change without notice. Every shape here was
 * captured live — see docs/cashfree-occ-api.md.
 *
 * Notably, none of the browser fingerprinting those captured calls carry
 * (device ids, Forter token, cookies, origin) is required. Three headers are.
 */

export interface OccContext {
  paymentSessionId: string;
  authToken: string;
  phone: string;
}

export interface OccAddress {
  id: string;
  customer_name: string;
  address_line_one: string;
  address_line_two: string;
  city: string;
  country: string;
  country_code: string;
  zip_code: string;
  state: string;
  state_code: string;
  phone: string;
  email: string;
}

export type NewAddress = Omit<OccAddress, "id">;

/** Header format verified live: country code, space, ten digits. */
export function formatCustomerPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return `+91 ${digits}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function authHeaders(ctx: OccContext): Record<string, string> {
  // All three are mandatory — established by bisection. Any two returns 400.
  return {
    "content-type": "application/json",
    "x-authentication-token": ctx.authToken,
    "x-chxs-id": ctx.paymentSessionId,
    "x-customer-phone": formatCustomerPhone(ctx.phone),
  };
}

export async function initiateOtp(
  config: CashfreeConfig,
  input: { paymentSessionId: string; phone: string },
): Promise<void> {
  const response = await fetch(`${config.baseUrl}/checkout/api/auth/initiate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chxs-id": input.paymentSessionId,
    },
    body: JSON.stringify({
      authentication_type: "OTP",
      cf_customer_phone: input.phone,
      source: "ch_x",
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't send the OTP"));
  }
}

export async function verifyOtp(
  config: CashfreeConfig,
  input: { paymentSessionId: string; phone: string; otp: string },
): Promise<{ authToken: string; customerUid: string }> {
  const response = await fetch(`${config.baseUrl}/checkout/api/auth/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chxs-id": input.paymentSessionId,
    },
    body: JSON.stringify({
      authentication_type: "OTP",
      cf_customer_phone: input.phone,
      source: "ch_x",
      otp: input.otp,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't verify the OTP"));
  }

  const body = (await response.json()) as {
    status?: boolean;
    authentication_token?: string;
    customer_uid?: string;
  };

  // A 200 with status:false is still a failure. Treating it as success would
  // hand the rest of the flow an undefined token and fail further downstream,
  // where the cause is much harder to see.
  if (!body.status || !body.authentication_token) {
    throw new Error("OTP verification failed");
  }

  return {
    authToken: body.authentication_token,
    customerUid: body.customer_uid ?? "",
  };
}

const ADDRESSES_PATH = "/checkout/api/checkouts/customers/addresses";

export async function getAddresses(
  config: CashfreeConfig,
  ctx: OccContext,
): Promise<OccAddress[]> {
  const response = await fetch(`${config.baseUrl}${ADDRESSES_PATH}`, {
    headers: authHeaders(ctx),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't load saved addresses"));
  }

  const body = (await response.json()) as { addresses?: OccAddress[] };
  return body.addresses ?? [];
}

export async function createAddress(
  config: CashfreeConfig,
  ctx: OccContext,
  address: NewAddress,
): Promise<OccAddress[]> {
  const entry = { ...address, type: "SHIPPING_ADDRESS" };

  const response = await fetch(`${config.baseUrl}${ADDRESSES_PATH}`, {
    method: "POST",
    headers: authHeaders(ctx),
    body: JSON.stringify({
      shipping_address: entry,
      // Billing mirrors shipping. A separate billing address is scope this
      // demo does not need, and asking for one doubles the form.
      billing_address: entry,
      is_guest: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Couldn't save the address"));
  }

  // The create response is { shipping_address, billing_address } — not the
  // { addresses: [...] } shape the list endpoint returns. Parsing it as a list
  // yields an empty array on success, so the caller re-reads the list instead
  // of guessing at the created record.
  return getAddresses(config, ctx);
}
