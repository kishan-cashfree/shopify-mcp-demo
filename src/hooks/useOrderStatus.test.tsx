import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOrderStatus } from "./useOrderStatus";

function ok(status: string) {
  return { ok: true, status: 200, json: async () => ({ orderStatus: status }) };
}

describe("useOrderStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls over POST, since GETs never leave this widget", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("PAID") as never);
    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await waitFor(() => expect(result.current.status).toBe("PAID"));

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://x/api/orders/status");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ orderId: "o1" });
  });

  it("does nothing without an order id", () => {
    renderHook(() => useOrderStatus("http://x", null));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a terminal PAID status and stops polling", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("PAID") as never);
    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await waitFor(() => expect(result.current.status).toBe("PAID"));
    expect(result.current.done).toBe(true);

    const callsAtTerminal = vi.mocked(fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsAtTerminal);
  });

  it("keeps polling while the order is ACTIVE", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("ACTIVE") as never);
    renderHook(() => useOrderStatus("http://x", "o1"));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    const first = vi.mocked(fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(7_000);

    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(first);
  });

  it("times out without asserting failure", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("ACTIVE") as never);
    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 5_000);

    await waitFor(() => expect(result.current.timedOut).toBe(true));
    // A timeout means we do not know, not that payment failed.
    expect(result.current.status).not.toBe("FAILED");
  });

  it("survives a failed poll and keeps trying", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(ok("PAID") as never);

    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await vi.advanceTimersByTimeAsync(4_000);
    await waitFor(() => expect(result.current.status).toBe("PAID"));
  });

  it("treats FAILED as terminal", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("FAILED") as never);
    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));

    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.status).toBe("FAILED");
  });
});

/**
 * Catching up the moment the widget is looked at again.
 *
 * Measured 2026-08-27: the poll's own ceiling is 15s, but the gap between two
 * live polls was 58 seconds — 12:37:15 to 12:38:13 — because the buyer was on
 * Cashfree's tab and a backgrounded iframe has its setTimeout throttled hard
 * by the browser. The payment had already landed. Nothing was broken; the
 * receipt simply waited for a timer that was not running.
 */
describe("catching up when the widget comes back", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setVisibility("visible");
  });

  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  function ok(status: string) {
    return { ok: true, status: 200, json: async () => ({ orderStatus: status }) };
  }

  it("polls at once instead of waiting out the throttled timer", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("ACTIVE") as never);
    renderHook(() => useOrderStatus("http://x", "o1"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    setVisibility("hidden");
    // 1.1s: past the catch-up floor, but short of the 2s until the next
    // scheduled poll. jsdom does not throttle timers the way a backgrounded
    // iframe does, so this is the only window in which a request proves it
    // came from becoming visible rather than from the ordinary timer.
    await vi.advanceTimersByTimeAsync(1_100);
    const whileHidden = vi.mocked(fetch).mock.calls.length;

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.mocked(fetch).mock.calls.length).toBe(whileHidden + 1);
  });

  // Going away is not an event worth a request. Only coming back is.
  it("does not poll on becoming hidden", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("ACTIVE") as never);
    renderHook(() => useOrderStatus("http://x", "o1"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const before = vi.mocked(fetch).mock.calls.length;

    setVisibility("hidden");

    expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  });

  /**
   * A host that flips visibility repeatedly — Claude recreates the widget
   * iframe as the buyer scrolls — must not turn one payment into a burst of
   * requests. This repo has already taken a Shopify 429 from exactly that
   * shape of accidental fan-out.
   */
  it("does not fire a burst when visibility flaps", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("ACTIVE") as never);
    renderHook(() => useOrderStatus("http://x", "o1"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const before = vi.mocked(fetch).mock.calls.length;

    for (let i = 0; i < 5; i++) {
      setVisibility("hidden");
      setVisibility("visible");
    }
    await vi.advanceTimersByTimeAsync(50);

    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(before + 1);
  });

  it("stays quiet once the payment has landed", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("PAID") as never);
    const { result } = renderHook(() => useOrderStatus("http://x", "o1"));
    await waitFor(() => expect(result.current.done).toBe(true));
    const atTerminal = vi.mocked(fetch).mock.calls.length;

    setVisibility("hidden");
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(vi.mocked(fetch).mock.calls.length).toBe(atTerminal);
  });
});
