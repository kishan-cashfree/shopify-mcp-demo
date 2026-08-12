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
