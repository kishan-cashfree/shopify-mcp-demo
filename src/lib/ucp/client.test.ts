import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createUcpClient, UcpError } from "./client";

const CONFIG = {
  shopDomain: "test-store.myshopify.com",
  agentProfile: "https://example.test/profile.json",
};

function envelope(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
    }),
  };
}

describe("createUcpClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a JSON-RPC envelope to the UCP endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ ok: 1 }) as never);
    const client = createUcpClient(CONFIG);

    await client.call("search_catalog", { catalog: { query: "shirt" } });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://test-store.myshopify.com/api/ucp/mcp");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("search_catalog");
    expect(body.params.arguments.catalog).toEqual({ query: "shirt" });
  });

  it("injects the ucp-agent profile into every call", async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ ok: 1 }) as never);
    const client = createUcpClient(CONFIG);

    await client.call("create_cart", { cart: { line_items: [] } });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.params.arguments.meta["ucp-agent"].profile).toBe(
      "https://example.test/profile.json",
    );
  });

  it("double-unwraps result.content[0].text into an object", async () => {
    vi.mocked(fetch).mockResolvedValue(
      envelope({ products: [{ id: "gid://x" }] }) as never,
    );
    const client = createUcpClient(CONFIG);

    const result = await client.call("search_catalog", {});

    expect(result).toEqual({ products: [{ id: "gid://x" }] });
  });

  it("throws UcpError carrying Shopify's own message when isError is set", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            {
              type: "text",
              text: "Invalid arguments: missing product_variant_id",
            },
          ],
          isError: true,
        },
      }),
    } as never);
    const client = createUcpClient(CONFIG);

    await expect(client.call("update_cart", {})).rejects.toThrow(
      "Invalid arguments: missing product_variant_id",
    );
    await expect(client.call("update_cart", {})).rejects.toBeInstanceOf(
      UcpError,
    );
  });

  it("throws when the HTTP request itself fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    } as never);
    const client = createUcpClient(CONFIG);

    await expect(client.call("search_catalog", {})).rejects.toThrow(/404/);
  });

  it("throws when the network rejects", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createUcpClient(CONFIG);

    await expect(client.call("search_catalog", {})).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("surfaces a JSON-RPC protocol error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "Method not found" },
      }),
    } as never);
    const client = createUcpClient(CONFIG);

    await expect(client.call("nope", {})).rejects.toThrow("Method not found");
  });
});
