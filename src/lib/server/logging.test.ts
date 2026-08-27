import { describe, it, expect } from "vitest";
import { formatRequestLog,
  describeApiOutcome,
} from "./logging";

/** Fixed so the assertions are exact rather than "matches a time-ish shape". */
const AT = new Date("2026-08-13T09:41:07.238Z");

describe("formatRequestLog", () => {
  it("stamps each line with a wall-clock time", () => {
    // Duration alone cannot measure the gap *between* two requests, which is
    // the whole question when a payment dispatch arrives late: the log showed
    // a tools/call landing after the buyer had already left for the external
    // link, and there was no way to say whether that was 8 seconds or 80.
    const line = formatRequestLog({
      at: AT,
      method: "POST",
      path: "/mcp",
      status: 200,
      durationMs: 37,
      mcpMethod: "tools/call",
      mcpTool: "CheckoutTool",
    });

    expect(line).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} /);
  });

  it("includes method, path, status and duration", () => {
    const line = formatRequestLog({
      at: AT,
      method: "POST",
      path: "/api/shop/cart",
      status: 200,
      durationMs: 412,
    });

    expect(line).toContain("POST");
    expect(line).toContain("/api/shop/cart");
    expect(line).toContain("200");
    expect(line).toContain("412ms");
  });

  it("names the MCP method when one is known", () => {
    // "POST /mcp" alone is useless during a demo — every call looks identical.
    const line = formatRequestLog({
      at: AT,
      method: "POST",
      path: "/mcp",
      status: 200,
      durationMs: 88,
      mcpMethod: "tools/call",
      mcpTool: "SearchProducts",
    });

    expect(line).toContain("tools/call");
    expect(line).toContain("SearchProducts");
  });

  it("omits the MCP detail when absent", () => {
    const line = formatRequestLog({
      at: AT,
      method: "GET",
      path: "/",
      status: 200,
      durationMs: 1,
    });

    expect(line).not.toContain("undefined");
  });

  it("marks failures so they are visible in a scrolling log", () => {
    const line = formatRequestLog({
      at: AT,
      method: "POST",
      path: "/api/shop/cart",
      status: 502,
      durationMs: 30,
    });

    expect(line).toContain("502");
    expect(line).toMatch(/✗|ERROR/);
  });
});

