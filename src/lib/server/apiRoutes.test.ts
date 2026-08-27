import { describe, it, expect, vi } from "vitest";
import { routeApiRequest, type ApiRouteDeps } from "./apiRoutes";

const ok = (body: unknown) => ({ status: 200, body });

function deps(over: Partial<ApiRouteDeps> = {}): ApiRouteDeps {
  return {
    searchProducts: vi.fn().mockResolvedValue({ products: [] }),
    cart: vi.fn().mockResolvedValue(ok({ cart: 1 })),
    orderRaw: vi.fn().mockResolvedValue(ok({ order_id: "o1" })),
    pay: {
      handleCreateOrder: vi.fn().mockResolvedValue(ok({ order: 1 })),
      handleSendOtp: vi.fn().mockResolvedValue(ok({ sent: true })),
      handleVerifyOtp: vi.fn().mockResolvedValue(ok({ verified: true })),
      handleDispatchStatus: vi.fn().mockResolvedValue(ok({ seen: true })),
      handleCreateAddress: vi.fn().mockResolvedValue(ok({ made: true })),
      handleGetAddresses: vi.fn().mockResolvedValue(ok({ addresses: [] })),
      handleSelectAddress: vi.fn().mockResolvedValue(ok({ ok: true })),
      handleOrderStatus: vi.fn().mockResolvedValue(ok({ status: "PAID" })),
    },
    ...over,
  };
}

const run = (
  method: string,
  path: string,
  body: unknown = {},
  d: ApiRouteDeps = deps(),
) =>
  routeApiRequest(
    method,
    path,
    new URL(`http://x${path}`).searchParams,
    async () => body,
    d,
  );

describe("routeApiRequest", () => {
  it("returns null for a path it does not own, so the caller can fall through", async () => {
    // Not a 404: the local server still has "/" and "/mcp" to try.
    expect(await run("POST", "/mcp")).toBeNull();
    expect(await run("GET", "/")).toBeNull();
  });

  it("refuses a catalog search with no query", async () => {
    expect(await run("POST", "/api/shop/search", { query: "  " })).toEqual({
      status: 400,
      body: { error: "query is required" },
    });
  });

  it("blames Shopify, not the widget, when the catalog lookup fails", async () => {
    // 502 rather than 400. The request parsed; what failed was upstream, and
    // a 400 here sends the next person reading the log to the wrong side.
    const d = deps({
      searchProducts: vi.fn().mockRejectedValue(new Error("429 Rate limit")),
    });

    expect(await run("POST", "/api/shop/search", { query: "shirt" }, d)).toEqual(
      { status: 502, body: { error: "429 Rate limit" } },
    );
  });

  it("reads the payment session id out of the body, never the URL", async () => {
    // The session id is a credential. It goes in a POST body so it stays out
    // of request lines, proxy logs and browser history.
    const d = deps();
    await run("POST", "/api/pay/addresses/list", { paymentSessionId: "s1" }, d);

    expect(d.pay.handleGetAddresses).toHaveBeenCalledWith("s1");
  });

  it("404s an unknown /api/pay/ route rather than falling through", async () => {
    expect(await run("POST", "/api/pay/refund")).toEqual({
      status: 404,
      body: { error: "Not found" },
    });
  });

  it("passes an order id through url-decoded", async () => {
    const d = deps();
    await run("GET", "/api/orders/order%2F123", {}, d);

    expect(d.orderRaw).toHaveBeenCalledWith("order/123");
  });

  it("does not leak an upstream message when an order fetch throws", async () => {
    // This one proxies a third party's raw body; its exception text is not
    // ours to forward to a browser.
    const d = deps({ orderRaw: vi.fn().mockRejectedValue(new Error("boom")) });

    expect(await run("GET", "/api/orders/o1", {}, d)).toEqual({
      status: 500,
      body: { error: "Order status fetch failed" },
    });
  });
});

describe("address selection", () => {
  it("routes the chosen address to the pay handler", async () => {
    const d = deps();
    await run(
      "POST",
      "/api/pay/addresses/select",
      { paymentSessionId: "s1", address: { id: "addr_1" } },
      d,
    );
    expect(d.pay.handleSelectAddress).toHaveBeenCalled();
  });
});
