import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * One widget, one bridge.
 *
 * The MCP Apps transport is a single postMessage channel to the host. Two
 * `App` instances handshaking over it race, and the loser is left reporting
 * "Not connected" — which is exactly what MethodSelector rendered in red after
 * a buyer picked a payment method, with no `tools/call` reaching the server.
 *
 * That race is also the "coin flip" the dispatch retry was built to paper
 * over: the comment in MethodSelector put the silent-drop rate at roughly half
 * of attempts, which is what a two-way race looks like.
 */
const instances: unknown[] = [];
const connect = vi.fn().mockResolvedValue(undefined);
const close = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: class {
    constructor() {
      instances.push(this);
    }
    connect = connect;
    close = close;
    updateModelContext = vi.fn().mockResolvedValue(undefined);
    sendMessage = vi.fn().mockResolvedValue({});
    callServerTool = vi.fn().mockResolvedValue({});
    getHostContext = vi.fn().mockReturnValue({ theme: "dark" });
    ontoolinput = null;
    ontoolresult = null;
    onhostcontextchanged = null;
    onteardown = null;
    onerror = null;
    ontoolcancelled = null;
  },
}));

async function freshModules() {
  instances.length = 0;
  connect.mockClear();
  close.mockClear();
  vi.resetModules();
  const platform = await import("../utils/platform");
  const { useMcpApp } = await import("./useMcpApp");
  return { platform, useMcpApp };
}

describe("useMcpApp", () => {
  beforeEach(() => {
    // No window.openai, so the factory builds the MCP Apps client.
    vi.unstubAllGlobals();
  });

  it("shares one App with the platform client instead of opening a second", async () => {
    const { platform, useMcpApp } = await freshModules();

    function Probe() {
      useMcpApp();
      return null;
    }
    render(<Probe />);
    // The same bridge the payment handoff goes through.
    platform.getClientPlatform();

    await waitFor(() => expect(instances.length).toBeGreaterThan(0));
    expect(instances).toHaveLength(1);
  });

  it("handshakes once, so neither side can lose the race", async () => {
    const { platform, useMcpApp } = await freshModules();

    function Probe() {
      useMcpApp();
      return null;
    }
    render(<Probe />);
    platform.getClientPlatform();

    await waitFor(() => expect(connect).toHaveBeenCalled());
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("reports connected once the handshake resolves", async () => {
    const { useMcpApp } = await freshModules();

    let connected = false;
    function Probe() {
      connected = useMcpApp().isConnected;
      return null;
    }
    render(<Probe />);

    await waitFor(() => expect(connected).toBe(true));
  });

  it("leaves the shared bridge open when a widget screen unmounts", async () => {
    // The platform client is a module singleton that outlives any one React
    // tree. Closing it on unmount would strand every later payment handoff.
    const { useMcpApp } = await freshModules();

    function Probe() {
      useMcpApp();
      return null;
    }
    const view = render(<Probe />);
    await waitFor(() => expect(connect).toHaveBeenCalled());
    view.unmount();

    expect(close).not.toHaveBeenCalled();
  });
});
