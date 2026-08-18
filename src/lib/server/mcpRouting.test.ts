import { describe, it, expect } from "vitest";
import { MCP_METHODS, mcpAllowHeader, routeMcpRequest } from "./mcpRouting";

describe("routeMcpRequest", () => {
  it("declines the GET leg of streamable HTTP rather than 404ing it", () => {
    // The transport is stateless — no session id is issued, so there is no
    // server->client stream for a GET to open. The spec reserves 405 for this
    // case; falling through to the catch-all 404 reads as "no such endpoint".
    // Measured: MCPJam opened this leg 97 times in one session, each 404.
    expect(routeMcpRequest("GET", "/mcp")).toBe("method-not-allowed");
  });

  it("hands POST and DELETE to the transport", () => {
    expect(routeMcpRequest("POST", "/mcp")).toBe("transport");
    expect(routeMcpRequest("DELETE", "/mcp")).toBe("transport");
  });

  it("leaves every other path alone", () => {
    // The 405 is scoped to the MCP endpoint. Swallowing GETs elsewhere would
    // break /api/orders/:id, which the Cashfree widgets poll.
    expect(routeMcpRequest("GET", "/api/orders/order_123")).toBe("pass");
    expect(routeMcpRequest("GET", "/")).toBe("pass");
  });

  it("advertises exactly the methods the transport accepts", () => {
    // The header is derived, not typed out. Written by hand it silently lies
    // the moment MCP_METHODS changes — the same drift that let the two CSP
    // blocks disagree until Claude blocked every product image.
    for (const method of MCP_METHODS) {
      expect(mcpAllowHeader()).toContain(method);
    }
    expect(mcpAllowHeader()).toContain("OPTIONS");
    // GET is the one method named here that is deliberately refused.
    expect(mcpAllowHeader()).not.toContain("GET");
  });
});
