import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCheckoutFlow } from "./useCheckoutFlow";
import type { OccAddress } from "../lib/cashfree/occ";

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const START = { step: "phone" as const };

async function reachAddress(onPersist = vi.fn()) {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      json({ orderId: "o1", paymentSessionId: "s1", orderAmount: 3600 }) as never,
    )
    .mockResolvedValueOnce(json({ sent: true }) as never)
    .mockResolvedValueOnce(json({ ok: true }) as never)
    .mockResolvedValueOnce(json({ addresses: [{ id: "a1" }] }) as never);

  const hook = renderHook(() => useCheckoutFlow("http://x", START, onPersist));
  await act(async () => {
    await hook.result.current.start("cart1", "8433719326");
  });
  await act(async () => {
    await hook.result.current.submitOtp("111000");
  });
  return hook;
}

describe("useCheckoutFlow", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("reloads saved addresses when a reload drops back onto the address step", async () => {
    // Measured in ChatGPT: reloading the page restored the whole snapshot —
    // screen "checkout", checkoutStep "address", cart set — but `addresses` is
    // hook state and is not in it. AddressStep with an empty list renders the
    // add-address form, so a buyer who had already saved an address was asked
    // to type it in again.
    vi.mocked(fetch).mockResolvedValue(
      json({ addresses: [{ id: "a1" }] }) as never,
    );

    const { result } = renderHook(() =>
      useCheckoutFlow(
        "http://x",
        { step: "address", paymentSessionId: "s1", orderId: "o1" },
        vi.fn(),
      ),
    );

    await waitFor(() => expect(result.current.addresses).toHaveLength(1));
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/pay/addresses/list");
  });

  it("reloads them on the payment step too, so Back has a list to show", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({ addresses: [{ id: "a1" }] }) as never,
    );

    const { result } = renderHook(() =>
      useCheckoutFlow(
        "http://x",
        { step: "method", paymentSessionId: "s1", orderId: "o1" },
        vi.fn(),
      ),
    );

    await waitFor(() => expect(result.current.addresses).toHaveLength(1));
  });

  it("does not ask for addresses before the buyer has signed in", async () => {
    // No payment session means no OCC login yet; the call would 400.
    renderHook(() => useCheckoutFlow("http://x", START, vi.fn()));

    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("creates the order and sends an OTP on start", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({ orderId: "o1", paymentSessionId: "s1" }) as never,
      )
      .mockResolvedValueOnce(json({ sent: true }) as never);

    const { result } = renderHook(() =>
      useCheckoutFlow("http://x", START, vi.fn()),
    );

    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://x/api/pay/order");
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("http://x/api/pay/otp");
    expect(result.current.step).toBe("otp");
    expect(result.current.paymentSessionId).toBe("s1");
  });

  it("stays on phone when order creation fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ error: "order_amount is invalid" }, 502) as never,
    );

    const { result } = renderHook(() =>
      useCheckoutFlow("http://x", START, vi.fn()),
    );

    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });

    expect(result.current.step).toBe("phone");
    expect(result.current.error).toBe("order_amount is invalid");
  });

  it("loads addresses after a successful OTP", async () => {
    const { result } = await reachAddress();

    await waitFor(() => expect(result.current.step).toBe("address"));
    expect(result.current.addresses).toEqual([{ id: "a1" }]);
  });

  it("stays on otp when the code is wrong", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({ orderId: "o1", paymentSessionId: "s1" }) as never,
      )
      .mockResolvedValueOnce(json({ sent: true }) as never)
      .mockResolvedValueOnce(json({ error: "Invalid OTP" }, 400) as never);

    const { result } = renderHook(() =>
      useCheckoutFlow("http://x", START, vi.fn()),
    );
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });
    await act(async () => {
      await result.current.submitOtp("000000");
    });

    expect(result.current.step).toBe("otp");
    expect(result.current.error).toBe("Invalid OTP");
  });

  it("resends without creating a second order", async () => {
    const { result } = await reachAddress();
    const before = vi.mocked(fetch).mock.calls.length;
    vi.mocked(fetch).mockResolvedValueOnce(json({ sent: true }) as never);

    await act(async () => {
      await result.current.resendOtp();
    });

    expect(vi.mocked(fetch).mock.calls[before][0]).toBe("http://x/api/pay/otp");
  });

  it("advances to method after an address is selected", async () => {
    const { result } = await reachAddress();

    act(() => {
      result.current.selectAddress({ id: "a1" } as OccAddress);
    });

    expect(result.current.step).toBe("method");
  });

  it("keeps the address the buyer picked", async () => {
    // It used to be dropped on the floor: selectAddress ignored its argument
    // entirely. The receipt has to name where the order is going, and this is
    // the only point in the flow the buyer states it.
    const { result } = await reachAddress();

    act(() => {
      result.current.selectAddress({
        id: "a1",
        customer_name: "Kishan Kumar Maurya",
      } as OccAddress);
    });

    expect(result.current.shippingAddress?.customer_name).toBe(
      "Kishan Kumar Maurya",
    );
  });

  /**
   * The server has to know which address the order ships to, and until now it
   * never did: the selection lived only in this hook, so a real Shopify order
   * placed from the paid Cashfree order had nowhere to ship to.
   */
  it("tells the server which address was chosen", async () => {
    const { result } = await reachAddress();
    vi.mocked(fetch).mockResolvedValue(json({ ok: true }) as never);

    act(() => {
      result.current.selectAddress({ id: "a1" } as OccAddress);
    });

    await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url]) => String(url) === "http://x/api/pay/addresses/select",
        );
      expect(call).toBeDefined();
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({
        paymentSessionId: "s1",
        address: { id: "a1" },
      });
    });
  });

  /**
   * Creating an address used to jump straight to the payment step without
   * selecting it, so a first-time buyer — the one who has no saved address and
   * must type one — reached payment with no address chosen at all.
   */
  it("selects the address it just created", async () => {
    const { result } = await reachAddress();
    vi.mocked(fetch).mockResolvedValue(
      json({
        addresses: [
          { id: "a1", address_line_one: "Old", zip_code: "560001" },
          { id: "a2", address_line_one: "Koramangala", zip_code: "560034" },
        ],
      }) as never,
    );

    await act(async () => {
      await result.current.createAddress({
        address_line_one: "Koramangala",
        zip_code: "560034",
      } as never);
    });

    expect(result.current.shippingAddress?.id).toBe("a2");
  });

  /**
   * A failed OTP send used to strand the order it had just created.
   *
   * `start` committed nothing until BOTH calls succeeded, so an OTP 502 left
   * the widget with no record of the order and the retry created another.
   * Measured 2026-08-27: three 502s in a row, four Cashfree orders, one
   * checkout.
   */
  describe("recovering from a failed OTP send", () => {
    async function otpFails() {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          json({
            orderId: "o1",
            paymentSessionId: "s1",
            orderAmount: 3600,
          }) as never,
        )
        .mockResolvedValueOnce(json({ error: "Couldn't send the OTP" }, 502) as never);

      const hook = renderHook(() =>
        useCheckoutFlow("http://x", START, vi.fn()),
      );
      await act(async () => {
        await hook.result.current.start("cart1", "8433719326");
      });
      return hook;
    }

    it("keeps the buyer on the phone step and says what failed", async () => {
      const { result } = await otpFails();

      expect(result.current.step).toBe("phone");
      expect(result.current.error).toMatch(/OTP/i);
    });

    it("remembers the order the failed send left behind", async () => {
      const { result } = await otpFails();

      expect(result.current.paymentSessionId).toBe("s1");
      expect(result.current.orderId).toBe("o1");
    });

    it("offers that order back on the retry rather than making another", async () => {
      const { result } = await otpFails();
      vi.mocked(fetch).mockResolvedValue(json({ ok: true }) as never);

      await act(async () => {
        await result.current.start("cart1", "8433719326");
      });

      const retry = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url) === "http://x/api/pay/order")
        .at(-1);
      expect(JSON.parse(retry?.[1]?.body as string)).toEqual({
        cartId: "cart1",
        phone: "8433719326",
        resumeSessionId: "s1",
      });
    });

    // A first attempt has nothing to resume. Sending the key as undefined
    // would be harmless but sending a stale one would not, so it is absent.
    it("sends no resume id on a first attempt", async () => {
      vi.mocked(fetch).mockResolvedValue(
        json({ orderId: "o1", paymentSessionId: "s1" }) as never,
      );
      const { result } = renderHook(() =>
        useCheckoutFlow("http://x", START, vi.fn()),
      );

      await act(async () => {
        await result.current.start("cart1", "8433719326");
      });

      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(init?.body as string)).toEqual({
        cartId: "cart1",
        phone: "8433719326",
      });
    });
  });

  it("drops the address when the flow is reset", async () => {
    // reset() starts a new buyer's checkout in the same widget. Carrying the
    // previous address into it would print a stranger's street on the receipt.
    const { result } = await reachAddress();
    act(() => result.current.selectAddress({ id: "a1" } as OccAddress));

    act(() => result.current.reset());

    expect(result.current.shippingAddress).toBeNull();
  });

  it("attaches the verified phone when creating an address", async () => {
    const { result } = await reachAddress();
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ addresses: [{ id: "a2" }] }) as never,
    );

    await act(async () => {
      await result.current.createAddress({ city: "Bangalore" } as never);
    });

    // Matched by URL rather than taken as the last call: creating an address
    // now selects it too, so a second POST follows this one.
    const call = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url) === "http://x/api/pay/addresses");
    const body = JSON.parse(call?.[1]?.body as string);
    // The user already gave us their number; asking again in the form would be
    // rude and error-prone.
    expect(body.address.phone).toBe("+91 8433719326");
    expect(result.current.step).toBe("method");
  });

  it("persists the step and session after the order is created", async () => {
    const onPersist = vi.fn();
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({ orderId: "o1", paymentSessionId: "s1" }) as never,
      )
      .mockResolvedValueOnce(json({ sent: true }) as never);

    const { result } = renderHook(() =>
      useCheckoutFlow("http://x", START, onPersist),
    );
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });

    expect(onPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "otp",
        paymentSessionId: "s1",
        orderId: "o1",
      }),
    );
  });

  it("resumes from a persisted snapshot", () => {
    const { result } = renderHook(() =>
      useCheckoutFlow(
        "http://x",
        {
          step: "address",
          paymentSessionId: "s1",
          orderId: "o1",
          phone: "8433719326",
        },
        vi.fn(),
      ),
    );

    expect(result.current.step).toBe("address");
    expect(result.current.paymentSessionId).toBe("s1");
  });

  it("returns to phone on reset", async () => {
    const { result } = await reachAddress();

    act(() => {
      result.current.reset();
    });

    expect(result.current.step).toBe("phone");
    expect(result.current.paymentSessionId).toBeNull();
  });
});

