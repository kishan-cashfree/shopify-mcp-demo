import { describe, it, expect } from "vitest";
import { formatRequestLog } from "./logging";

describe("formatRequestLog", () => {
  it("includes method, path, status and duration", () => {
    const line = formatRequestLog({
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
      method: "GET",
      path: "/",
      status: 200,
      durationMs: 1,
    });

    expect(line).not.toContain("undefined");
  });

  it("marks failures so they are visible in a scrolling log", () => {
    const line = formatRequestLog({
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
