import { useCallback, useState } from "react";
import type { NewAddress, OccAddress } from "../lib/cashfree/occ";
import type { CheckoutSnapshot, CheckoutStep } from "../types";

export interface CheckoutFlow {
  step: CheckoutStep;
  busy: boolean;
  error: string | null;
  paymentSessionId: string | null;
  orderId: string | null;
  phone: string | null;
  checkoutUrl: string | null;
  addresses: OccAddress[];
  start: (cartId: string, phone: string) => Promise<void>;
  submitOtp: (otp: string) => Promise<void>;
  resendOtp: () => Promise<void>;
  selectAddress: (address: OccAddress) => void;
  createAddress: (address: Partial<NewAddress>) => Promise<void>;
  markDispatched: () => void;
  /** Return from the polling screen to the payment step, to retry. */
  backToPayment: () => void;
  /** Async: reloads the address list if a remount emptied it. */
  backToAddress: () => Promise<void>;
  reset: () => void;
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof parsed?.error === "string" ? parsed.error : "Request failed",
    );
  }
  return parsed;
}

/**
 * The single owner of every checkout transition. App decides only when to
 * enter or leave checkout; each step change happens here, so there is one
 * state machine rather than two that can disagree.
 */
export function useCheckoutFlow(
  baseUrl: string,
  persisted: CheckoutSnapshot,
  onPersist: (snapshot: CheckoutSnapshot) => void,
): CheckoutFlow {
  const [snapshot, setSnapshot] = useState<CheckoutSnapshot>(persisted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-fetchable, so not worth persisting.
  const [addresses, setAddresses] = useState<OccAddress[]>([]);

  const commit = useCallback(
    (patch: Partial<CheckoutSnapshot>) => {
      setSnapshot((prev) => {
        const next = { ...prev, ...patch };
        onPersist(next);
        return next;
      });
    },
    [onPersist],
  );

  /**
   * A POST, not a GET, for two reasons. The session id is a credential and has
   * no business in a URL, where it leaks into access logs, referrers and
   * browser history. And measured in ChatGPT on 2026-08-12, GET requests from
   * this widget never reached the server at all while every POST did — the
   * cause was not identified, but the fix is also the better shape.
   */
  const loadAddresses = useCallback(
    async (session: string) => {
      const parsed = await post(`${baseUrl}/api/pay/addresses/list`, {
        paymentSessionId: session,
      });
      return (parsed.addresses ?? []) as OccAddress[];
    },
    [baseUrl],
  );

  const start = useCallback(
    async (cartId: string, enteredPhone: string) => {
      setBusy(true);
      setError(null);
      try {
        const created = await post(`${baseUrl}/api/pay/order`, {
          cartId,
          phone: enteredPhone,
        });

        // Separate call, so resend has an endpoint that does not create a
        // second order.
        await post(`${baseUrl}/api/pay/otp`, {
          paymentSessionId: created.paymentSessionId,
        });

        commit({
          step: "otp",
          paymentSessionId: created.paymentSessionId,
          orderId: created.orderId,
          phone: enteredPhone,
          checkoutUrl: created.checkoutUrl,
        });
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, commit],
  );

  const submitOtp = useCallback(
    async (otp: string) => {
      const session = snapshot.paymentSessionId;
      if (!session) return;

      setBusy(true);
      setError(null);
      try {
        await post(`${baseUrl}/api/pay/otp/verify`, {
          paymentSessionId: session,
          otp,
        });
      } catch (caught) {
        setError((caught as Error).message);
        setBusy(false);
        return;
      }

      // Separate from verification on purpose. Sharing one try block meant a
      // failure loading addresses surfaced under the OTP field as though the
      // code were wrong — observed in ChatGPT, where verification had in fact
      // succeeded. Telling someone their correct OTP was rejected sends them
      // to re-enter a code that is now spent.
      try {
        setAddresses(await loadAddresses(session));
        commit({ step: "address" });
      } catch (caught) {
        setError(
          `Signed in, but couldn't load your addresses: ${(caught as Error).message}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, snapshot.paymentSessionId, loadAddresses, commit],
  );

  const resendOtp = useCallback(async () => {
    const session = snapshot.paymentSessionId;
    if (!session) return;

    setBusy(true);
    setError(null);
    try {
      await post(`${baseUrl}/api/pay/otp`, { paymentSessionId: session });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [baseUrl, snapshot.paymentSessionId]);

  /**
   * Back one stage, not out of checkout. The order and session were created at
   * the phone step and stay valid, so nothing is rebuilt.
   *
   * The reload guard is for remounts: `addresses` is hook state and is not in
   * the persisted snapshot, so a host re-render resumes at "method" with an
   * empty list. Without refetching, Back would land the buyer on the
   * add-address form instead of the addresses they already saved.
   */
  const backToAddress = useCallback(async () => {
    commit({ step: "address" });

    const session = snapshot.paymentSessionId;
    if (!session || addresses.length > 0) return;

    setBusy(true);
    setError(null);
    try {
      setAddresses(await loadAddresses(session));
    } catch (caught) {
      setError(
        `Couldn't reload your addresses: ${(caught as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }, [snapshot.paymentSessionId, addresses.length, loadAddresses, commit]);

  const createAddress = useCallback(
    async (address: Partial<NewAddress>) => {
      const session = snapshot.paymentSessionId;
      if (!session || !snapshot.phone) return;

      setBusy(true);
      setError(null);
      try {
        const parsed = await post(`${baseUrl}/api/pay/addresses`, {
          paymentSessionId: session,
          // The verified number, not one retyped into the form.
          address: { ...address, phone: `+91 ${snapshot.phone}` },
        });
        setAddresses((parsed.addresses ?? []) as OccAddress[]);
        commit({ step: "method" });
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, snapshot.paymentSessionId, snapshot.phone, commit],
  );

  return {
    step: snapshot.step,
    busy,
    error,
    paymentSessionId: snapshot.paymentSessionId ?? null,
    orderId: snapshot.orderId ?? null,
    phone: snapshot.phone ?? null,
    checkoutUrl: snapshot.checkoutUrl ?? null,
    addresses,
    start,
    submitOtp,
    resendOtp,
    // The chosen address is not yet bound to the order — see the spec's open
    // questions. Selecting it advances the flow and nothing more.
    selectAddress: () => commit({ step: "method" }),
    createAddress,
    markDispatched: () => commit({ step: "paying" }),
    backToPayment: () => commit({ step: "method" }),
    backToAddress,
    reset: () => {
      setError(null);
      setAddresses([]);
      commit({
        step: "phone",
        paymentSessionId: undefined,
        orderId: undefined,
      });
    },
  };
}