describe("useCheckoutFlow — address read transport", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("reads addresses over POST, keeping the session id out of the URL", async () => {
    const { result } = await reachAddress();

    // Third call is the addresses read. It must be a POST with the session in
    // the body: a session id is a credential and does not belong in a URL,
    // and GETs from the widget were observed never reaching the server.
    const call = vi.mocked(fetch).mock.calls[3];
    expect(call[0]).toBe("http://x/api/pay/addresses/list");
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(call[1]?.body as string)).toEqual({
      paymentSessionId: "s1",
    });
    expect(String(call[0])).not.toContain("paymentSessionId=");
    expect(result.current.step).toBe("address");
  });
});

describe("useCheckoutFlow — error attribution", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("does not blame the OTP when loading addresses fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json({ orderId: "o1", paymentSessionId: "s1" }) as never,
      )
      .mockResolvedValueOnce(json({ sent: true }) as never)
      .mockResolvedValueOnce(json({ ok: true }) as never)
      .mockRejectedValueOnce(new Error("Failed to fetch"));

    const { result } = renderHook(() =>
      useCheckoutFlow("http://x", START, vi.fn()),
    );
    await act(async () => {
      await result.current.start("cart1", "8433719326");
    });
    await act(async () => {
      await result.current.submitOtp("111000");
    });

    // Verification succeeded; only the address load failed. The message must
    // say so, or the user re-enters a code that is already spent.
    expect(result.current.error).toMatch(/signed in/i);
    expect(result.current.error).toMatch(/addresses/i);
    expect(result.current.step).toBe("otp");
  });
});