describe("describeMcpBody", () => {
  it("extracts method and tool name from a tools/call body", async () => {
    const { describeMcpBody } = await import("./logging");

    expect(
      describeMcpBody({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "SearchProducts", arguments: { query: "shirt" } },
      }),
    ).toEqual({ mcpMethod: "tools/call", mcpTool: "SearchProducts" });
  });

  it("extracts the method alone for non-tool calls", async () => {
    const { describeMcpBody } = await import("./logging");

    expect(describeMcpBody({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toEqual(
      { mcpMethod: "tools/list", mcpTool: undefined },
    );
  });

  it("returns empty detail for a body it cannot read", async () => {
    const { describeMcpBody } = await import("./logging");

    expect(describeMcpBody(undefined)).toEqual({
      mcpMethod: undefined,
      mcpTool: undefined,
    });
    expect(describeMcpBody("not an object")).toEqual({
      mcpMethod: undefined,
      mcpTool: undefined,
    });
  });
});

describe("describeMcpBody — resource reads", () => {
  it("names the resource a resources/read targets", async () => {
    const { describeMcpBody } = await import("./logging");

    expect(
      describeMcpBody({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "ui://cashfree/payment.html" },
      }),
    ).toEqual({
      mcpMethod: "resources/read",
      mcpTool: undefined,
      mcpUri: "ui://cashfree/payment.html",
    });
  });

  it("includes the uri in the log line", async () => {
    const { formatRequestLog } = await import("./logging");

    const line = formatRequestLog({
      at: AT,
      method: "POST",
      path: "/mcp",
      status: 200,
      durationMs: 12,
      mcpMethod: "resources/read",
      mcpUri: "ui://cashfree/payment.html",
    });

    expect(line).toContain("ui://cashfree/payment.html");
  });
});

describe("formatRequestLog — failure reasons", () => {
  const AT2 = new Date("2026-08-14T16:27:03.549Z");

  it("prints why a request failed, not just that it did", () => {
    // A live 502 on /api/pay/otp recorded nothing but the status, so the cause
    // was only visible to whoever happened to be watching the widget. The
    // reason is already in the response body — this stops discarding it.
    const line = formatRequestLog({
      at: AT2,
      method: "POST",
      path: "/api/pay/otp",
      status: 502,
      durationMs: 59,
      error: "OTP request limit exceeded, try after some time",
    });

    expect(line).toContain("502");
    expect(line).toContain("OTP request limit exceeded");
  });

  it("says nothing extra when a request succeeded", () => {
    // Success lines are the bulk of the log and stay scannable.
    const line = formatRequestLog({
      at: AT2,
      method: "POST",
      path: "/api/pay/otp",
      status: 200,
      durationMs: 86,
      error: "ignored on success",
    });

    expect(line).not.toContain("ignored on success");
  });

  it("omits the reason when a failure carries none", () => {
    const line = formatRequestLog({
      at: AT2,
      method: "POST",
      path: "/api/pay/otp",
      status: 502,
      durationMs: 59,
    });

    expect(line).toMatch(/502 59ms$/);
  });

  it("keeps one failure to one line", () => {
    // Multi-line entries break every grep in this session's debugging.
    const line = formatRequestLog({
      at: AT2,
      method: "POST",
      path: "/api/pay/otp",
      status: 502,
      durationMs: 59,
      error: "upstream said:\nrate limited\n  retry later",
    });

    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("rate limited");
  });

  it("truncates a runaway upstream error", () => {
    // Some gateways return an HTML error page. Pasting it into the log buries
    // every other line.
    const line = formatRequestLog({
      at: AT2,
      method: "POST",
      path: "/api/pay/otp",
      status: 502,
      durationMs: 59,
      error: "x".repeat(500),
    });

    expect(line.length).toBeLessThan(300);
    expect(line).toContain("…");
  });
});

/**
 * What a successful response was actually about.
 *
 * The order-status poll logged only `POST /api/orders/status 200 108ms`, so
 * whether the widget ever saw the payment land had to be inferred from the
 * gaps between requests. On 2026-08-27 that left the question open twice: the
 * order was PAID both times, and the log could not say whether the buyer's
 * screen knew it.
 */
describe("describeApiOutcome", () => {
  it("names the order status the poll returned", () => {
    expect(describeApiOutcome({ orderId: "o1", orderStatus: "ACTIVE" })).toBe(
      "ACTIVE",
    );
  });


  // Every other route's body is its own business. A log line that tried to
  // summarise all of them would print noise on the ones it does not understand.
  it("says nothing about bodies it has no summary for", () => {
    expect(describeApiOutcome({ addresses: [] })).toBeUndefined();
    expect(describeApiOutcome({ ok: true })).toBeUndefined();
    expect(describeApiOutcome(null)).toBeUndefined();
    expect(describeApiOutcome("a string")).toBeUndefined();
  });
});

describe("formatRequestLog — outcome", () => {
  it("prints the outcome beside the path", () => {
    const line = formatRequestLog({
      at: new Date(2026, 7, 27, 12, 37, 15, 454),
      method: "POST",
      path: "/api/orders/status",
      status: 200,
      durationMs: 108,
      outcome: "PAID #1042",
    });

    expect(line).toBe(
      "12:37:15.454 → POST /api/orders/status (PAID #1042) 200 108ms",
    );
  });

  it("leaves lines with no outcome exactly as they were", () => {
    const line = formatRequestLog({
      at: new Date(2026, 7, 27, 12, 36, 47, 23),
      method: "POST",
      path: "/api/pay/addresses/list",
      status: 200,
      durationMs: 98,
    });

    expect(line).toBe(
      "12:36:47.023 → POST /api/pay/addresses/list 200 98ms",
    );
  });
});
