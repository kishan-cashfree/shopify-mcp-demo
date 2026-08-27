import { useCallback, useEffect, useState } from "react";
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
  /** Where the order is going, once the buyer has said. */
  shippingAddress: OccAddress | null;
  start: (cartId: string, phone: string) => Promise<void>;
  /**
   * Creates the payable order with the buyer's chosen methods and returns its
   * hosted-checkout URL, or null if it could not be created.
   */
  /** The hosted-checkout URL for the chosen method, off the existing order. */
  payWithMethod: (code: string) => string | null;
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

  /**
   * Recovers the address list after a reload.
   *
   * `addresses` is hook state and deliberately not persisted — it is
   * re-fetchable, and the session id is the authority anyway. But a reload
   * restores the snapshot without it, and AddressStep reads an empty list as
   * "this buyer has no saved addresses" and renders the add-address form.
   * Measured in ChatGPT: the whole snapshot came back — screen "checkout",
   * step "address", cart set — and the buyer was asked to type in an address
   * they had already saved.
   *
   * "method" is included because Back from the payment step returns here, and
   * a list that only reappears after a round trip is the same bug one screen
   * later.
   */
  useEffect(() => {
    const session = persisted.paymentSessionId;
    const needsList = persisted.step === "address" || persisted.step === "method";
    if (!session || !needsList) return;

    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadAddresses(session);
        if (!cancelled) setAddresses(loaded);
      } catch {
        // The buyer can still add one, and createAddress reports its own
        // failures. An error banner on arrival would say nothing actionable.
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount only: `persisted` is the restored snapshot, and every later
    // transition sets addresses itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // Offered back so the server can reuse this order instead of
          // creating another. Spread, so a first attempt sends no key at all
          // rather than an explicit undefined.
          ...(snapshot.paymentSessionId
            ? { resumeSessionId: snapshot.paymentSessionId }
            : {}),
        });

        // Committed BEFORE the OTP is sent, and without advancing the step.
        //
        // It used to be committed only once both calls had succeeded, so an
        // OTP 502 threw away the record of an order that was perfectly good
        // and the buyer's retry created another. Measured 2026-08-27: three
        // "Couldn't send the OTP" failures in a row left four Cashfree orders
        // behind for one checkout. The order is not what failed.
        commit({
          paymentSessionId: created.paymentSessionId,
          orderId: created.orderId,
          phone: enteredPhone,
          checkoutUrl: created.checkoutUrl,
          checkoutUrls: created.checkoutUrls as Record<string, string>,
        });

        // Separate call, so resend has an endpoint that does not create a
        // second order.
        await post(`${baseUrl}/api/pay/otp`, {
          paymentSessionId: created.paymentSessionId,
        });

        commit({ step: "otp" });
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, snapshot.paymentSessionId, commit],
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

  /**
   * Commits the choice locally and tells the server about it.
   *
   * The commit is synchronous and the POST is not awaited: the buyer moves to
   * the payment step immediately, as they always have, and the server call is
   * bookkeeping for the Shopify order sync rather than something the checkout
   * waits on. A failure here costs the order its shipping address, which the
   * sync then refuses to place — better than a spinner between the buyer and
   * paying.
   */
  const selectAddress = useCallback(
    (address: OccAddress) => {
      commit({ step: "method", shippingAddress: address });

      const session = snapshot.paymentSessionId;
      if (!session) return;
      post(`${baseUrl}/api/pay/addresses/select`, {
        paymentSessionId: session,
        address,
      }).catch(() => {
        // Deliberately silent. Nothing on this screen depends on it, and the
        // server logs the skipped sync with its reason.
      });
    },
    [baseUrl, snapshot.paymentSessionId, commit],
  );

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
        const saved = (parsed.addresses ?? []) as OccAddress[];
        setAddresses(saved);

        // Selected, not just saved. This used to commit straight to "method",
        // so a first-time buyer — the one with no saved address, who has to
        // type one — reached the payment step with nothing chosen.
        //
        // Matched on the two fields the buyer typed rather than taking the
        // last entry: Cashfree returns the whole list and does not promise an
        // order for it.
        const created =
          saved.find(
            (candidate) =>
              candidate.address_line_one === address.address_line_one &&
              candidate.zip_code === address.zip_code,
          ) ?? saved.at(-1);

        if (created) selectAddress(created);
        else commit({ step: "method" });
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [baseUrl, snapshot.paymentSessionId, snapshot.phone, commit],
  );

  /**
   * Opens the one order this checkout has, on the method the buyer picked.
   *
   * This used to create a SECOND Cashfree order. `order_meta.payment_methods`
   * is settable only at Create Order, and the first order has to exist before
   * the buyer chooses anything — its payment_session_id is the `x-chxs-id`
   * that OCC login runs against — so carrying the choice meant a fresh order,
   * and an abandoned one in Cashfree for every purchase.
   *
   * Cashfree's hosted page routes by method on its own: measured 2026-08-27,
   * /checkout/payment-method/{upi,card,net-banking} all answer 200 on sandbox
   * and production while an invented method 404s. The choice rides on the URL
   * now, so one order and one session cover login, addresses and payment.
   *
   * No network call left in here at all — the URLs arrived with the order.
   */
  const payWithMethod = useCallback(
    (code: string): string | null => {
      const url = snapshot.checkoutUrls?.[code] ?? snapshot.checkoutUrl ?? null;
      if (!url) return null;
      commit({ step: "paying" });
      return url;
    },
    [snapshot.checkoutUrls, snapshot.checkoutUrl, commit],
  );

  return {
    step: snapshot.step,
    busy,
    error,
    paymentSessionId: snapshot.paymentSessionId ?? null,
    orderId: snapshot.orderId ?? null,
    phone: snapshot.phone ?? null,
    checkoutUrl: snapshot.checkoutUrl ?? null,
    shippingAddress: snapshot.shippingAddress ?? null,
    addresses,
    start,
    submitOtp,
    resendOtp,
    selectAddress,
    createAddress,
    markDispatched: () => commit({ step: "paying" }),
    payWithMethod,
    backToPayment: () => commit({ step: "method" }),
    backToAddress,
    reset: () => {
      setError(null);
      setAddresses([]);
      commit({
        step: "phone",
        paymentSessionId: undefined,
        orderId: undefined,
        shippingAddress: undefined,
      });
    },
  };
}