describe("useCheckoutFlow — escape from the polling screen", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns to the payment step so a buyer can retry", async () => {
    const { result } = await reachAddress();
    act(() => result.current.selectAddress({ id: "a1" } as never));
    act(() => result.current.markDispatched());
    expect(result.current.step).toBe("paying");

    act(() => result.current.backToPayment());

    // Without this a buyer whose payment never completed is stranded with no
    // retry and no way back to the cart.
    expect(result.current.step).toBe("method");
  });

  it("steps back from method to the address list", async () => {
    // Back on the payment screen means "I picked the wrong address", not
    // "abandon checkout" — the order and session are already created and must
    // survive the trip.
    const { result } = await reachAddress();
    act(() => result.current.selectAddress({ id: "a1" } as never));
    expect(result.current.step).toBe("method");
    const session = result.current.paymentSessionId;
    const order = result.current.orderId;

    await act(async () => {
      await result.current.backToAddress();
    });

    expect(result.current.step).toBe("address");
    expect(result.current.paymentSessionId).toBe(session);
    expect(result.current.orderId).toBe(order);
  });

  it("reloads the addresses when stepping back after a remount", async () => {
    // addresses live in hook state, not in the persisted snapshot. A host
    // re-render mid-checkout resumes at "method" with an empty list, and
    // without this the buyer taps Back and gets the add-address form instead
    // of the addresses they already saved.
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ addresses: [{ id: "a1" }, { id: "a2" }] }) as never,
    );
    const { result } = renderHook(() =>
      useCheckoutFlow(
        "http://x",
        {
          step: "method" as const,
          paymentSessionId: "s1",
          orderId: "o1",
          phone: "8433719326",
        },
        vi.fn(),
      ),
    );
    expect(result.current.addresses).toHaveLength(0);

    await act(async () => {
      await result.current.backToAddress();
    });

    expect(result.current.step).toBe("address");
    expect(result.current.addresses).toHaveLength(2);
  });

  it("keeps the loaded addresses when stepping back", async () => {
    // Re-fetching would be wasteful, and an empty list would drop the buyer
    // into the add-address form instead of the list they came from.
    const { result } = await reachAddress();
    const loaded = result.current.addresses.length;
    act(() => result.current.selectAddress({ id: "a1" } as never));

    await act(async () => {
      await result.current.backToAddress();
    });

    expect(result.current.addresses).toHaveLength(loaded);
    expect(loaded).toBeGreaterThan(0);
  });
});
